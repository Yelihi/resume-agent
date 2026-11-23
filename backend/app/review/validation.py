import re
import unicodedata
from collections import Counter
from uuid import uuid4

from app.document_processing.models import FlowDocument, ModuleErrorDTO, PageDocument
from app.reference_material.models import MaterialType, ReferenceMaterial

from .writing_style import style_candidates, verified_style
from .contracts import AiReviewOutput, ReviewResponse, ReviewStatus, SuggestionDTO, ReviewContext, ResolutionCheck, ContextEvidence, RequirementAssessment


def document_lines(document: PageDocument | FlowDocument) -> dict[str, str]:
    if isinstance(document, PageDocument):
        return {
            line.lineId: line.text
            for page in document.pages
            for block in page.blocks
            for line in block.lines
        }
    return {line.lineId: line.text for block in document.blocks for line in block.lines}


def _normalized(text: str) -> str:
    return re.sub(r"\s+", " ", unicodedata.normalize("NFC", text)).strip()


def _same_issue(old: SuggestionDTO, new: SuggestionDTO) -> bool:
    if _normalized(old.location.quote) != _normalized(new.location.quote):
        return False
    if old.diagnostic and new.diagnostic:
        return old.diagnostic.ruleId == new.diagnostic.ruleId
    return old.kind == new.kind


def _validation_error(code: str, message: str) -> ModuleErrorDTO:
    return ModuleErrorDTO(
        moduleKey="finalReview",
        inputSourceId=None,
        errorCode=code,
        userMessage=message,
        canRetry=True,
    )


def validate_assessments(
    rows: list[RequirementAssessment], lines: dict[str, str], materials: list[ReferenceMaterial],
    context: ReviewContext | None, requirements: list[ContextEvidence] | None = None,
) -> tuple[list[RequirementAssessment], list[ModuleErrorDTO]]:
    if not rows and not requirements:
        return [], []
    jobs = {item.sourceId: item for item in materials if item.materialType == MaterialType.JOB_POSTING}
    selected = set(context.selectedExperienceIds) if context else set()
    experiences = {item.id: (item.revision, _normalized(item.markdown))
                   for item in (context.experiences if context else []) if not selected or item.id in selected}
    job_text = {key: _normalized(job.content) for key, job in jobs.items() if job.content}
    catalog = {(item.sourceId, _normalized(item.statement)) for item in requirements or []}
    seen = set()
    valid: list[RequirementAssessment] = []
    errors = []
    order = {line_id: index for index, line_id in enumerate(lines)}
    for row in rows:
        key = (row.sourceId, _normalized(row.requirement))
        in_catalog = key in catalog
        anchored = (row.sourceId in jobs and bool(key[1]) and (requirements is None or in_catalog)
                    and (key[1] in job_text[row.sourceId] if row.sourceId in job_text else in_catalog))
        has_evidence = bool(row.resumeEvidence or row.experienceEvidence)
        supported = has_evidence == (row.status != "unconfirmed")
        for evidence in row.resumeEvidence:
            ids = evidence.lineIds
            positions = [order.get(i, -1) for i in ids]
            quote = _normalized(evidence.quote)
            supported &= (positions[0] >= 0 and positions == list(range(positions[0], positions[0] + len(ids)))
                          and ids[0].split("-")[0] == ids[-1].split("-")[0]
                          and bool(quote) and quote in _normalized(" ".join(lines.get(i, "") for i in ids)))
        for evidence in row.experienceEvidence:
            exp = experiences.get(evidence.experienceId)
            quote = _normalized(evidence.quote)
            supported &= bool(exp and exp[0] == evidence.revision and quote and quote in exp[1])
        if not anchored or not supported or key in seen:
            errors.append(_validation_error("INVALID_REQUIREMENT_ASSESSMENT", "공고 요건이나 연결한 근거를 확인할 수 없는 평가를 제외했습니다."))
            continue
        seen.add(key)
        valid.append(row)
    if catalog - seen:
        errors.append(_validation_error("MISSING_REQUIREMENT_ASSESSMENT", "평가하지 못한 공고 요구사항이 있습니다."))
    return valid, errors


