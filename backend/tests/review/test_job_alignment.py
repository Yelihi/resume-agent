from app.document_processing.flow import extract_text
from app.reference_material.models import ReferenceMaterial
from app.review.contracts import AiReviewOutput, ReviewContext
from app.review.validation import assemble_review_response

JD = ReferenceMaterial(sourceId="job", materialType="jobPosting", inputType="text",
                       content="필수: 서비스 운영 경험\n우대: 장애 대응")
DOC = extract_text("로그 분석을 담당했다.")
CONTEXT = ReviewContext(contextId="ctx", resumeVersionId="v1", materialVersions={"job": "j1"},
    experiences=[dict(id="exp", title="운영", period="2024", revision=2,
                      markdown="운영 로그를 점검했다.", metadata="장애 복구 전문가")])
ROW = dict(sourceId="job", requirement="서비스 운영 경험", status="unconfirmed", reason="입력된 자료의 운영 경험을 확인합니다.",
           resumeEvidence=[], experienceEvidence=[])


def evaluate(rows, materials=None):
    raw = AiReviewOutput(results=[], materialReviews=[], requirementAssessments=rows)
    return assemble_review_response(DOC, raw, [], [JD] if materials is None else materials, CONTEXT)


def test_no_job_produces_no_alignment_even_if_model_invents_one():
    assert evaluate([], []).requirementAssessments == []
    assert evaluate([ROW], []).requirementAssessments == []


def test_missing_evidence_is_a_requirement_without_an_invented_resume_location():
    result = evaluate([ROW])
    assert result.requirementAssessments[0].status == "unconfirmed"
    assert result.results == result.experienceRecommendations == []


def test_partial_coverage_can_link_both_sources_without_recommending_a_bullet():
    row = dict(ROW, status="partial", resumeEvidence=[dict(lineIds=["f-l1"], quote=DOC.text)],
               experienceEvidence=[dict(experienceId="exp", revision=2, quote="운영 로그를 점검했다.")])
    result = evaluate([row])
    assert result.requirementAssessments[0].model_dump() == row
    assert result.results == result.experienceRecommendations == []


def test_rejects_unsupported_rating_stale_revision_metadata_wrong_line_and_fake_requirement():
    for row in [dict(ROW, status="matched"), dict(ROW, requirement="팀 리딩"),
                dict(ROW, status="partial", resumeEvidence=[dict(lineIds=["f-l2"], quote=DOC.text)]),
                *[dict(ROW, status="matched", experienceEvidence=[dict(experienceId="exp", revision=r, quote=q)])
                  for r, q in [(1, "운영 로그를 점검했다."), (2, "장애 복구 전문가")]]]:
        result = evaluate([row])
        assert not result.requirementAssessments and result.status == "partial"


def test_catalog_coverage_reports_omissions_without_guessing_a_rating():
    from app.review.contracts import ContextEvidence
    raw = AiReviewOutput(results=[], materialReviews=[], requirementAssessments=[ROW, ROW])
    catalog = [ContextEvidence(sourceId="job", statement=req) for req in [ROW["requirement"], "장애 대응"]]
    result = assemble_review_response(DOC, raw, [], [JD], CONTEXT, catalog)
    assert [r.requirement for r in result.requirementAssessments] == [ROW["requirement"]]
    assert {e.errorCode for e in result.errors} == {"MISSING_REQUIREMENT_ASSESSMENT", "INVALID_REQUIREMENT_ASSESSMENT"}
