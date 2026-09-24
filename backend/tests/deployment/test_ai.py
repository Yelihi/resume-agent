import asyncio
from copy import deepcopy
from types import SimpleNamespace

import httpx
from fastapi import Request

from app.deployment.auth import User, get_current_user
from app.deployment.jobs import ai_capacity
from app.document_processing.flow import extract_text
from app.experience import api as experience_api
from app.main import app
from app.reference_material import api as material_api
from app.review import api as review_api
from app.review.contracts import AiReviewOutput, ModuleResult
from app.review.run_manager import ReviewRunManager
from app.workspace import repository


def test_server_ai_ownership_persistence_capacity_and_cleanup(monkeypatch):
    async def scenario():
        context = {"contextId": "owned", "resumeVersionId": "resume", "materialVersions": {}}
        prepared = {"kind": "flow", "document": extract_text("서버 원문").model_dump(mode="json"),
                    "materials": [], "reviewContext": context}
        saved, active, gateways = {}, {}, []
        manager = ReviewRunManager(None)

        class Repository:
            def prepare_review(self, owner, identifier):
                assert owner == "alice" and identifier == "owned"
                return deepcopy(prepared)

            def prepare_retry(self, owner, identifier):
                assert owner == "alice"
                return deepcopy(saved[identifier])

            def command(self, owner, operation, args):
                if owner != "alice" or args[0] not in saved:
                    raise review_api.ReviewNotFoundError()
                assert operation == "restoreRecord"
                return {"result": deepcopy(saved[args[0]])}

            def register_run(self, owner, identifier, value):
                assert value["document"] == prepared["document"]
                active[identifier] = owner

            def commit_review(self, owner, record):
                assert active[record.runId] == owner
                assert all(event.event != "completed" for event in manager.events(record.runId))
                saved[record.runId] = record.model_dump(mode="json")
                active.pop(record.runId)

            def clear_active_run(self, owner, identifier):
                active.pop(identifier, None)

        class Gateway:
            def __init__(self):
                self.client = self
                self.closed = False
                self.started = asyncio.Event()
                self.proceed = asyncio.Event()
                gateways.append(self)

            async def close(self):
                self.closed = True

            async def final_review(self, document, *args, **kwargs):
                assert document.text == "서버 원문"
                self.started.set()
                await self.proceed.wait()
                return ModuleResult(moduleKey="finalReview", output=AiReviewOutput(materialReviews=[], results=[]), errors=[])

        def gateway_for_key(key):
            assert key == "alice-only-key"
            return Gateway()

        def current_user(request: Request):
            return User(request.headers.get("x-test-user", "alice"), "test@example.com")

        monkeypatch.setattr(repository, "WorkspaceRepository", Repository)
        for module in (review_api, experience_api, material_api):
            monkeypatch.setattr(module, "get_settings", lambda: SimpleNamespace(mode="server"))
            monkeypatch.setattr(module, "get_user_api_key", lambda user: f"{user.id}-only-key")
        monkeypatch.setattr(review_api.OpenAIReviewGateway, "from_api_key", gateway_for_key)
        app.dependency_overrides[get_current_user] = current_user
        app.dependency_overrides[review_api.get_run_manager] = lambda: manager
        payload = {**prepared, "document": extract_text("변조된 원문").model_dump(mode="json")}
        payload.pop("kind")
        try:
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url="http://test") as client:
                started = await client.post("/api/reviews/flow", json=payload)
                assert started.status_code == 202
                run_id = started.json()["runId"]
                await gateways[-1].started.wait()
                assert ai_capacity.busy
                for method, path, data in [
                    ("GET", "result", None), ("GET", "record", None), ("GET", "events", None),
                    ("POST", "cancel", None), ("POST", "retry", {"moduleKey": "finalReview"}), ("DELETE", "", None),
                ]:
                    response = await client.request(method, f"/api/reviews/{run_id}" + (f"/{path}" if path else ""),
                                                    json=data, headers={"x-test-user": "bob"})
                    assert response.status_code == 404
                busy = await client.post("/api/experiences/metadata", json={"title": "제목", "period": "", "markdown": "본문"})
                assert busy.status_code == 409 and busy.json()["errors"][0]["errorCode"] == "AI_BUSY"
                busy = await client.post("/api/materials/preview", json={"materialType": "company", "content": "https://example.com"})
                assert busy.status_code == 409
                gateways[-1].proceed.set()
                await manager.wait(run_id)
                assert run_id in saved and not active and not ai_capacity.busy and gateways[-1].closed
                assert "event: completed" in (await client.get(f"/api/reviews/{run_id}/events")).text
                forged = deepcopy(saved[run_id])
                forged["document"] = extract_text("변조된 재시도").model_dump(mode="json")
                retried = await client.post("/api/reviews/retry", json={"record": forged, "moduleKey": "finalReview"})
                retry_id = retried.json()["runId"]
                await gateways[-1].started.wait()
                await client.post(f"/api/reviews/{retry_id}/cancel")
                await manager.wait(retry_id)
                assert not active and not ai_capacity.busy and gateways[-1].closed
                assert manager.get(retry_id).gateway is None
        finally:
            app.dependency_overrides.clear()
            ai_capacity.release()

    asyncio.run(scenario())


