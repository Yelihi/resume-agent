import asyncio

from app.document_processing.flow import extract_text
from app.document_processing.models import ModuleErrorDTO
from app.reference_material.models import MaterialType, ReferenceMaterial
from app.review.contracts import (
    AiReviewOutput,
    ModuleResult,
    ReviewStatus,
    SuggestionDTO,
    SuggestionLocation,
)
from app.review.openai_gateway import ContextAnalysis
from app.review.orchestrator import ReviewOrchestrator


class AcceptanceGateway:
    def __init__(self, *, context_failure: bool = False, final_failure: bool = False) -> None:
        self.context_failure = context_failure
        self.final_failure = final_failure

    async def analyze_materials(self, module_key, materials):
        if self.context_failure:
            return ModuleResult(
                moduleKey=module_key,
                output=None,
                errors=[
                    ModuleErrorDTO(
                        moduleKey=module_key,
                        inputSourceId=materials[0].sourceId,
                        errorCode="SOURCE_FAILED",
                        userMessage="자료를 확인하지 못했습니다.",
                        canRetry=True,
                    )
                ],
            )
        return ModuleResult(
            moduleKey=module_key,
            output=ContextAnalysis(summary="회사 분석", evidence=[]),
            errors=[],
        )

    async def final_review(self, document, module_results, previous_review=None, materials=None):
        if self.final_failure:
            return ModuleResult(
                moduleKey="finalReview",
                output=None,
                errors=[
                    ModuleErrorDTO(
                        moduleKey="finalReview",
                        inputSourceId=None,
                        errorCode="AI_REQUEST_FAILED",
                        userMessage="최종 검토를 완료하지 못했습니다.",
                        canRetry=True,
                    )
                ],
            )
        return ModuleResult(
            moduleKey="finalReview",
            output=AiReviewOutput(
                materialReviews=[],
                results=[
                    SuggestionDTO(
                        location=SuggestionLocation(lineIds=["f-l1"], quote="70% 개선했습니다"),
                        kind="근거",
                        reviewSources=["기본 검토"],
                        materialEvidence=[],
                        reasonAndSuggestion="측정 근거를 확인해야 합니다.",
                        example="[확인 필요: 측정 방법]을 기준으로 응답 시간을 개선했습니다.",
                    )
                ]
            ),
            errors=[],
        )


def company() -> ReferenceMaterial:
    return ReferenceMaterial(
        sourceId="company-1",
        materialType=MaterialType.COMPANY,
        inputType="text",
        content="회사 자료",
    )


def test_success_partial_and_failed_share_one_response_contract() -> None:
    document = extract_text("응답 시간을 70% 개선했습니다.")

    success = asyncio.run(ReviewOrchestrator(AcceptanceGateway()).run(document, []))
    partial = asyncio.run(
        ReviewOrchestrator(AcceptanceGateway(context_failure=True)).run(document, [company()])
    )
    failed = asyncio.run(
        ReviewOrchestrator(AcceptanceGateway(final_failure=True)).run(document, [])
    )

    assert [item.response.status for item in (success, partial, failed)] == [
        ReviewStatus.SUCCESS,
        ReviewStatus.PARTIAL,
        ReviewStatus.FAILED,
    ]
    for outcome in (success, partial, failed):
        payload = outcome.response.model_dump(mode="json", by_alias=True)
        assert set(payload) == {"status", "errors", "materialReviews", "results", "resolutionChecks", "experienceRecommendations"}


def test_ai_output_json_schema_is_strict_at_every_object() -> None:
    from openai.lib._pydantic import to_strict_json_schema
    schema = to_strict_json_schema(AiReviewOutput)

    def assert_strict(value):
        if isinstance(value, dict):
            if value.get("type") == "object":
                assert value.get("additionalProperties") is False
                assert set(value.get("required", [])) == set(value.get("properties", {}))
            for child in value.values():
                assert_strict(child)
        elif isinstance(value, list):
            for child in value:
                assert_strict(child)

    assert_strict(schema)
