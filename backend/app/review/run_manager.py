import asyncio
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from pydantic import BaseModel, ConfigDict

from app.document_processing.models import FlowDocument, PageDocument
from app.reference_material.models import MaterialType, ReferenceMaterial

from .contracts import AiReviewOutput, ModuleResult, PreviousReview, ReviewResponse, ReviewStatus, ReviewRecord, CompletedModules
from .orchestrator import ReviewGateway, ReviewOrchestrator, build_outcome
from .spell_check import check_spelling


class ProgressEvent(BaseModel):
    model_config = ConfigDict(extra="forbid")

    event: str
    message: str


class ReviewAlreadyRunningError(RuntimeError):
    pass


@dataclass
class ReviewRun:
    runId: str
    document: PageDocument | FlowDocument
    materials: list[ReferenceMaterial]
    createdAt: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    previousReview: PreviousReview | None = None
    moduleResults: dict[str, ModuleResult[Any]] = field(default_factory=dict)
    progressEvents: list[ProgressEvent] = field(default_factory=list)
    response: ReviewResponse | None = None
    task: asyncio.Task[None] | None = None
    cancelRequested: bool = False
    changed: asyncio.Condition = field(default_factory=asyncio.Condition)


class ReviewRunManager:
    def __init__(self, gateway: ReviewGateway) -> None:
        self.gateway = gateway
        self._runs: dict[str, ReviewRun] = {}

    def start(
        self,
        document: PageDocument | FlowDocument,
        materials: list[ReferenceMaterial],
        previous_review: PreviousReview | None = None,
    ) -> str:
        self._ensure_idle()
        run_id = str(uuid4())
        run = ReviewRun(
            runId=run_id,
            document=document,
            materials=materials,
            previousReview=previous_review,
        )
        self._runs[run_id] = run
        run.task = asyncio.create_task(self._execute(run))
        return run_id

    def _ensure_idle(self) -> None:
        # ponytail: one local user; use per-user execution limits for a shared server.
        if any(run.task is not None and not run.task.done() for run in self._runs.values()):
            raise ReviewAlreadyRunningError("a review is already running")

    def record(self, run_id: str) -> ReviewRecord:
        run = self.get(run_id)
        if run.response is None or run.response.status is ReviewStatus.CANCELLED:
            raise RuntimeError("no completed review record")
        return ReviewRecord(
            runId=run.runId, createdAt=run.createdAt,
            document=run.document, materials=run.materials,
            previousReview=run.previousReview,
            moduleResults=CompletedModules.model_validate({
                key: result.model_dump() for key, result in run.moduleResults.items()
            }),
            response=run.response,
        )

    def restore_retry(self, record: ReviewRecord, module_key: str) -> str:
        self._ensure_idle()
        modules = {
            key: result for key in type(record.moduleResults).model_fields
            if (result := getattr(record.moduleResults, key)) is not None
        }
        if module_key not in modules:
            raise ValueError("module has no saved input")
        run_id = str(uuid4())
        run = ReviewRun(
            runId=run_id, document=record.document, materials=record.materials,
            previousReview=record.previousReview, moduleResults=modules,
        )
        self._runs[run_id] = run
        run.task = asyncio.create_task(self._retry(run, module_key))
        return run_id

    def release(self, run_id: str) -> None:
        run = self._runs.get(run_id)
        if run is None:
            return
        if run.task and not run.task.done():
            raise RuntimeError("review is still running")
        del self._runs[run_id]

    async def _notify(self, run: ReviewRun) -> None:
        async with run.changed:
            run.changed.notify_all()

    async def _progress(self, run: ReviewRun, event: str, message: str) -> None:
        run.progressEvents.append(ProgressEvent(event=event, message=message))
        await self._notify(run)

    async def _module(self, run: ReviewRun, result: ModuleResult[Any]) -> None:
        run.moduleResults[result.moduleKey] = result
        await self._notify(run)

    async def _execute(self, run: ReviewRun) -> None:
        try:
            outcome = await ReviewOrchestrator(self.gateway).run(
                run.document,
                run.materials,
                previous_review=run.previousReview,
                on_progress=lambda event, message: self._progress(run, event, message),
                on_module=lambda result: self._module(run, result),
            )
            run.response = outcome.response
            await self._progress(run, "completed", "이력서 검토가 완료되었습니다.")
        except asyncio.CancelledError:
            run.response = ReviewResponse(status=ReviewStatus.CANCELLED, errors=[], materialReviews=[], results=[])
            await self._progress(run, "cancelled", "이력서 검토를 취소했습니다.")

    def get(self, run_id: str) -> ReviewRun:
        try:
            return self._runs[run_id]
        except KeyError as error:
            raise KeyError("review run not found") from error

    async def wait(self, run_id: str) -> ReviewResponse:
        run = self.get(run_id)
        if run.task:
            await run.task
        if run.response is None:
            raise RuntimeError("review run has no response")
        return run.response

    def cancel(self, run_id: str) -> None:
        run = self.get(run_id)
        run.cancelRequested = True
        if run.task and not run.task.done():
            run.task.cancel()

    def events(self, run_id: str) -> list[ProgressEvent]:
        return list(self.get(run_id).progressEvents)

    async def stream_events(self, run_id: str):
        run = self.get(run_id)
        index = 0
        terminal = {"completed", "cancelled"}
        while True:
            async with run.changed:
                await run.changed.wait_for(lambda: len(run.progressEvents) > index)
                pending = run.progressEvents[index:]
                index = len(run.progressEvents)
            for event in pending:
                yield event
            if pending[-1].event in terminal:
                return

    def retry(self, run_id: str, module_key: str) -> None:
        self._ensure_idle()
        run = self.get(run_id)
        if module_key not in {
            "spellCheck",
            "companyContextAnalysis",
            "jobPostingAnalysis",
            "finalReview",
        }:
            raise ValueError("module cannot be retried")
        run.cancelRequested = False
        run.response = None
        run.progressEvents.clear()
        run.task = asyncio.create_task(self._retry(run, module_key))

    async def _retry(self, run: ReviewRun, module_key: str) -> None:
        try:
            if module_key != "finalReview":
                await self._progress(run, module_key, "선택한 검토 모듈을 다시 실행하고 있습니다.")
                result = await self._retry_module(run, module_key)
                run.moduleResults[module_key] = result
            preliminary = [
                result
                for key, result in run.moduleResults.items()
                if key != "finalReview"
            ]
            await self._progress(run, "finalReview", "수정 제안을 다시 종합하고 있습니다.")
            final = await self.gateway.final_review(run.document, preliminary, run.previousReview, run.materials)
            run.moduleResults["finalReview"] = final
            run.response = build_outcome(run.document, preliminary, final, run.materials).response
            await self._progress(run, "completed", "이력서 재검토가 완료되었습니다.")
        except asyncio.CancelledError:
            run.response = ReviewResponse(status=ReviewStatus.CANCELLED, errors=[], materialReviews=[], results=[])
            await self._progress(run, "cancelled", "이력서 검토를 취소했습니다.")

    async def _retry_module(self, run: ReviewRun, module_key: str) -> ModuleResult[Any]:
        if module_key == "spellCheck":
            return await asyncio.to_thread(check_spelling, run.document)
        material_type = (
            MaterialType.COMPANY
            if module_key == "companyContextAnalysis"
            else MaterialType.JOB_POSTING
        )
        materials = [item for item in run.materials if item.materialType is material_type]
        if not materials:
            raise ValueError("module has no input material")
        return await self.gateway.analyze_materials(module_key, materials)
