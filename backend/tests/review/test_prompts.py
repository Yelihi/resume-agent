from app.document_processing.flow import extract_text
from app.reference_material.models import MaterialType, ReferenceMaterial
from app.review.prompts import final_review_input


def test_final_review_requires_actionable_rewrite() -> None:
    prompt = final_review_input(extract_text("기존 문장"), [])[0]["content"]

    assert "원인, 독자에게 미치는 영향, 수정 방향" in prompt
    assert "바로 바꿔 쓸 수 있는 완성 문장" in prompt


def test_final_review_requires_explicit_reference_source_tags_and_reason() -> None:
    prompt = final_review_input(extract_text("기존 문장"), [])[0]["content"]

    assert '검토출처' in prompt
    assert '"기본 검토", "채용 공고", "회사 자료"' in prompt
    assert "실제로 사용한 자료" in prompt
    assert "구체적인 요구사항이나 회사 특징" in prompt


def test_final_review_requires_material_application_result_and_evidence() -> None:
    material = ReferenceMaterial(
        sourceId="job-1",
        materialType=MaterialType.JOB_POSTING,
        inputType="text",
        content="React 경험을 요구합니다.",
    )

    messages = final_review_input(extract_text("기존 문장"), [], None, [material])
    prompt = " ".join(message["content"] for message in messages)

    assert "materialReviews" in prompt
    assert "반영하지 않았다면" in prompt
    assert "검토자료근거" in prompt
    assert "job-1" in prompt
