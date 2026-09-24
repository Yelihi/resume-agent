import asyncio
import httpx

from app.main import app
from app.review.api import get_run_manager
from app.review.contracts import ContextAnalysis, ContextEvidence, ModuleResult
from app.review.run_manager import ReviewRunManager


def test_preview_uses_urls_only_on_explicit_request_and_returns_editable_text():
    class Gateway:
        async def analyze_materials(self, key, materials):
            assert str(materials[0].url) == "https://example.com/job"
            return ModuleResult(moduleKey=key, output=ContextAnalysis(summary="React 개발자 채용", evidence=[ContextEvidence(sourceId=materials[0].sourceId, statement="React 경력이 필요합니다.")]), errors=[])

    async def scenario():
        app.dependency_overrides[get_run_manager] = lambda: ReviewRunManager(Gateway())
        try:
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url="http://test") as client:
                result = await client.post("/api/materials/preview", json={"materialType": "jobPosting", "content": "공고를 확인해 주세요 https://example.com/job"})
                assert result.status_code == 200
                assert "React 경력이 필요합니다." in result.json()["content"]
                assert result.json()["sources"] == ["https://example.com/job"]
        finally:
            app.dependency_overrides.clear()
    asyncio.run(scenario())


def test_preview_rejects_malformed_url_and_handles_missing_output():
    class Gateway:
        async def analyze_materials(self, key, materials):
            return ModuleResult(moduleKey=key, output=None, errors=[])

    async def scenario():
        app.dependency_overrides[get_run_manager] = lambda: ReviewRunManager(Gateway())
        try:
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url="http://test") as client:
                for value, code in [("https://?", "INVALID_URL"), ("https://example.com/job", "EMPTY_PREVIEW")]:
                    result = await client.post("/api/materials/preview", json={"materialType": "jobPosting", "content": value})
                    assert result.status_code == 422
                    assert result.json()["errors"][0]["errorCode"] == code
        finally:
            app.dependency_overrides.clear()
    asyncio.run(scenario())
