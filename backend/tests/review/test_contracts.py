import pytest
import unicodedata
from pydantic import ValidationError

from app.document_processing.flow import extract_text
from app.review.contracts import (
    AiReviewOutput,
    MaterialEvidence,
    MaterialReviewDTO,
    ReviewStatus,
    SuggestionDTO,
    SuggestionLocation,
)
from app.reference_material.models import MaterialType, ReferenceMaterial
from app.review.validation import assemble_review_response


def suggestion(*, line_ids: list[str], quote: str) -> SuggestionDTO:
    return SuggestionDTO(
        location=SuggestionLocation(lineIds=line_ids, quote=quote),
        kind="근거",
        reviewSources=["기본 검토"],
        materialEvidence=[],
        reasonAndSuggestion="성과의 근거를 확인해야 합니다.",
        example="[확인 필요: 측정 근거]를 바탕으로 응답 시간을 줄였습니다.",
    )


def test_suggestion_forbids_unknown_fields() -> None:
    payload = {
        "수정포인트위치": {"lineIds": ["f-l1"], "quote": "문장"},
        "수정성격": "근거",
        "검토출처": ["기본 검토"],
        "이유 및 제안": "이유와 제안",
        "실제 수정 예시": "수정 예시",
        "confidence": 0.9,
    }

    with pytest.raises(ValidationError):
        SuggestionDTO.model_validate(payload)


def test_suggestion_rejects_unknown_kind() -> None:
    with pytest.raises(ValidationError):
        SuggestionDTO.model_validate(
            {
                "수정포인트위치": {"lineIds": ["f-l1"], "quote": "문장"},
                "수정성격": "근거 보강",
                "검토출처": ["기본 검토"],
                "이유 및 제안": "이유와 제안",
                "실제 수정 예시": "수정 예시",
            }
        )


@pytest.mark.parametrize("line_ids", [[], ["f-l1", "f-l2", "f-l3", "f-l4"]])
def test_suggestion_location_requires_one_to_three_lines(line_ids: list[str]) -> None:
    with pytest.raises(ValidationError):
        SuggestionLocation(lineIds=line_ids, quote="문장")


def test_suggestion_location_requires_non_empty_quote() -> None:
    with pytest.raises(ValidationError):
        SuggestionLocation(lineIds=["f-l1"], quote="")


def test_suggestion_requires_review_source_tags() -> None:
    with pytest.raises(ValidationError):
        SuggestionDTO.model_validate(
            {
                "수정포인트위치": {"lineIds": ["f-l1"], "quote": "문장"},
                "수정성격": "근거",
                "이유 및 제안": "이유와 제안",
                "실제 수정 예시": "수정 예시",
            }
        )


def test_invalid_location_is_removed_and_partial_when_valid_result_remains() -> None:
    document = extract_text("캐시를 적용했습니다.\n응답 시간을 줄였습니다.")
    raw = AiReviewOutput(
        materialReviews=[],
        results=[
            suggestion(line_ids=["f-l1"], quote="캐시를 적용했습니다."),
            suggestion(line_ids=["f-l99"], quote="없는 문장"),
        ]
    )

    response = assemble_review_response(document, raw, [])

    assert response.status is ReviewStatus.PARTIAL
    assert len(response.results) == 1
    assert [error.errorCode for error in response.errors] == ["INVALID_LOCATION"]


def test_duplicate_line_ids_are_invalid() -> None:
    document = extract_text("캐시를 적용했습니다.")
    raw = AiReviewOutput(materialReviews=[], results=[suggestion(line_ids=["f-l1", "f-l1"], quote="캐시")])

    response = assemble_review_response(document, raw, [])

    assert response.status is ReviewStatus.FAILED
    assert response.results == []
    assert response.errors[0].errorCode == "INVALID_LOCATION"


def test_quote_matches_joined_lines_after_whitespace_normalization() -> None:
    document = extract_text("응답 시간을\n  20% 줄였습니다.")
    raw = AiReviewOutput(
        materialReviews=[],
        results=[
            suggestion(
                line_ids=["f-l1", "f-l2"],
                quote="응답 시간을 20% 줄였습니다.",
            )
        ]
    )

    response = assemble_review_response(document, raw, [])

    assert response.status is ReviewStatus.SUCCESS
    assert len(response.results) == 1


def test_quote_not_present_is_removed() -> None:
    document = extract_text("응답 시간을 줄였습니다.")
    raw = AiReviewOutput(materialReviews=[], results=[suggestion(line_ids=["f-l1"], quote="비용을 줄였습니다.")])

    response = assemble_review_response(document, raw, [])

    assert response.status is ReviewStatus.FAILED
    assert response.results == []
    assert response.errors[0].errorCode == "INVALID_QUOTE"


def test_canonically_equivalent_hangul_matches_without_changing_original_offsets() -> None:
    original = unicodedata.normalize("NFD", "개발 경험을 쌓았습니다.")
    document = extract_text(original)
    raw = AiReviewOutput(materialReviews=[], results=[suggestion(line_ids=["f-l1"], quote="개발 경험")])
    response = assemble_review_response(document, raw, [])
    assert response.status is ReviewStatus.SUCCESS
    assert document.text == original
    assert document.blocks[0].lines[0].endOffset == len(original)


@pytest.mark.parametrize("quote", ["비용 20% 절감", "비용 10% 증가", "비용 10 절감"])
def test_normalization_never_accepts_changed_numbers_meaning_or_units(quote) -> None:
    document = extract_text("비용 10% 절감")
    raw = AiReviewOutput(materialReviews=[], results=[suggestion(line_ids=["f-l1"], quote=quote)])
    assert assemble_review_response(document, raw, []).errors[0].errorCode == "INVALID_QUOTE"


def test_intentionally_empty_results_are_success() -> None:
    document = extract_text("수정할 점이 없습니다.")

    response = assemble_review_response(document, AiReviewOutput(materialReviews=[], results=[]), [])

    assert response.status is ReviewStatus.SUCCESS
    assert response.results == []
    assert response.errors == []


def test_unknown_material_reference_is_not_exposed() -> None:
    document = extract_text("React를 사용했습니다.")
    item = suggestion(line_ids=["f-l1"], quote="React를 사용했습니다.")
    item.materialEvidence = [MaterialEvidence(sourceId="made-up", consideredPoint="React 요구")]
    raw = AiReviewOutput(
        materialReviews=[
            MaterialReviewDTO(
                sourceId="made-up",
                materialType=MaterialType.JOB_POSTING,
                status="applied",
                reason="반영했습니다.",
            )
        ],
        results=[item],
    )
    materials = [
        ReferenceMaterial(
            sourceId="job-1",
            materialType=MaterialType.JOB_POSTING,
            inputType="text",
            content="React 경험을 요구합니다.",
        )
    ]

    response = assemble_review_response(document, raw, [], materials)

    assert response.results == []
    assert response.materialReviews == []
    assert {error.errorCode for error in response.errors} == {"INVALID_MATERIAL_REFERENCE"}


@pytest.mark.parametrize("legacy", [False, True])
def test_feedback_length_limit_applies_to_current_and_legacy_requests(legacy):
    from app.review.contracts import PreviousReview, ReviewContext

    model = PreviousReview if legacy else ReviewContext
    fields = {"results": []} if legacy else {"contextId": "c", "resumeVersionId": "v"}
    assert model(**fields, userFeedback="가" * 2000).userFeedback == "가" * 2000
    with pytest.raises(ValidationError):
        model(**fields, userFeedback="가" * 2001)
