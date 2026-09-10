import asyncio

from app.document_processing.flow import extract_text
from app.document_processing.models import ModuleErrorDTO
from app.reference_material.models import MaterialType, ReferenceMaterial
from app.review.contracts import AiReviewOutput, ModuleResult, ReviewStatus
from app.review.openai_gateway import ContextAnalysis
from app.review.orchestrator import ReviewOrchestrator


def module_error(module_key: str) -> ModuleErrorDTO:
    return ModuleErrorDTO(
        moduleKey=module_key,
        inputSourceId=None,
        errorCode="TEST_FAILURE",
        userMessage="자료 분석에 실패했습니다.",
        canRetry=True,
    )


class FakeGateway:
    def __init__(self, failures: set[str] | None = None, fail_final: bool = False) -> None:
        self.failures = failures or set()
        self.fail_final = fail_final
        self.calls: list[str] = []
        self.started: set[str] = set()
        self.both_started = asyncio.Event()

    async def analyze_materials(self, module_key: str, materials: list[ReferenceMaterial]):
        self.calls.append(module_key)
        self.started.add(module_key)
        if len(self.started) == 2:
            self.both_started.set()
        if len({item.materialType for item in materials}) == 1 and len(self.started) < 2:
            try:
                await asyncio.wait_for(self.both_started.wait(), timeout=0.2)
            except TimeoutError:
                pass
        if module_key in self.failures:
            return ModuleResult(moduleKey=module_key, output=None, errors=[module_error(module_key)])
        return ModuleResult(
            moduleKey=module_key,
            output=ContextAnalysis(summary="분석", evidence=[]),
            errors=[],
        )

    async def final_review(self, document, module_results, previous_review=None, materials=None):
        self.calls.append("finalReview")
        if self.fail_final:
            return ModuleResult(
                moduleKey="finalReview",
                output=None,
                errors=[module_error("finalReview")],
            )
        return ModuleResult(moduleKey="finalReview", output=AiReviewOutput(materialReviews=[], results=[]), errors=[])


def material(source_id: str, kind: MaterialType) -> ReferenceMaterial:
    return ReferenceMaterial(
        sourceId=source_id,
        materialType=kind,
        inputType="text",
        content="자료",
    )


def test_without_optional_materials_runs_spell_check_and_final_only() -> None:
    gateway = FakeGateway()

    outcome = asyncio.run(ReviewOrchestrator(gateway).run(extract_text("문장"), []))

    assert gateway.calls == ["finalReview"]
    assert [result.moduleKey for result in outcome.moduleResults] == ["spellCheck", "finalReview"]
    assert outcome.response.status is ReviewStatus.SUCCESS


def test_independent_material_modules_start_before_final_review() -> None:
    gateway = FakeGateway()
    materials = [
        material("company", MaterialType.COMPANY),
        material("job", MaterialType.JOB_POSTING),
    ]

    outcome = asyncio.run(ReviewOrchestrator(gateway).run(extract_text("문장"), materials))

    assert gateway.both_started.is_set()
    assert gateway.calls[-1] == "finalReview"
    assert outcome.response.status is ReviewStatus.SUCCESS


def test_optional_module_failure_still_runs_final_and_returns_partial() -> None:
    gateway = FakeGateway(failures={"companyContextAnalysis"})

    outcome = asyncio.run(
        ReviewOrchestrator(gateway).run(
            extract_text("문장"),
            [material("company", MaterialType.COMPANY)],
        )
    )

    assert gateway.calls[-1] == "finalReview"
    assert outcome.response.status is ReviewStatus.PARTIAL
    assert outcome.response.errors[0].moduleKey == "companyContextAnalysis"


def test_final_failure_returns_failed_with_empty_results() -> None:
    outcome = asyncio.run(
        ReviewOrchestrator(FakeGateway(fail_final=True)).run(extract_text("문장"), [])
    )

    assert outcome.response.status is ReviewStatus.FAILED
    assert outcome.response.results == []
    assert outcome.response.errors[0].moduleKey == "finalReview"
