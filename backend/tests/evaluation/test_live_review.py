import asyncio
import os

import pytest

from app.document_processing.flow import extract_text
from app.review.openai_gateway import OpenAIReviewGateway
from app.review.validation import assemble_review_response

pytestmark = [
    pytest.mark.ai,
    pytest.mark.skipif(
        os.environ.get("RUN_AI_EVAL") != "1" or not os.environ.get("OPENAI_API_KEY"),
        reason="set RUN_AI_EVAL=1 and OPENAI_API_KEY to call the real model",
    ),
]


def test_live_model_respects_schema_locations_and_evidence_rule() -> None:
    document = extract_text(
        "프로젝트 경험\nReact, JavaScript, TypeScript\n캐시를 적용해 응답 시간을 70% 개선했습니다."
    )
    gateway = OpenAIReviewGateway.from_environment()

    raw = asyncio.run(gateway.final_review(document, []))

    assert raw.output is not None
    response = assemble_review_response(document, raw.output, raw.errors)
    assert response.status in {"success", "partial"}
    assert all(item.location.lineIds for item in response.results)
    assert any(item.kind in {"근거", "사실성"} for item in response.results)


def test_live_job_requirements_link_only_supported_facts():
    from app.reference_material.models import ReferenceMaterial
    from app.review.orchestrator import ReviewOrchestrator

    async def scenario():
        gateway = OpenAIReviewGateway.from_environment()
        job = ReferenceMaterial(sourceId="job", materialType="jobPosting", inputType="text",
            content="필수 요건\n- Flask API 운영 경험\n- Oracle DB 운영 경험")
        doc = extract_text("Flask API를 개발하고 2년간 운영했습니다.")
        try:
            outcome = await ReviewOrchestrator(gateway).run(doc, [job])
            result = outcome.response
            assert len(result.requirementAssessments) == 2, [(m.moduleKey, m.model_dump()) for m in outcome.moduleResults]
            rows = result.requirementAssessments
            supported = next(row for row in rows if "Flask" in row.requirement)
            unknown = next(row for row in rows if "Oracle" in row.requirement)
            assert supported.status == "matched" and supported.resumeEvidence
            assert unknown.status == "unconfirmed" and not unknown.resumeEvidence
            assert not result.experienceRecommendations
        finally:
            await gateway.client.close()
    asyncio.run(scenario())


def test_live_portfolio_vision_and_pinned_metric_disagreement():
    import pymupdf
    from app.review.portfolio_contracts import ComparisonSource
    from app.review.portfolio_review import evaluate_page, read_page

    async def scenario():
        with pymupdf.open() as pdf:
            page = pdf.new_page()
            page.insert_text((48, 70), "Project SearchBridge", fontsize=26)
            page.insert_text((48, 124), "Production p95 search latency decreased by 20%.")
            text, image = read_page(pdf.tobytes(), 1)
        sources = [
            ComparisonSource(kind="portfolio", id="deck-1", version="deck-1", title="Deck", text=text),
            ComparisonSource(kind="resume", id="r1", version="1", title="Resume",
                             text="Project SearchBridge: Production p95 search latency decreased by 40%."),
        ]
        gateway = OpenAIReviewGateway.from_environment()
        try:
            text_status, image_status, _, conflicts = await evaluate_page(gateway, text, image, sources)
            assert (text_status, image_status) == ("complete", "complete")
            assert any(item.field == "metric" and {item.left.kind, item.right.kind} == {"portfolio", "resume"}
                       for item in conflicts)
        finally:
            await gateway.client.close()
    asyncio.run(scenario())
