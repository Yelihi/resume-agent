"""Compare the base instructions and P1 on the same synthetic resume and schema."""
import asyncio
import json
import os
from unittest.mock import patch

import pytest

from app.document_processing.flow import extract_text
from app.review.contracts import AiReviewOutput
from app.review.openai_gateway import OpenAIReviewGateway
from app.review.prompts import final_review_input
from app.review.validation import assemble_review_response

pytestmark = [pytest.mark.ai, pytest.mark.skipif(
    os.getenv("RUN_AI_EVAL") != "1" or not os.getenv("OPENAI_API_KEY"), reason="requires live model")]


def test_live_style_comparison():
    async def compare():
        doc = extract_text("팀이 데이터에 대한 분석을 수행했습니다.\n원본을 저장하지 않고 해시만 저장했습니다.\n"
                           "팀의 개선에 기여했습니다.\n별도 프로젝트에서는 팀이 응답 시간을 40% 단축했습니다.")
        gateway = OpenAIReviewGateway.from_environment()
        try:
            with patch("app.review.prompts.style_candidates", return_value=[]):
                base = final_review_input(doc, [])
            for label, messages in [("base", base), ("P1", final_review_input(doc, []))]:
                response = await gateway.client.responses.parse(model=gateway.model, input=messages,
                    text_format=AiReviewOutput, tools=[], tool_choice="none", store=False)
                raw = response.output_parsed
                assert raw is not None
                valid = assemble_review_response(doc, raw, [])
                print(label, response.usage.input_tokens, json.dumps(
                    [item.model_dump() for item in valid.results], ensure_ascii=False))
                if label == "P1":
                    assert any(s.diagnostic and s.diagnostic.action == "rewrite" and
                               s.example == "팀이 데이터를 분석했습니다." for s in valid.results)
                    assert not any(s.diagnostic and "f-l2" in s.location.lineIds for s in valid.results)
                    assert not any("40%" in s.example and "f-l4" not in s.location.lineIds for s in valid.results)
        finally:
            await gateway.client.close()
    asyncio.run(compare())
