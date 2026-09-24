import asyncio

import httpx

from app.document_processing.flow import extract_text
from app.main import app
from app.review.api import get_run_manager
from app.review.contracts import AiReviewOutput, ModuleResult
from app.review.run_manager import ReviewRunManager


class ApiGateway:
    def __init__(self, block: bool = False) -> None:
        self.block = block
        self.started = asyncio.Event()

    async def analyze_materials(self, module_key, materials):
        raise AssertionError("no material analysis expected")

    async def final_review(self, document, module_results, previous_review=None, materials=None):
        self.started.set()
        if self.block:
            await asyncio.Event().wait()
        return ModuleResult(moduleKey="finalReview", output=AiReviewOutput(materialReviews=[], results=[]), errors=[])


async def client_for(manager: ReviewRunManager):
    app.dependency_overrides[get_run_manager] = lambda: manager
    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    return httpx.AsyncClient(transport=transport, base_url="http://test")


def test_flow_start_result_and_sse_contract() -> None:
    async def scenario() -> None:
        manager = ReviewRunManager(ApiGateway())
        client = await client_for(manager)
        try:
            document = extract_text("문장").model_dump(mode="json")
            started = await client.post("/api/reviews/flow", json={"document": document, "materials": []})
            assert started.status_code == 202
            run_id = started.json()["runId"]
            await manager.wait(run_id)

            result = await client.get(f"/api/reviews/{run_id}/result")
            events = await client.get(f"/api/reviews/{run_id}/events")

            assert result.status_code == 200
            assert result.json() == {"status": "success", "errors": [], "materialReviews": [], "results": [], "resolutionChecks": [], "experienceRecommendations": []}
            assert events.status_code == 200
            assert events.headers["content-type"].startswith("text/event-stream")
            assert "event: spellCheck" in events.text
            assert "event: completed" in events.text
        finally:
            app.dependency_overrides.clear()
            await client.aclose()

    asyncio.run(scenario())


def test_pending_result_cancel_and_unknown_run_errors_are_safe() -> None:
    async def scenario() -> None:
        gateway = ApiGateway(block=True)
        manager = ReviewRunManager(gateway)
        client = await client_for(manager)
        try:
            document = extract_text("문장").model_dump(mode="json")
            started = await client.post("/api/reviews/flow", json={"document": document, "materials": []})
            run_id = started.json()["runId"]
            await gateway.started.wait()

            pending = await client.get(f"/api/reviews/{run_id}/result")
            cancelled = await client.post(f"/api/reviews/{run_id}/cancel")
            cancelled_again = await client.post(f"/api/reviews/{run_id}/cancel")
            await manager.wait(run_id)
            missing = await client.get("/api/reviews/not-found/result")

            assert pending.status_code == 409
            assert pending.json()["errors"][0]["errorCode"] == "REVIEW_IN_PROGRESS"
            assert cancelled.status_code == cancelled_again.status_code == 202
            assert missing.status_code == 404
            assert missing.json()["errors"][0]["errorCode"] == "REVIEW_NOT_FOUND"
        finally:
            app.dependency_overrides.clear()
            await client.aclose()

    asyncio.run(scenario())


def test_invalid_retry_module_is_rejected() -> None:
    async def scenario() -> None:
        manager = ReviewRunManager(ApiGateway())
        client = await client_for(manager)
        try:
            document = extract_text("문장").model_dump(mode="json")
            started = await client.post("/api/reviews/flow", json={"document": document, "materials": []})
            run_id = started.json()["runId"]
            await manager.wait(run_id)

            response = await client.post(
                f"/api/reviews/{run_id}/retry",
                json={"moduleKey": "unknown"},
            )

            assert response.status_code == 422
        finally:
            app.dependency_overrides.clear()
            await client.aclose()

    asyncio.run(scenario())