def test_gateway_stream_lifetime_missing_key_and_immediate_cancel(monkeypatch):
    async def scenario():
        closed = []
        gateway = SimpleNamespace(client=SimpleNamespace(close=lambda: close()))

        async def close():
            closed.append(True)

        monkeypatch.setattr(experience_api, "get_settings", lambda: SimpleNamespace(mode="server"))
        monkeypatch.setattr(experience_api, "get_user_api_key", lambda user: "personal")
        monkeypatch.setattr(experience_api.OpenAIReviewGateway, "from_api_key", lambda key: gateway)
        dependency = experience_api.get_gateway(User("alice", "alice@example.com"))
        assert await anext(dependency) is gateway and ai_capacity.busy
        await dependency.aclose()
        assert closed and not ai_capacity.busy

        def missing(user):
            from app.errors import MissingOpenAiApiKeyError
            raise MissingOpenAiApiKeyError()

        monkeypatch.setenv("OPENAI_API_KEY", "must-never-be-used")
        monkeypatch.setattr(experience_api, "get_user_api_key", missing)
        dependency = experience_api.get_gateway(User("alice", "alice@example.com"))
        try:
            await anext(dependency)
            assert False, "missing user key must fail"
        except Exception as error:
            assert error.errors[0].errorCode == "OPENAI_API_KEY_MISSING"
        assert not ai_capacity.busy

        finished = []
        async def finish(run):
            finished.append(run.response.status.value)
        manager = ReviewRunManager(None)
        run_id = manager.start(extract_text("원문"), [], owner_id="alice", finish=finish)
        await manager.shutdown()
        assert (await manager.wait(run_id)).status.value == "cancelled"
        assert finished == ["cancelled"]

    asyncio.run(scenario())


def test_review_commit_survives_new_repository_and_retry_uses_stored_document(monkeypatch, tmp_path):
    from app.deployment import database
    from app.document_processing.models import ModuleErrorDTO

    async def scenario():
        db = database.Database(tmp_path)
        with db.connect() as connection:
            connection.execute("INSERT INTO users(id, subject, email) VALUES ('alice','alice','alice@example.com')")
        monkeypatch.setattr(database, "get_database", lambda: db)
        store = repository.WorkspaceRepository(db)
        document = extract_text("저장된 이력서").model_dump(mode="json")
        context_id = store.command("alice", "createContext", ["작업", {
            "inputType": "text", "displayName": "이력서", "original": "저장된 이력서",
            "documentKind": "flow", "document": document}])["result"]
        monkeypatch.setattr(review_api, "get_settings", lambda: SimpleNamespace(mode="server"))
        monkeypatch.setattr(review_api, "get_user_api_key", lambda user: "personal-key")
        clients = []

        class Gateway:
            def __init__(self):
                self.client = self
                self.closed = False
                clients.append(self)

            async def close(self):
                self.closed = True

            async def final_review(self, saved_document, *args, **kwargs):
                assert saved_document.text == "저장된 이력서"
                if len(clients) > 1:
                    return ModuleResult(moduleKey="finalReview", output=AiReviewOutput(materialReviews=[], results=[]), errors=[])
                return ModuleResult(moduleKey="finalReview", output=None, errors=[ModuleErrorDTO(
                    moduleKey="finalReview", inputSourceId=None, errorCode="RETRY", userMessage="다시 시도", canRetry=True)])

        monkeypatch.setattr(review_api.OpenAIReviewGateway, "from_api_key", lambda key: Gateway())
        manager = ReviewRunManager(None)
        user = User("alice", "alice@example.com")
        try:
            accepted = await review_api._server_start(manager, user, context_id)
            await manager.wait(accepted.runId)
            restarted = repository.WorkspaceRepository(db)
            loaded = restarted.load(user.id)["workspace"]
            assert len(loaded["reviews"]) == 1 and "activeRun" not in loaded
            assert loaded["reviews"][0]["status"] == "failed"
            retried = await review_api._server_start(manager, user, accepted.runId, "finalReview")
            await manager.wait(retried.runId)
            reviews = restarted.load(user.id)["workspace"]["reviews"]
            assert len(reviews) == 2 and reviews[-1]["status"] == "success"
            manager.release(retried.runId)
            persisted = await review_api.record(retried.runId, manager, user)
            assert persisted.response.status.value == "success" and persisted.document.text == "저장된 이력서"
            assert (await review_api.result(retried.runId, manager, user)).status.value == "success"


            def failed_commit(self, owner, record):
                raise OSError("PRIVATE_DISK_FAILURE")

            monkeypatch.setattr(repository.WorkspaceRepository, "commit_review", failed_commit)
            failed = await review_api._server_start(manager, user, context_id)
            response = await manager.wait(failed.runId)
            loaded = restarted.load(user.id)["workspace"]
            assert loaded["activeRun"]["runId"] == failed.runId and len(loaded["reviews"]) == 2
            assert response.status.value == "failed"
            assert manager.events(failed.runId)[-1].event == "failed"
            assert all(event.event != "completed" for event in manager.events(failed.runId))
            assert manager.get(failed.runId).gateway is None
            assert all(client.closed for client in clients) and not ai_capacity.busy
        finally:
            ai_capacity.release()

    asyncio.run(scenario())


