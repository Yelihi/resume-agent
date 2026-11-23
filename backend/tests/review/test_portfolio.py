import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pymupdf
import pytest
from fastapi import HTTPException

from app.review.portfolio_contracts import PortfolioFinding
from app.review.portfolio_review import PortfolioOutput, evaluate_page, read_page


def test_pdf_page_number_and_blank_page_are_preserved():
    with pymupdf.open() as pdf:
        pdf.new_page()
        pdf.new_page().insert_text((30, 30), "Second page evidence")
        data = pdf.tobytes()
    assert read_page(data) == 2
    assert read_page(data, 1)[0] == ""
    text, image = read_page(data, 2)
    assert "Second page evidence" in text and image.startswith(b"\xff\xd8")
    with pytest.raises(HTTPException):
        read_page(data, 3)


def test_vision_failure_retains_verified_text_and_marks_image_as_failed():
    finding = PortfolioFinding(category="message", basis="text", quote="Evidence",
                               bbox=None, diagnosis="Title is vague", proposedChange="Lead with the result")
    fake = SimpleNamespace(output_parsed=PortfolioOutput(findings=[finding]))
    parse = AsyncMock(side_effect=[ValueError("vision failed"), fake])
    gateway = SimpleNamespace(model="test", client=SimpleNamespace(responses=SimpleNamespace(parse=parse)))
    assert asyncio.run(evaluate_page(gateway, "Evidence from page 1", b"image")) == ("complete", "failed", [finding], [])


def test_consistency_rejects_uncited_values_and_shows_both_versions():
    from app.review.portfolio_contracts import ComparisonSource, ConflictCandidate
    from app.review.portfolio_review import check_conflicts
    sources = [
        ComparisonSource(kind="portfolio", id="p", version="p", title="Portfolio", text="Search latency fell 20%."),
        ComparisonSource(kind="resume", id="r", version="v2", title="Resume", text="Search latency fell 40%."),
    ]
    good = dict(project="Search", field="metric",
        left=dict(source=0, quote="Search latency fell 20%.", value="20%"),
        right=dict(source=1, quote="Search latency fell 40%.", value="40%"))
    bad = {**good, "right": {**good["right"], "value": "50%"}}
    suffix = {**good, "right": {**good["right"], "value": "0%"}}
    verified = check_conflicts([ConflictCandidate.model_validate(x) for x in [bad, suffix, good, good]], sources)
    assert len(verified) == 1
    assert [(x.version, x.value) for x in [verified[0].left, verified[0].right]] == [("p", "20%"), ("v2", "40%")]


def test_local_multipart_portfolio_routes_share_the_pdf_page_and_launch_one_model_call(monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from app.deployment.auth import User, get_current_user
    from app.review import portfolio_review

    with pymupdf.open() as pdf:
        pdf.new_page()
        pdf.new_page().insert_text((30, 30), "Pinned text")
        data = pdf.tobytes()
    parse = AsyncMock(return_value=SimpleNamespace(output_parsed=PortfolioOutput(findings=[])))
    gateway = SimpleNamespace(model="test", client=SimpleNamespace(responses=SimpleNamespace(parse=parse), close=AsyncMock()))
    monkeypatch.setattr(portfolio_review, "get_user_api_key", lambda _: "synthetic")
    monkeypatch.setattr(portfolio_review.OpenAIReviewGateway, "from_api_key", lambda _: gateway)
    app = FastAPI()
    app.include_router(portfolio_review.router)
    app.dependency_overrides[get_current_user] = lambda: User("u", "")
    with TestClient(app) as client:
        files = {"file": ("portfolio.pdf", data, "application/pdf")}
        assert client.post("/api/portfolio/inspect", files=files).json() == {"pageCount": 2}
        assert client.post("/api/portfolio/versions/v/pages/2", data={"contextId": "c"}).status_code == 422
        response = client.post("/api/portfolio/versions/v/pages/2", files=files, data={"contextId": "c"})
        assert response.status_code == 200, response.text
        assert response.json()["pageNumber"] == 2 and response.json()["text"].strip() == "Pinned text"
        assert response.json()["imageStatus"] == "complete"
    parse.assert_awaited_once()


def test_disconnect_cancels_before_result_can_be_committed():
    from app.review.portfolio_review import stop_when_disconnected

    async def scenario():
        request = SimpleNamespace(receive=AsyncMock(return_value={"type": "http.disconnect"}))

        async def run():
            async with stop_when_disconnected(request):
                await asyncio.sleep(10)
                pytest.fail("a disconnected evaluation must not reach persistence")

        with pytest.raises(asyncio.CancelledError):
            await asyncio.wait_for(run(), timeout=1)
    asyncio.run(scenario())


@pytest.mark.parametrize(("field", "left_text", "right_text", "left_value", "right_value"), [
    ("period", "Search started in June 2024.", "Search started in May 2024.", "June 2024", "May 2024"),
    ("role", "Search: I owned backend implementation.", "Search: I only helped write tests.", "owned backend implementation", "only helped write tests"),
])
def test_experience_conflicts_link_the_pinned_resume_and_experience(field, left_text, right_text, left_value, right_value):
    from app.review.portfolio_contracts import ComparisonSource, ConflictCandidate
    from app.review.portfolio_review import check_conflicts

    result = check_conflicts([ConflictCandidate(project="Search", field=field,
        left=dict(source=0, quote=left_text, value=left_value), right=dict(source=1, quote=right_text, value=right_value))], [
        ComparisonSource(kind="resume", id="r", version="2", title="Resume", text=left_text),
        ComparisonSource(kind="experience", id="e", version="7", title="Experience", text=right_text)])
    assert len(result) == 1
    assert result[0].right.version == "7" and result[0].right.quote == right_text
