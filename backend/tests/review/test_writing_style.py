import json

import pytest

from app.document_processing.flow import extract_text
from app.review.contracts import AiReviewOutput, SuggestionDTO
from app.review.prompts import final_review_input
from app.review.validation import assemble_review_response


# IMG_7606: a match is a candidate, never permission to rewrite.
@pytest.mark.parametrize("rule,text", [
    ("continue", "두 절차를 이어 봅니다"), ("contrast", "복사하지 않고 공유했습니다"),
    ("structure", "권한을 검사하는 구조입니다"), ("judgment", "실패로 판정했습니다"),
    ("only", "관리자만 파일만 읽습니다"), ("result", "남는 결과를 확인합니다"),
    ("definition", "그것이 곧 기준입니다"), ("effect", "성과가 따라옵니다"),
    ("record", "감사 기록으로 남겼습니다"), ("knowledge", "제약임을 압니다"),
    ("sequence", "이 순서로 갔습니다"), ("template", "템플릿을 통해 단축했습니다"),
    ("analysis", "데이터에 대한 분석을 수행했습니다"), ("importance", "중요한 의미를 가집니다"),
    ("passive", "자동 복구되었습니다"), ("praise", "혁신적인 도구입니다"),
    ("experience", "다양한 경험이 있습니다"), ("connector", "또한 기록했습니다"),
    ("contribution", "팀의 개선에 기여했습니다"), ("dash", "원인 — 측정 결과"),
    ("emoji", "📌 경력\n📌 성과"), ("adjectives", "정확한, 빠른, 안전한 처리"),
])
def test_slide_candidate_uses_real_line(rule, text):
    messages = final_review_input(extract_text(text), [])
    data = json.loads(messages[1]["content"].split("\n", 1)[1])
    assert any(c["ruleId"] == rule and c["lineId"] == "f-l1" and c["quote"] == text.splitlines()[0]
               for c in data["styleCandidates"])


def review(text, rule, example, action="rewrite", *, quote=None, line_id="f-l1"):
    doc = extract_text(text)
    suggestion = SuggestionDTO(location={"lineIds": [line_id], "quote": quote if quote is not None else text},
        kind="가독성", reviewSources=["기본 검토"], materialEvidence=[], reasonAndSuggestion="표현 검토",
        example=example, diagnostic={"category": "writing-style", "ruleId": rule, "action": action})
    return assemble_review_response(doc, AiReviewOutput(results=[suggestion], materialReviews=[]), [])


def test_safe_contraction_preserves_subject_and_tense():
    s = review("팀이 데이터에 대한 분석을 수행했습니다.", "analysis", "팀이 데이터를 분석했습니다.")
    assert s.results[0].diagnostic.action == "rewrite"


def test_partial_style_quote_and_rewrite_use_the_original_full_line():
    text = "팀이 데이터에 대한 분석을 수행했습니다. 이후 결과를 공유했습니다."
    result = review(text, "analysis", "데이터를 분석했습니다.",
                    quote="데이터에 대한 분석을 수행했습니다.")
    assert result.status == "success" and not result.errors
    assert result.results[0].location.quote == text
    assert result.results[0].example == "팀이 데이터를 분석했습니다. 이후 결과를 공유했습니다."


def test_style_quote_with_different_spacing_preserves_the_original_line():
    text = "팀의 개선에 기여했습니다."
    result = review(text, "contribution", "[확인 필요]", action="ask", quote="팀의  개선에 기여했습니다.")
    assert result.status == "success"
    assert result.results[0].location.quote == text


def test_partial_style_rewrite_cannot_add_facts():
    result = review("팀이 데이터에 대한 분석을 수행했습니다.", "analysis", "매출을 40% 높였습니다.",
                    quote="데이터에 대한 분석을 수행했습니다.")
    assert not result.results


@pytest.mark.parametrize("quote,line_id", [
    ("팀의 개선에 기여했습니다.", "f-l2"),
    ("매출을 40% 개선했습니다.", "f-l1"),
    ("팀의 개선", "f-l1"),
])
def test_style_quote_must_be_anchored_to_the_candidate(quote, line_id):
    result = review("팀의 개선에 기여했습니다.", "contribution", "[확인 필요]", action="ask",
                    quote=quote, line_id=line_id)
    assert not result.results
    assert result.errors[0].errorCode == "INVALID_STYLE_REFERENCE"


@pytest.mark.parametrize("text,rule,unsafe", [
    ("원본을 저장하지 않고 해시만 저장했다.", "contrast", "원본도 저장했다."),
    ("팀의 개선에 기여했습니다.", "contribution", "응답 시간을 40% 줄였습니다."),
    ("학습 중 데이터에 대한 분석을 수행했습니다.", "analysis", "실무 데이터를 분석했습니다."),
    ("자동 복구되었습니다.", "passive", "제가 복구했습니다."),
    ("감사 기록으로 남겼습니다.", "record", "적었습니다."),
    ("성과가 따라옵니다.", "effect", "성과를 달성했습니다."),
])
def test_unverified_rewrite_is_never_displayed(text, rule, unsafe):
    result = review(text, rule, unsafe)
    assert all(item.example != unsafe for item in result.results)


