import asyncio
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from pydantic import BaseModel, ConfigDict

from app.deployment.auth import User
from app.deployment.jobs import watch_user

from app.document_processing.models import FlowDocument, ModuleErrorDTO, PageDocument
from app.reference_material.models import MaterialType, ReferenceMaterial

from .contracts import ModuleResult, PreviousReview, ReviewResponse, ReviewStatus, ReviewRecord, CompletedModules, ReviewContext
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
    ownerId: str | None = None
    ownerUser: User | None = None
    gateway: ReviewGateway | None = None
    finish: Callable[["ReviewRun"], Awaitable[None]] | None = None
    started: bool = False
    createdAt: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    previousReview: PreviousReview | None = None
    reviewContext: ReviewContext | None = None
    moduleResults: dict[str, ModuleResult[Any]] = field(default_factory=dict)
    progressEvents: list[ProgressEvent] = field(default_factory=list)
    response: ReviewResponse | None = None
    task: asyncio.Task[None] | None = None
    cancelRequested: bool = False
    changed: asyncio.Condition = field(default_factory=asyncio.Condition)


class ReviewRunManager:
    def __init__(self, gateway: ReviewGateway | None) -> None:
        self.gateway = gateway
        self._runs: dict[str, ReviewRun] = {}

    async def shutdown(self) -> None:
        runs = list(self._runs.values())
        for run in runs:
            if run.task and not run.task.done():
                self.cancel(run.runId)
        await asyncio.gather(*(run.task for run in runs if run.task), return_exceptions=True)
        if self.gateway is not None:
            client = getattr(self.gateway, "client", None)
            if client is not None:
                await client.close()

    def start(
        self,
        document: PageDocument | FlowDocument,
        materials: list[ReferenceMaterial],
        previous_review: PreviousReview | None = None,
        review_context: ReviewContext | None = None,
        *, owner_id: str | None = None, owner_user: User | None = None, gateway: ReviewGateway | None = None,
        finish: Callable[[ReviewRun], Awaitable[None]] | None = None,
    ) -> str:
        self._ensure_idle()
        run_id = str(uuid4())
        run = ReviewRun(
            runId=run_id, ownerId=owner_id, ownerUser=owner_user, gateway=gateway, finish=finish,
            document=document,
            materials=materials,
            previousReview=previous_review, reviewContext=review_context,
        )
        self._runs[run_id] = run
        run.task = asyncio.create_task(self._run(run))
        return run_id

    def _prune(self) -> None:
        # Completed server runs are replayable for one hour, up to 100 recent runs.
        now = datetime.now(timezone.utc)
        completed = [run for run in self._runs.values() if run.ownerId and run.task and run.task.done()]
        for index, run in enumerate(completed):
            if (now - run.createdAt).total_seconds() > 3600 or index < len(completed) - 100:
                del self._runs[run.runId]

    def _ensure_idle(self) -> None:
        self._prune()
        if any(run.task is not None and not run.task.done() for run in self._runs.values()):
            raise ReviewAlreadyRunningError("a review is already running")

    def record(self, run_id: str) -> ReviewRecord:
        run = self.get(run_id)
        if run.response is None or run.response.status is ReviewStatus.CANCELLED:
            raise RuntimeError("no completed review record")
        return ReviewRecord(
            runId=run.runId, createdAt=run.createdAt,
            document=run.document, materials=run.materials,
            previousReview=run.previousReview, reviewContext=run.reviewContext,
            moduleResults=CompletedModules.model_validate({
                key: result.model_dump() for key, result in run.moduleResults.items()
            }),
            response=run.response,
        )

    def restore_retry(self, record: ReviewRecord, module_key: str, *,
                      owner_id: str | None = None, owner_user: User | None = None, gateway: ReviewGateway | None = None,
                      finish: Callable[[ReviewRun], Awaitable[None]] | None = None) -> str:
        self._ensure_idle()
        modules = {
            key: result for key in type(record.moduleResults).model_fields
            if (result := getattr(record.moduleResults, key)) is not None
        }
        if module_key not in modules:
            raise ValueError("module has no saved input")
        run_id = str(uuid4())
        run = ReviewRun(
            runId=run_id, ownerId=owner_id, ownerUser=owner_user, gateway=gateway, finish=finish,
            document=record.document, materials=record.materials,
            previousReview=record.previousReview, reviewContext=record.reviewContext, moduleResults=modules,
        )
        self._runs[run_id] = run
        run.task = asyncio.create_task(self._run(run, module_key))
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

    async def _run(self, run: ReviewRun, module_key: str | None = None) -> None:
        run.started = True
        event, message = "completed", "이력서 검토가 완료되었습니다."
        try:
            if run.cancelRequested:
                raise asyncio.CancelledError
            async with watch_user(run.ownerUser or (User(run.ownerId, "") if run.ownerId else None)), asyncio.timeout(300):
                if module_key:
                    await self._retry(run, module_key)
                else:
                    outcome = await ReviewOrchestrator(run.gateway or self.gateway).run(
                        run.document, run.materials, previous_review=run.previousReview,
                        review_context=run.reviewContext,
                        on_progress=lambda event, message: self._progress(run, event, message),
                        on_module=lambda result: self._module(run, result),
                    )
                    run.response = outcome.response
        except asyncio.CancelledError:
            run.response = ReviewResponse(status=ReviewStatus.CANCELLED, errors=[], materialReviews=[], results=[])
            event, message = "cancelled", "이력서 검토를 취소했습니다."
        except Exception:
            logging.getLogger("resume_agent.review").warning("Review execution failed")
            self._failure(run)
        try:
            if run.finish:
                await run.finish(run)
        except Exception:
            logging.getLogger("resume_agent.review").warning("Review persistence failed")
            self._failure(run)
            event, message = "failed", "검토 결과를 저장하지 못했습니다. 다시 시도해 주세요."
        finally:
            run.gateway = None
            run.finish = None
            run.ownerUser = None
        await self._progress(run, event, message)

    def _failure(self, run: ReviewRun) -> None:
        keys = ["spellCheck", "finalReview"]
        for kind, key in ((MaterialType.COMPANY, "companyContextAnalysis"),
                          (MaterialType.JOB_POSTING, "jobPostingAnalysis")):
            if any(item.materialType is kind for item in run.materials):
                keys.append(key)
        for key in keys:
            if key not in run.moduleResults or key == "finalReview":
                error = ModuleErrorDTO(moduleKey=key, inputSourceId=None, errorCode="REVIEW_FAILED",
                    userMessage="검토를 완료하지 못했습니다. 다시 시도해 주세요.", canRetry=True)
                run.moduleResults[key] = ModuleResult(moduleKey=key, output=None, errors=[error])
        run.response = ReviewResponse(status=ReviewStatus.FAILED,
            errors=[error for module in run.moduleResults.values() for error in module.errors],
            materialReviews=[], results=[])

    def get(self, run_id: str) -> ReviewRun:
        self._prune()
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
        if run.started and run.response is None and run.task and not run.task.done():
            run.task.cancel()

    def events(self, run_id: str) -> list[ProgressEvent]:
        return list(self.get(run_id).progressEvents)

    async def stream_events(self, run_id: str, heartbeat: float | None = None):
        run = self.get(run_id)
        index = 0
        terminal = {"completed", "cancelled", "failed"}
        while True:
            pending = []
            async with run.changed:
                try:
                    await asyncio.wait_for(run.changed.wait_for(lambda: len(run.progressEvents) > index), heartbeat)
                    pending = run.progressEvents[index:]
                    index = len(run.progressEvents)
                except TimeoutError:
                    pass
            if not pending:
                yield ProgressEvent(event="keepalive", message="")
                continue
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
        run.started = False
        run.response = None
        run.progressEvents.clear()
        run.task = asyncio.create_task(self._run(run, module_key))

    async def _retry(self, run: ReviewRun, module_key: str) -> None:
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
        final = await (run.gateway or self.gateway).final_review(run.document, preliminary, run.previousReview, run.materials, **({"review_context": run.reviewContext} if run.reviewContext else {}))
        run.moduleResults["finalReview"] = final
        run.response = build_outcome(run.document, preliminary, final, run.materials, run.reviewContext).response

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
        return await (run.gateway or self.gateway).analyze_materials(module_key, materials)
