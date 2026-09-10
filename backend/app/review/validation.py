import re

from app.document_processing.models import FlowDocument, ModuleErrorDTO, PageDocument
from app.reference_material.models import ReferenceMaterial

from .contracts import AiReviewOutput, ReviewResponse, ReviewStatus, SuggestionDTO


def _lines(document: PageDocument | FlowDocument) -> dict[str, str]:
    if isinstance(document, PageDocument):
        return {
            line.lineId: line.text
            for page in document.pages
            for block in page.blocks
            for line in block.lines
        }
    return {line.lineId: line.text for block in document.blocks for line in block.lines}


def _normalized(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def _validation_error(code: str, message: str) -> ModuleErrorDTO:
    return ModuleErrorDTO(
        moduleKey="finalReview",
        inputSourceId=None,
        errorCode=code,
        userMessage=message,
        canRetry=True,
    )


def assemble_review_response(
    document: PageDocument | FlowDocument,
    raw: AiReviewOutput,
    module_errors: list[ModuleErrorDTO],
    materials: list[ReferenceMaterial] | None = None,
) -> ReviewResponse:
    line_text = _lines(document)
    valid: list[SuggestionDTO] = []
    errors = list(module_errors)
    known_materials = {item.sourceId: item.materialType for item in (materials or [])}
    material_reviews = []
    seen_sources: set[str] = set()
    for review in raw.materialReviews:
        if (
            review.sourceId in seen_sources
            or known_materials.get(review.sourceId) != review.materialType
        ):
            errors.append(_validation_error("INVALID_MATERIAL_REFERENCE", "검토 자료 연결을 확인할 수 없는 결과를 제외했습니다."))
            continue
        seen_sources.add(review.sourceId)
        material_reviews.append(review)

    for suggestion in raw.results:
        ids = suggestion.location.lineIds
        if not ids or len(ids) != len(set(ids)) or any(line_id not in line_text for line_id in ids):
            errors.append(
                _validation_error(
                    "INVALID_LOCATION",
                    "검토 결과 중 원문 위치를 확인할 수 없는 제안을 제외했습니다.",
                )
            )
            continue
        if any(entry.sourceId not in known_materials for entry in suggestion.materialEvidence):
            errors.append(_validation_error("INVALID_MATERIAL_REFERENCE", "검토 결과 중 자료 근거를 확인할 수 없는 제안을 제외했습니다."))
            continue
        quoted_lines = _normalized(" ".join(line_text[line_id] for line_id in ids))
        quote = _normalized(suggestion.location.quote)
        if not quote or quote not in quoted_lines:
            errors.append(
                _validation_error(
                    "INVALID_QUOTE",
                    "검토 결과 중 원문 인용을 확인할 수 없는 제안을 제외했습니다.",
                )
            )
            continue
        valid.append(suggestion)

    if raw.results and not valid:
        status = ReviewStatus.FAILED
    elif errors:
        status = ReviewStatus.PARTIAL
    else:
        status = ReviewStatus.SUCCESS
    return ReviewResponse(status=status, errors=errors, materialReviews=material_reviews, results=valid)
