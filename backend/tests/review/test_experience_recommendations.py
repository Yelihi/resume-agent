import asyncio
import json

import pytest
from pydantic import ValidationError

from app.document_processing.flow import extract_text
from app.reference_material.models import ReferenceMaterial
from app.review.contracts import (
    AiReviewOutput, ContextAnalysis, ExperienceCandidate, ExperienceRecommendation,
    ModuleResult, ReviewContext, ReviewRecord,
)
from app.review.prompts import final_review_input
from app.review.run_manager import ReviewRunManager
from app.review.validation import assemble_review_response


def context(selected=()):
    return ReviewContext(
        contextId="workspace", resumeVersionId="resume-v1", materialVersions={"jd": "jd-v1"},
        experiences=[ExperienceCandidate(id=key, title=key, period="2025", revision=1,
            markdown="중복 요청 원인을 분석하고 재처리 방식을 개선했습니다.",
            metadata="운영 안정성: 중복 처리 문제를 분석한 경험") for key in ("selected", "other")],
        selectedExperienceIds=list(selected),
    )


def material(kind="jobPosting"):
    return ReferenceMaterial(sourceId="jd", materialType=kind, inputType="text", content="운영 안정성 개선 경험")


def recommendation(key="selected", decision="include", **changes):
    return ExperienceRecommendation.model_validate({
        "experienceId": key, "decision": decision, "reason": "공고의 운영 안정성 개선 요건과 연결됩니다.",
        "jobEvidence": [{"sourceId": "jd", "consideredPoint": "운영 안정성 개선 경험"}],
        "resumeBullets": ["중복 요청 원인을 분석하고 재처리 방식을 개선했습니다."] if decision == "include" else [],
        "placement": "프로젝트의 문제 해결 항목 보강", **changes,
    })


def review(recommendations, selected=(), materials=None):
    return assemble_review_response(extract_text("이력서"),
        AiReviewOutput(materialReviews=[], results=[], experienceRecommendations=recommendations), [],
        [material()] if materials is None else materials, context(selected))


def test_context_rejects_duplicate_foreign_and_excessive_experience_inputs():
    payload = context().model_dump()
    candidate = payload["experiences"][0]
    invalid = [
        {"experiences": [candidate, candidate]},
        {"selectedExperienceIds": ["unknown"]},
        {"selectedExperienceIds": ["selected", "selected"]},
        {"experiences": [{**candidate, "markdown": " \n"}]},
        {"experiences": [{**candidate, "revision": 0}]},
        {"experiences": [{**candidate, "metadata": "x" * 12001}]},
        {"experiences": [{**candidate, "markdown": "x" * 60001}]},
        {"experiences": [{**candidate, "id": str(i)} for i in range(101)]},
        {"experiences": [{**candidate, "id": str(i), "markdown": "x" * 60000} for i in range(10)]},
    ]
    for changes in invalid:
        with pytest.raises(ValidationError):
            ReviewContext.model_validate({**payload, **changes})


def test_manual_selection_checks_selected_and_only_suggests_others():
    response = review([recommendation(), recommendation("other", "suggest")], selected=["selected"])
    assert response.status == "success"
    assert [item.decision for item in response.experienceRecommendations] == ["include", "suggest"]
    assert response.experienceRecommendations[1].resumeBullets == []
    omitted = review([recommendation(decision="omit")], selected=["selected"])
    assert omitted.status == "success"
    assert omitted.experienceRecommendations[0].decision == "omit"


@pytest.mark.parametrize("invalid", [
    recommendation("other"),
    recommendation("other", "omit"),
    recommendation("other", "suggest", resumeBullets=["승인 전 작성된 문구"]),
    recommendation("unknown", "suggest"),
    recommendation("other", "suggest", jobEvidence=[]),
    recommendation("other", "suggest", jobEvidence=[{"sourceId": "unknown", "consideredPoint": "요건"}]),
    recommendation("other", "suggest", jobEvidence=[{"sourceId": "jd", "consideredPoint": " "}]),
])
def test_manual_mode_rejects_unapproved_writing_and_bad_evidence(invalid):
    response = review([recommendation(), invalid], selected=["selected"])
    assert response.status == "partial"
    assert [item.experienceId for item in response.experienceRecommendations] == ["selected"]
    assert response.errors[0].errorCode == "INVALID_EXPERIENCE_RECOMMENDATION"


@pytest.mark.parametrize("items", [[], [recommendation(decision="suggest")],
    [recommendation(), recommendation()], [recommendation(resumeBullets=[])],
    [recommendation(resumeBullets=[" "])], [recommendation(placement=" ")],
    [recommendation(decision="omit", resumeBullets=["생략된 경험 문구"])]])
def test_selected_experiences_cannot_silently_disappear(items):
    response = review(items, selected=["selected"])
    assert response.status == "partial"
    assert response.experienceRecommendations == []
    assert any(error.errorCode == "MISSING_EXPERIENCE_RECOMMENDATION" for error in response.errors)


def test_auto_selection_and_no_jd_or_no_candidates():
    response = review([recommendation("other")])
    assert response.status == "success"
    assert response.experienceRecommendations[0].resumeBullets
    for materials in ([], [material("company")]):
        assert review([], selected=["selected"], materials=materials).status == "success"
        assert review([recommendation()], materials=materials).experienceRecommendations == []
    raw = AiReviewOutput(materialReviews=[], results=[], experienceRecommendations=[recommendation()])
    assert assemble_review_response(extract_text("이력서"), raw, [], [material()]).experienceRecommendations == []
    assert review([recommendation(decision="suggest")]).experienceRecommendations == []


def test_prompt_carries_candidate_facts_and_approval_rules():
    messages = final_review_input(extract_text("이력서"), [], materials=[material()], review_context=context(["selected"]))
    payload = json.loads(messages[1]["content"].split("\n", 1)[1])
    assert payload["reviewContext"]["experiences"] == [item.model_dump() for item in context().experiences]
    assert payload["reviewContext"]["selectedExperienceIds"] == ["selected"]
    assert "선택하지 않은 다른 경험은 decision=suggest로만" in messages[0]["content"]
    assert "metadata는 검색·해석을 돕는 추론이며 사실의 근거가 아니다" in messages[0]["content"]


def test_recommendations_survive_record_transport_and_retry():
    class Gateway:
        async def analyze_materials(self, module_key, materials):
            return ModuleResult(moduleKey=module_key, output=ContextAnalysis(summary="운영 안정성", evidence=[]), errors=[])

        async def final_review(self, document, modules, previous_review, materials, review_context=None):
            assert review_context == context(["selected"])
            return ModuleResult(moduleKey="finalReview", output=AiReviewOutput(materialReviews=[], results=[],
                experienceRecommendations=[recommendation(), recommendation("other", "suggest")]), errors=[])

    async def scenario():
        manager = ReviewRunManager(Gateway())
        run_id = manager.start(extract_text("이력서"), [material()], review_context=context(["selected"]))
        first = await manager.wait(run_id)
        record = ReviewRecord.model_validate_json(manager.record(run_id).model_dump_json())
        assert record.response.experienceRecommendations == first.experienceRecommendations
        assert len(first.experienceRecommendations) == 2
        manager.release(run_id)
        restored = ReviewRunManager(Gateway())
        retry_id = restored.restore_retry(record, "finalReview")
        assert (await restored.wait(retry_id)).experienceRecommendations == first.experienceRecommendations
    asyncio.run(scenario())