def test_page_anchor_and_unreliable_ocr():
    from app.document_processing.models import PageDocument
    from app.review.writing_style import style_candidates
    bbox = dict(x=0, y=0, width=1, height=1)
    text = "팀의 개선에 기여했습니다."
    doc = PageDocument(pages=[dict(pageNumber=1, blocks=[dict(blockId="p1-b1", bbox=bbox, lines=[
        dict(lineId="p1-l1", bbox=bbox, text=text, textSource="ocr", uncertainWords=["개선"]),
        dict(lineId="p1-l2", bbox=bbox, text=text, textSource="embedded", uncertainWords=[])])])])
    assert [c["lineId"] for c in style_candidates(doc)] == ["p1-l2"]
    assert review(text, "contribution", "40% 단축했습니다.", action="ask").results[0].example == "[확인 필요: 근거]"


def test_unknown_rule_and_invented_location_fail_validation():
    result = review("문장을 확인했습니다.", "made-up", "새 문장")
    assert result.status == "failed" and result.errors[0].errorCode == "INVALID_STYLE_REFERENCE"


def test_repeat_detection_does_not_flag_a_single_heading_or_access_restriction():
    from app.review.writing_style import style_candidates
    assert style_candidates(extract_text("📌 권한 설정\n관리자만 접근할 수 있습니다.")) == []


@pytest.mark.parametrize("rule,source,wrong", [
    ("continue", "시험 삼아 이어 봅니다", "지속해서 이어 갑니다"),
    ("contrast", "복제하지 않고 해시만 보관", "복제한 뒤 해시를 보관"),
    ("structure", "읽기와 쓰기를 분리하는 구조입니다", "읽기입니다"),
    ("judgment", "기준에 따라 실패로 판정했습니다", "기준을 정했습니다"),
    ("only", "관리자만 결과만 읽습니다", "관리자는 결과를 읽습니다"),
    ("result", "테스트 후 남는 결과를 확인했습니다", "얻게 될 결과를 확인했습니다"),
    ("definition", "그것이 곧 종료 조건입니다", "그것으로 종료합니다"),
    ("effect", "삭제하면 로그가 따라옵니다", "성과를 낼 수 있습니다"),
    ("record", "감사 기록으로 남겼습니다", "적었습니다"),
    ("knowledge", "표본의 한계임을 압니다", "보편적인 한계임을 알 수 있습니다"),
    ("sequence", "세 지점을 이 순서로 갔습니다", "이 절차를 진행했습니다"),
    ("template", "팀이 템플릿을 통해 단축했습니다", "제가 템플릿으로 줄였습니다"),
    ("analysis", "실습에서 데이터에 대한 분석을 수행했습니다", "실무 데이터를 분석했습니다"),
    ("importance", "재현 가능성은 중요한 의미를 가집니다", "응답 시간이 중요합니다"),
    ("passive", "자동 복구되었습니다", "직접 복구했습니다"),
    ("praise", "혁신적인 기능을 제안했습니다", "효율을 40% 높였습니다"),
    ("experience", "다양한 경험을 쌓았습니다", "프로젝트 네 개를 완료했습니다"),
    ("connector", "또한 장애 대응을 도왔습니다", "장애 대응을 주도했습니다"),
    ("contribution", "팀 성과에 기여했습니다", "혼자 달성했습니다"),
    ("dash", "원본 표기 — 기호 보존", "원본 표기를 변경했습니다"),
    ("emoji", "📌 미완료", "완료"),
    ("adjectives", "정확한, 빠른, 안전한 처리가 목표입니다", "안전한 처리를 달성했습니다"),
])
def test_slide_counterexample_never_publishes_changed_fact(rule, source, wrong):
    assert not review(source, rule, wrong).results


def test_skip_uses_style_rule_even_if_model_changes_kind_and_keeps_distinct_issue():
    from app.review.contracts import ReviewContext
    text = "팀의 개선에 기여했습니다."
    styled = review(text, "contribution", "[확인 필요]", action="ask").results[0]
    context = ReviewContext(contextId="c", resumeVersionId="v", feedback=[dict(
        id="old", reviewId="r", contextId="c", decision="skip", suggestion=styled)])
    repeated = styled.model_copy(update={"kind": "뉘앙스"})
    factual = styled.model_copy(update={"kind": "근거", "diagnostic": None})
    output = AiReviewOutput(materialReviews=[], results=[repeated, factual])
    result = assemble_review_response(extract_text(text), output, [], review_context=context)
    assert result.status == "success" and [s.kind for s in result.results] == ["근거"]


def test_duplicate_contraction_has_one_card():
    text = "팀이 데이터에 대한 분석을 수행했습니다."
    styled = review(text, "analysis", "팀이 데이터를 분석했습니다.").results[0]
    untagged = styled.model_copy(update={"diagnostic": None})
    output = AiReviewOutput(materialReviews=[], results=[untagged, styled, styled])
    response = assemble_review_response(extract_text(text), output, [])
    assert response.status == "success" and len(response.results) == 1
    assert response.results[0].diagnostic.ruleId == "analysis"