def assemble_review_response(
    document: PageDocument | FlowDocument,
    raw: AiReviewOutput,
    module_errors: list[ModuleErrorDTO],
    materials: list[ReferenceMaterial] | None = None,
    review_context: ReviewContext | None = None,
    requirements: list[ContextEvidence] | None = None,
) -> ReviewResponse:
    line_text = document_lines(document)
    valid: list[SuggestionDTO] = []
    assessments, assessment_errors = validate_assessments(raw.requirementAssessments, line_text, materials or [], review_context, requirements)
    errors = [*module_errors, *assessment_errors]
    checks: list[ResolutionCheck] = []
    feedback = {item.id: item for item in review_context.feedback} if review_context else {}
    counts = Counter(item.suggestionId for item in raw.resolutionChecks)
    if review_context:
        expected = {key for key, item in feedback.items() if item.decision == "resolve"}
        if any(item.suggestionId not in feedback for item in raw.resolutionChecks):
            errors.append(_validation_error("INVALID_RESOLUTION", "연결할 수 없는 반영 확인 결과를 제외했습니다."))
        for suggestion_id in expected:
            candidates = [item for item in raw.resolutionChecks if item.suggestionId == suggestion_id]
            check = candidates[0] if counts[suggestion_id] == 1 else None
            if check and check.evidence:
                ids = check.evidence.lineIds
                evidence_valid = len(ids) == len(set(ids)) and all(key in line_text for key in ids)
                evidence_valid = evidence_valid and bool(_normalized(check.evidence.quote)) and _normalized(check.evidence.quote) in _normalized(" ".join(line_text[key] for key in ids))
                if not evidence_valid:
                    check = None
            if check is None or (check.status == "resolved" and check.evidence is None):
                errors.append(_validation_error("INVALID_RESOLUTION", "수정 반영 여부를 확인하지 못한 제안이 있습니다."))
                check = ResolutionCheck(suggestionId=suggestion_id, status="uncertain", reason="새 원문의 근거를 확인하지 못했습니다. 다시 확인해 주세요.")
            checks.append(check)
    resolved = {item.suggestionId for item in checks if item.status == "resolved"}
    seen_previous: set[str] = set()
    intentional_omissions = 0
    known_materials = {item.sourceId: item.materialType for item in (materials or [])}
    job_sources = {key for key, kind in known_materials.items() if kind == MaterialType.JOB_POSTING}
    experiences = {item.id for item in review_context.experiences} if review_context else set()
    selected = set(review_context.selectedExperienceIds) if review_context else set()
    recommendation_counts = Counter(item.experienceId for item in raw.experienceRecommendations)
    recommendations = []
    for recommendation in raw.experienceRecommendations:
        if (
            not job_sources
            or recommendation.experienceId not in experiences
            or recommendation_counts[recommendation.experienceId] != 1
            or not recommendation.jobEvidence
            or any(item.sourceId not in job_sources or not item.consideredPoint.strip()
                   for item in recommendation.jobEvidence)
            or (selected and recommendation.experienceId not in selected and recommendation.decision != "suggest")
            or (recommendation.decision == "suggest" and (not selected or recommendation.experienceId in selected))
            or (recommendation.decision != "include" and bool(recommendation.resumeBullets))
            or (recommendation.decision == "include" and (
                not recommendation.resumeBullets
                or any(not bullet.strip() for bullet in recommendation.resumeBullets)
                or not recommendation.placement.strip()
            ))
        ):
            errors.append(_validation_error("INVALID_EXPERIENCE_RECOMMENDATION", "JD 근거 또는 경험 선택 범위를 확인할 수 없는 경험 추천을 제외했습니다."))
            continue
        recommendations.append(recommendation)
    if job_sources and selected - {item.experienceId for item in recommendations}:
        errors.append(_validation_error("MISSING_EXPERIENCE_RECOMMENDATION", "선택한 경험 중 JD 적합성을 확인하지 못한 경험이 있습니다. 다시 검토해 주세요."))
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

    style_lines: dict[str, dict[str, str]] = {}
    for candidate in style_candidates(document):
        line_id = candidate["lineId"]
        phrase = line_text[line_id][candidate["start"]:candidate["end"]]
        style_lines.setdefault(line_id, {})[candidate["ruleId"]] = phrase
    seen_styles = set()
    for suggestion in raw.results:
        ids = suggestion.location.lineIds
        if suggestion.diagnostic:
            key = (tuple(ids), suggestion.diagnostic.ruleId)
            rules = style_lines.get(ids[0], {}) if len(ids) == 1 else {}
            if suggestion.diagnostic.ruleId not in rules or suggestion.location.quote != line_text.get(ids[0]):
                errors.append(_validation_error("INVALID_STYLE_REFERENCE", "문체 후보의 위치를 확인할 수 없습니다."))
                continue
            checked = verified_style(suggestion, line_text[ids[0]])
            if checked is None or key in seen_styles:
                intentional_omissions += 1
                continue
            suggestion = checked
        previous_id = suggestion.previousSuggestionId
        if review_context:
            # Exact matches supplement explicit links; semantic duplicates remain an AI quality check.
            if previous_id is None:
                previous_id = next((key for key, item in feedback.items()
                    if _same_issue(item.suggestion, suggestion)), None)
            if previous_id and previous_id not in feedback:
                errors.append(_validation_error("INVALID_SUGGESTION_REFERENCE", "이전 제안 연결을 확인하지 못했습니다."))
                continue
            if previous_id and (feedback[previous_id].decision == "skip" or previous_id in resolved):
                intentional_omissions += 1
                continue
            if previous_id in seen_previous:
                errors.append(_validation_error("DUPLICATE_SUGGESTION", "중복된 제안을 제외했습니다."))
                continue
            if previous_id:
                seen_previous.add(previous_id)
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
        if not suggestion.diagnostic and suggestion.kind in {"뉘앙스", "가독성"} and any(
            phrase in suggestion.location.quote
            for line_id in ids for phrase in style_lines.get(line_id, {}).values()
        ):
            intentional_omissions += 1
            continue
        if suggestion.diagnostic:
            seen_styles.add((tuple(ids), suggestion.diagnostic.ruleId))
        valid.append(suggestion.model_copy(update={"id": str(uuid4()), "previousSuggestionId": previous_id}))

    if raw.results and not valid and intentional_omissions != len(raw.results):
        status = ReviewStatus.FAILED
    elif errors:
        status = ReviewStatus.PARTIAL
    else:
        status = ReviewStatus.SUCCESS
    return ReviewResponse(status=status, errors=errors, materialReviews=material_reviews, results=sorted(valid, key=lambda item: item.diagnostic is not None), resolutionChecks=checks, experienceRecommendations=recommendations, requirementAssessments=assessments)
