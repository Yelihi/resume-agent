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