def test_second_review_is_blocked_while_first_is_running() -> None:
    async def scenario() -> None:
        gateway = ApiGateway(block=True)
        manager = ReviewRunManager(gateway)
        client = await client_for(manager)
        try:
            payload = {"document": extract_text("문장").model_dump(mode="json"), "materials": []}
            first = await client.post("/api/reviews/flow", json=payload)
            await gateway.started.wait()
            second = await client.post("/api/reviews/flow", json=payload)

            assert first.status_code == 202
            assert second.status_code == 409
            assert second.json()["errors"][0]["errorCode"] == "REVIEW_ALREADY_RUNNING"
            manager.cancel(first.json()["runId"])
            await manager.wait(first.json()["runId"])
        finally:
            app.dependency_overrides.clear()
            await client.aclose()

    asyncio.run(scenario())


def test_invalid_request_uses_shared_safe_error_contract() -> None:
    async def scenario() -> None:
        manager = ReviewRunManager(ApiGateway())
        client = await client_for(manager)
        try:
            response = await client.post("/api/reviews/flow", json={"document": {}})

            assert response.status_code == 422
            assert response.json() == {
                "errors": [
                    {
                        "moduleKey": "requestValidation",
                        "inputSourceId": None,
                        "errorCode": "INVALID_REQUEST",
                        "userMessage": "요청 형식을 확인해 주세요.",
                        "canRetry": False,
                    }
                ]
            }
        finally:
            app.dependency_overrides.clear()
            await client.aclose()

    asyncio.run(scenario())


def test_missing_openai_key_returns_actionable_configuration_error(monkeypatch) -> None:
    async def scenario() -> None:
        monkeypatch.delenv("OPENAI_API_KEY", raising=False)
        get_run_manager.cache_clear()
        transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            document = extract_text("문장").model_dump(mode="json")
            response = await client.post(
                "/api/reviews/flow",
                json={"document": document, "materials": []},
            )

        assert response.status_code == 503
        assert response.json() == {
            "errors": [
                {
                    "moduleKey": "reviewConfiguration",
                    "inputSourceId": None,
                    "errorCode": "OPENAI_API_KEY_MISSING",
                    "userMessage": "OpenAI API 키가 설정되지 않았습니다. 서버 실행 설정을 확인해 주세요.",
                    "canRetry": False,
                }
            ]
        }
        get_run_manager.cache_clear()

    asyncio.run(scenario())


def test_saved_record_retries_after_server_restart_and_release_is_safe() -> None:
    async def scenario() -> None:
        original = ReviewRunManager(ApiGateway())
        client = await client_for(original)
        try:
            payload = {"document": extract_text("문장").model_dump(mode="json"), "materials": []}
            started = await client.post("/api/reviews/flow", json=payload)
            run_id = started.json()["runId"]
            await original.wait(run_id)
            saved = (await client.get(f"/api/reviews/{run_id}/record")).json()
            assert saved["moduleResults"]["spellCheck"]["output"] == []
            assert saved["response"]["status"] == "success"
            assert (await client.delete(f"/api/reviews/{run_id}")).status_code == 204
            assert (await client.delete(f"/api/reviews/{run_id}")).status_code == 204
            assert (await client.get(f"/api/reviews/{run_id}/record")).status_code == 404

            restarted = ReviewRunManager(ApiGateway(block=True))
            app.dependency_overrides[get_run_manager] = lambda: restarted
            retry = await client.post("/api/reviews/retry", json={"record": saved, "moduleKey": "finalReview"})
            assert retry.status_code == 202
            new_id = retry.json()["runId"]
            assert new_id != run_id
            await restarted.gateway.started.wait()
            assert (await client.delete(f"/api/reviews/{new_id}")).status_code == 409
            assert (await client.post("/api/reviews/retry", json={"record": saved, "moduleKey": "finalReview"})).status_code == 409
            restarted.cancel(new_id)
            await restarted.wait(new_id)

            saved["moduleResults"]["spellCheck"]["moduleKey"] = "finalReview"
            invalid = await client.post("/api/reviews/retry", json={"record": saved, "moduleKey": "finalReview"})
            assert invalid.status_code == 422
        finally:
            app.dependency_overrides.clear()
            await client.aclose()

    asyncio.run(scenario())
