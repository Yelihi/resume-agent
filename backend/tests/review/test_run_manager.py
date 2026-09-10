import asyncio

from app.document_processing.flow import extract_text
from app.document_processing.models import ModuleErrorDTO
from app.reference_material.models import MaterialType, ReferenceMaterial
from app.review.contracts import AiReviewOutput, ModuleResult, ReviewStatus
from app.review.openai_gateway import ContextAnalysis
from app.review.run_manager import ReviewRunManager


class LifecycleGateway:
    def __init__(self, *, block_final: bool = False, fail_company_once: bool = False) -> None:
        self.block_final = block_final
        self.fail_company_once = fail_company_once
        self.final_started = asyncio.Event()
        self.final_cancelled = False
        self.calls: list[str] = []

    async def analyze_materials(self, module_key: str, materials: list[ReferenceMaterial]):
        self.calls.append(module_key)
        if module_key == "companyContextAnalysis" and self.fail_company_once:
            self.fail_company_once = False
            return ModuleResult(
                moduleKey=module_key,
                output=None,
                errors=[
                    ModuleErrorDTO(
                        moduleKey=module_key,
                        inputSourceId=None,
                        errorCode="TEMPORARY",
                        userMessage="잠시 실패했습니다.",
                        canRetry=True,
                    )
                ],
            )
        return ModuleResult(
            moduleKey=module_key,
            output=ContextAnalysis(summary="분석", evidence=[]),
            errors=[],
        )

    async def final_review(self, document, module_results, previous_review=None, materials=None):
        self.calls.append("finalReview")
        self.final_started.set()
        if self.block_final:
            try:
                await asyncio.Event().wait()
            except asyncio.CancelledError:
                self.final_cancelled = True
                raise
        return ModuleResult(moduleKey="finalReview", output=AiReviewOutput(materialReviews=[], results=[]), errors=[])


def company_material() -> ReferenceMaterial:
    return ReferenceMaterial(
        sourceId="company",
        materialType=MaterialType.COMPANY,
        inputType="text",
        content="회사 자료",
    )


def test_cancel_stops_in_flight_request_and_returns_cancelled() -> None:
    async def scenario() -> None:
        gateway = LifecycleGateway(block_final=True)
        manager = ReviewRunManager(gateway)
        run_id = manager.start(extract_text("문장"), [])
        await gateway.final_started.wait()

        manager.cancel(run_id)
        response = await manager.wait(run_id)

        assert gateway.final_cancelled is True
        assert response.status is ReviewStatus.CANCELLED
        assert response.results == []

    asyncio.run(scenario())


def test_progress_events_use_fixed_phases_and_terminal_event() -> None:
    async def scenario() -> None:
        manager = ReviewRunManager(LifecycleGateway())
        run_id = manager.start(extract_text("문장"), [company_material()])
        await manager.wait(run_id)

        events = manager.events(run_id)
        assert [event.event for event in events] == [
            "spellCheck",
            "referenceAnalysis",
            "finalReview",
            "completed",
        ]
        assert all(event.message for event in events)

    asyncio.run(scenario())


def test_final_retry_reuses_preliminary_results() -> None:
    async def scenario() -> None:
        gateway = LifecycleGateway()
        manager = ReviewRunManager(gateway)
        run_id = manager.start(extract_text("문장"), [company_material()])
        await manager.wait(run_id)

        manager.retry(run_id, "finalReview")
        response = await manager.wait(run_id)

        assert response.status is ReviewStatus.SUCCESS
        assert gateway.calls.count("companyContextAnalysis") == 1
        assert gateway.calls.count("finalReview") == 2

    asyncio.run(scenario())


def test_retry_stream_does_not_replay_previous_completion() -> None:
    async def scenario() -> None:
        manager = ReviewRunManager(LifecycleGateway())
        run_id = manager.start(extract_text("문장"), [])
        await manager.wait(run_id)

        manager.retry(run_id, "finalReview")
        events = [event async for event in manager.stream_events(run_id)]

        assert [event.event for event in events] == ["finalReview", "completed"]

    asyncio.run(scenario())


def test_module_retry_replaces_error_then_reruns_final_only() -> None:
    async def scenario() -> None:
        gateway = LifecycleGateway(fail_company_once=True)
        manager = ReviewRunManager(gateway)
        run_id = manager.start(extract_text("문장"), [company_material()])
        first = await manager.wait(run_id)
        assert first.status is ReviewStatus.PARTIAL

        manager.retry(run_id, "companyContextAnalysis")
        second = await manager.wait(run_id)

        assert second.status is ReviewStatus.SUCCESS
        assert second.errors == []
        assert gateway.calls.count("companyContextAnalysis") == 2
        assert gateway.calls.count("finalReview") == 2

    asyncio.run(scenario())


def test_record_round_trip_reuses_saved_modules_in_a_new_manager() -> None:
    from app.review.contracts import ReviewRecord

    async def scenario() -> None:
        original = ReviewRunManager(LifecycleGateway(fail_company_once=True))
        run_id = original.start(extract_text("문장"), [company_material()])
        await original.wait(run_id)
        saved = ReviewRecord.model_validate_json(original.record(run_id).model_dump_json())
        original.release(run_id)

        gateway = LifecycleGateway()
        restarted = ReviewRunManager(gateway)
        restored_id = restarted.restore_retry(saved, "companyContextAnalysis")
        response = await restarted.wait(restored_id)
        assert response.status is ReviewStatus.SUCCESS
        assert gateway.calls == ["companyContextAnalysis", "finalReview"]

        saved_again = ReviewRecord.model_validate_json(restarted.record(restored_id).model_dump_json())
        fresh_gateway = LifecycleGateway()
        fresh = ReviewRunManager(fresh_gateway)
        retry_id = fresh.restore_retry(saved_again, "finalReview")
        assert (await fresh.wait(retry_id)).status is ReviewStatus.SUCCESS
        assert fresh_gateway.calls == ["finalReview"]
        assert fresh.get(retry_id).document == saved.document
        assert fresh.get(retry_id).materials == saved.materials

    asyncio.run(scenario())