def test_revocation_cancels_background_review_and_stops_sse_output(monkeypatch, tmp_path):
    from app.deployment import auth, database, jobs
    from app.review.openai_gateway import OpenAIReviewGateway

    async def scenario():
        db = database.Database(tmp_path)
        with db.connect() as connection:
            connection.execute("INSERT INTO users(id, subject, email) VALUES ('alice','alice','alice@example.com')")
            connection.execute("INSERT INTO user_invitations(email) VALUES ('alice@example.com')")
        monkeypatch.setattr(database, "get_database", lambda: db)
        monkeypatch.setattr(auth, "get_database", lambda: db)
        monkeypatch.setattr(auth, "get_settings", lambda: SimpleNamespace(mode="server"))
        monkeypatch.setattr(review_api, "get_settings", lambda: SimpleNamespace(mode="server"))
        monkeypatch.setattr(review_api, "get_user_api_key", lambda user: "personal-key")
        monkeypatch.setattr(jobs, "REVOCATION_CHECK_SECONDS", 0.01)
        store = repository.WorkspaceRepository(db)
        document = extract_text("개인 이력서").model_dump(mode="json")
        context_id = store.command("alice", "createContext", ["작업", {"inputType": "text", "displayName": "이력서",
            "original": "개인 이력서", "documentKind": "flow", "document": document}])["result"]

        class Gateway:
            def __init__(self):
                self.client = self
                self.started = asyncio.Event()
                self.closed = False

            async def close(self):
                self.closed = True

            async def final_review(self, *args, **kwargs):
                self.started.set()
                await asyncio.Event().wait()

        gateway = Gateway()
        monkeypatch.setattr(OpenAIReviewGateway, "from_api_key", lambda key: gateway)
        manager = ReviewRunManager(None)
        user = User("alice", "alice@example.com")
        started = await review_api._server_start(manager, user, context_id)
        await gateway.started.wait()
        stream = (await review_api.events(started.runId, manager, user)).body_iterator
        with db.connect() as connection:
            connection.execute("UPDATE users SET disabled=1 WHERE id='alice'")
        response = await asyncio.wait_for(manager.wait(started.runId), timeout=1)
        assert response.status.value == "cancelled" and gateway.closed and not ai_capacity.busy
        assert "activeRun" not in store.load(user.id)["workspace"]
        try:
            await anext(stream)
            assert False, "revoked user must not receive queued review events"
        except StopAsyncIteration:
            pass

        with db.connect() as connection:
            connection.execute("UPDATE users SET disabled=0 WHERE id='alice'")
        import time
        gateway = Gateway()
        expiring = User("alice", "alice@example.com", expires_at=time.time() + 0.05)
        started = await review_api._server_start(manager, expiring, context_id)
        await gateway.started.wait()
        response = await asyncio.wait_for(manager.wait(started.runId), timeout=1)
        assert response.status.value == "cancelled" and gateway.closed and not ai_capacity.busy
        proceed, stopped = asyncio.Event(), asyncio.Event()

        async def author(progress):
            try:
                await progress("진행 중")
                await proceed.wait()
                return experience_api.WrittenContent(markdown="PRIVATE_RESULT", summary="", questions=[])
            finally:
                stopped.set()

        stream = experience_api.authoring_stream(author, lambda: auth.require_active_user(user)).body_iterator
        assert "진행 중" in await anext(stream)
        with db.connect() as connection:
            connection.execute("DELETE FROM user_invitations WHERE email='alice@example.com'")
        proceed.set()
        try:
            await anext(stream)
            assert False, "revoked user must not receive an experience result"
        except StopAsyncIteration:
            pass
        assert stopped.is_set()

        class Responses:
            async def parse(self, **kwargs):
                raise AssertionError("revoked user must not start another paid call")

        secured_gateway = OpenAIReviewGateway(SimpleNamespace(responses=Responses()), "fake")
        secured_gateway.authorize = lambda: auth.require_active_user(user)
        denied = await secured_gateway.final_review(extract_text("원문"), [])
        assert denied.output is None and denied.errors

    asyncio.run(scenario())
