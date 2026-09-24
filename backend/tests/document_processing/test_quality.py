import pytest
from app.document_processing.flow import extract_text
from app.document_processing.models import ExtractionIssue
from app.document_processing.quality import assess_document, require_reviewable
from app.review.api import FlowReviewRequest


def test_assessment_reports_positions_and_requires_explicit_confirmation():
    document = assess_document(extract_text("정상 문장\nAI\x00깨짐"))
    assert document.extraction.status == "needs_review"
    assert document.extraction.issues[0].lineIds == ["f-l2"]
    assert document.extraction.issues[0].stage == "assessment"
    with pytest.raises(ValueError, match="확인"):
        FlowReviewRequest(document=document)
    document.extraction.confirmed = True
    require_reviewable(document)
    assert assess_document(document).extraction.confirmed


def test_recovered_and_unresolved_findings_are_distinct_and_assessment_is_idempotent():
    issue = ExtractionIssue(stage="recovery", code="DISPLAY_TEXT_RETRY", message="재추출", pageNumber=1, recovered=True)
    document = assess_document(extract_text("개발 경험"), [issue])
    assert document.extraction.status == "recovered"
    assert assess_document(document) == document
    assert assess_document(extract_text("개발 경험")).extraction.status == "complete"
    issue.recovered = False
    assert assess_document(extract_text("개발 경험"), [issue]).extraction.status == "needs_review"
