import asyncio
from types import SimpleNamespace

import httpx

from app.main import app
from app.experience.api import get_gateway, LinkContent, LinkLookup, WrittenContent


def payload():
    return {"experience": {"id": "experience", "title": "검색 개선", "period": "", "revision": 1,
            "sources": [{"id": "note", "kind": "note", "name": "메모", "text": "검색 조건을 URL에 저장했다.", "createdAt": "2026-09-15"}]},
            "resume": {"id": "resume", "text": "개발자 이력서"}, "materials": []}


def test_writes_without_tools_and_rejects_invalid_sources():
    class Responses:
        async def parse(self, **kwargs):
            assert kwargs["store"] is False
            assert kwargs["tools"] == [] and kwargs["tool_choice"] == "none"
            assert "검색 조건을 URL에 저장했다" in kwargs["input"][1]["content"]
            return SimpleNamespace(output_parsed=WrittenContent(markdown="# 검색 개선", summary="조건 저장", questions=["본인 역할은 무엇인가요?"]))

    async def scenario():
        app.dependency_overrides[get_gateway] = lambda: SimpleNamespace(client=SimpleNamespace(responses=Responses()), model="test")
        try:
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url="http://test") as client:
                response = await client.post("/api/experiences/write", json=payload())
                assert response.status_code == 200 and response.json()["sourceNotes"] == []
                invalid = payload()
                invalid["experience"]["sources"] *= 2
                assert (await client.post("/api/experiences/write", json=invalid)).status_code == 422
                invalid = payload()
                invalid["experience"]["sources"][0].update(kind="link", url="javascript:alert(1)")
                assert (await client.post("/api/experiences/write", json=invalid)).status_code == 422
        finally:
            app.dependency_overrides.clear()
    asyncio.run(scenario())


def test_does_not_use_unverified_link_content_and_reports_upstream_failure():
    class Responses:
        fail = False

        async def parse(self, **kwargs):
            if self.fail:
                raise RuntimeError("private source content must not be returned")
            if kwargs["text_format"] is LinkLookup:
                return SimpleNamespace(output=[{"url": "https://unrelated.example/"}], output_parsed=LinkLookup(sources=[LinkContent(sourceId="link", text="UNVERIFIED_CLAIM")]))
            assert "UNVERIFIED_CLAIM" not in kwargs["input"][1]["content"]
            assert kwargs["tools"] == []
            return SimpleNamespace(output_parsed=WrittenContent(markdown="# 검색 개선", summary="조건 저장", questions=[]))

    async def scenario():
        responses = Responses()
        app.dependency_overrides[get_gateway] = lambda: SimpleNamespace(client=SimpleNamespace(responses=responses), model="test")
        try:
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url="http://test") as client:
                data = payload()
                data["experience"]["sources"].append({"id": "link", "kind": "link", "name": "Gerrit", "text": "", "url": "https://example.com/change", "createdAt": "2026-09-15"})
                response = await client.post("/api/experiences/write", json=data)
                assert response.status_code == 200
                assert response.json()["sourceNotes"][0]["verified"] is False
                responses.fail = True
                response = await client.post("/api/experiences/write", json=data)
                assert response.status_code == 502
                assert "private source content" not in response.text
        finally:
            app.dependency_overrides.clear()
    asyncio.run(scenario())
