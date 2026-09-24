import pytest
from pydantic import ValidationError

from app.document_processing.flow import extract_text
from app.review.api import FlowReviewRequest
from app.review.contracts import AiReviewOutput, ReviewContext, SuggestionDTO
from app.review.prompts import final_review_input
from app.review.validation import assemble_review_response


def suggestion(**changes):
    return SuggestionDTO.model_validate({
        "수정포인트위치": {"lineIds": ["f-l1"], "quote": "개인 역할을 설명했습니다."},
        "수정성격": "근거", "검토출처": ["기본 검토"], "검토자료근거": [],
        "이유 및 제안": "본인 역할을 설명하세요.", "실제 수정 예시": "개인 역할을 설명했습니다.",
        **changes,
    })


def context(decision="resolve"):
    return ReviewContext.model_validate({
        "contextId": "context-a", "resumeVersionId": "version-2", "materialVersions": {},
        "previousReviewId": "review-1", "feedback": [{
            "id": "suggestion-1", "contextId": "context-a", "reviewId": "review-1",
            "decision": decision, "rating": "up", "suggestion": suggestion().model_dump(by_alias=True),
        }], "resolved": [],
    })


def test_context_contract_rejects_foreign_duplicate_and_undecided_feedback():
    payload = context().model_dump()
    for field, value in [("contextId", "other"), ("decision", "open")]:
        invalid = {**payload, "feedback": [{**payload["feedback"][0], field: value}]}
        with pytest.raises(ValidationError):
            ReviewContext.model_validate(invalid)
    with pytest.raises(ValidationError):
        ReviewContext.model_validate({**payload, "feedback": payload["feedback"] * 2})
    with pytest.raises(ValidationError):
        FlowReviewRequest.model_validate({"document": extract_text("내용").model_dump(),
            "materials": [], "reviewContext": {**payload, "materialVersions": {"missing": "v1"}}})


def test_resolved_is_removed_and_skip_has_no_result_message():
    document = extract_text("개인 역할을 설명했습니다.")
    raw = AiReviewOutput.model_validate({"materialReviews": [], "results": [
        suggestion(previousSuggestionId="suggestion-1").model_dump(by_alias=True)],
        "resolutionChecks": [{"suggestionId": "suggestion-1", "status": "resolved",
            "reason": "본인 역할이 명시되어 있습니다.",
            "evidence": {"lineIds": ["f-l1"], "quote": "개인 역할을 설명했습니다."}}]})
    response = assemble_review_response(document, raw, [], [], context())
    assert response.results == []
    assert response.resolutionChecks[0].status == "resolved"
    skipped = assemble_review_response(document, raw, [], [], context("skip"))
    assert skipped.results == []
    assert skipped.resolutionChecks == []


def test_missing_duplicate_or_invalid_proof_never_resolves():
    document = extract_text("개인 역할을 설명했습니다.")
    check = {"suggestionId": "suggestion-1", "status": "resolved", "reason": "확인",
             "evidence": {"lineIds": ["unknown"], "quote": "없는 원문"}}
    for checks in [[], [check], [check, check], [{**check, "suggestionId": "foreign"}]]:
        raw = AiReviewOutput.model_validate({"materialReviews": [], "results": [], "resolutionChecks": checks})
        response = assemble_review_response(document, raw, [], [], context())
        assert response.status == "partial"
        assert response.resolutionChecks[0].status == "uncertain"
        assert response.errors


def test_continuing_suggestion_retains_link_and_new_suggestion_gets_server_id():
    document = extract_text("개인 역할을 설명했습니다.")
    raw = AiReviewOutput.model_validate({"materialReviews": [], "results": [
        suggestion(previousSuggestionId="suggestion-1").model_dump(by_alias=True)],
        "resolutionChecks": [{"suggestionId": "suggestion-1", "status": "notApplied",
                              "reason": "역할의 범위가 모호합니다.", "evidence": None}]})
    response = assemble_review_response(document, raw, [], [], context())
    assert len(response.results) == 1
    assert response.results[0].id
    assert response.results[0].previousSuggestionId == "suggestion-1"


def test_review_prompt_carries_scoped_feedback_without_old_positions():
    messages = final_review_input(extract_text("새 원문"), [], review_context=context())
    import json
    payload = json.loads(messages[1]["content"].split("\n", 1)[1])
    memory = payload["reviewContext"]["feedback"][0]
    assert memory["id"] == "suggestion-1"
    assert memory["rating"] == "up"
    assert memory["decision"] == "resolve"
    assert "lineIds" not in json.dumps(memory)


def test_context_survives_completed_record_and_retry_without_server_history():
    import asyncio
    from app.review.contracts import ModuleResult
    from app.review.run_manager import ReviewRunManager

    class Gateway:
        async def final_review(self, document, modules, previous_review, materials, review_context=None):
            assert review_context == context("skip")
            return ModuleResult(moduleKey="finalReview", output=AiReviewOutput(materialReviews=[], results=[]), errors=[])

    async def scenario():
        first = ReviewRunManager(Gateway())
        run = first.start(extract_text("새 원문"), [], review_context=context("skip"))
        await first.wait(run)
        record = first.record(run)
        first.release(run)
        restored = ReviewRunManager(Gateway())
        retry = restored.restore_retry(record, "finalReview")
        assert (await restored.wait(retry)).status == "success"
        assert restored.record(retry).reviewContext == record.reviewContext
    asyncio.run(scenario())
