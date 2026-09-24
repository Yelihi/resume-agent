"""Exercise the deployed application, including global dependencies and lifespan."""
import asyncio
import json
import threading
import time

import httpx
import jwt
import pytest
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient

from app.deployment.auth import _jwks_client
from app.deployment.config import get_settings
from app.deployment.database import get_database
from app.document_processing.flow import extract_text
from app.main import app
from app.resume import api as resume_api
from app.review.api import get_run_manager
from app.workspace.repository import WorkspaceRepository


@pytest.fixture
def deployed(tmp_path, monkeypatch):
    key_file = tmp_path / "encryption.key"
    key_file.write_bytes(Fernet.generate_key())
    key_file.chmod(0o600)
    frontend = tmp_path / "frontend"
    frontend.mkdir()
    (frontend / "index.html").write_text("<!doctype html><title>Resume</title>")
    (frontend / "asset.js").write_text("/* public asset */")
    for name, value in {
        "RESUME_DEPLOYMENT_MODE": "server", "RESUME_DATA_DIR": str(tmp_path / "data"),
        "RESUME_KEY_FILE": str(key_file), "RESUME_FRONTEND_DIR": str(frontend),
        "RESUME_PUBLIC_ORIGIN": "https://resume.example.com",
        "CF_ACCESS_TEAM_DOMAIN": "test.cloudflareaccess.com", "CF_ACCESS_AUD": "application-id",
        "OPENAI_API_KEY": "sk-operator-key-must-not-be-used",
    }.items():
        monkeypatch.setenv(name, value)
    for cached in (get_settings, get_database, _jwks_client, get_run_manager):
        cached.cache_clear()
    private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    public = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(private.public_key()))
    public.update(kid="app-key", use="sig", alg="RS256")
    monkeypatch.setattr(jwt.PyJWKClient, "fetch_data", lambda self: {"keys": [public]})

    def headers(subject="alice"):
        claims = {"sub": subject, "email": f"{subject}@example.com", "iss": "https://test.cloudflareaccess.com",
                  "aud": "application-id", "exp": int(time.time()) + 120}
        return {"cf-access-jwt-assertion": jwt.encode(claims, private, algorithm="RS256", headers={"kid": "app-key"}),
                "origin": "https://resume.example.com"}

    with get_database().connect() as connection:
        connection.executemany("INSERT INTO user_invitations(email) VALUES (?)", [("alice@example.com",), ("bob@example.com",)])
    assert not app.dependency_overrides
    try:
        yield headers
    finally:
        for cached in (get_settings, get_database, _jwks_client, get_run_manager):
            cached.cache_clear()


def resume_input():
    return {"inputType": "text", "displayName": "이력서", "original": "원문", "documentKind": "flow",
            "document": extract_text("원문").model_dump(mode="json")}


def test_global_auth_origin_and_personal_key_protect_real_routes(deployed):
    with TestClient(app) as client:
        assert client.get("/api/workspace", headers=deployed("uninvited")).status_code == 403
        for path in ("/api/resumes/validation-policy", "/api/workspace", "/api/files/private",
                     "/api/reviews/private/events", "/api/reviews/private/result"):
            response = client.get(path)
            assert response.status_code == 401, (path, response.text)
            assert response.headers["cache-control"] == "private, no-store"
        for path, body in (
            ("/api/resumes/extract/text", {"text": "원문"}),
            ("/api/workspace/commands", {"operation": "createContext", "args": ["작업", resume_input()]}),
            ("/api/experiences/metadata", {"title": "제목", "period": "", "markdown": "본문"}),
        ):
            assert client.post(path, headers={"origin": "https://resume.example.com"}, json=body).status_code == 401
            assert client.post(path, headers={**deployed(), "origin": "https://evil.example"}, json=body).status_code == 403
            missing_origin = deployed()
            missing_origin.pop("origin")
            assert client.post(path, headers=missing_origin, json=body).status_code == 403
        assert client.post("/api/files", headers={"origin": "https://resume.example.com"},
                           files={"file": ("private.txt", b"private", "text/plain")}).status_code == 401
        assert client.post("/api/files", headers={**deployed(), "origin": "null"},
                           files={"file": ("private.txt", b"private", "text/plain")}).status_code == 403
        assert client.post("/api/resumes/extract/text", headers=deployed(), json={"text": "원문"}).status_code == 200
        no_key = client.post("/api/experiences/metadata", headers=deployed(),
                             json={"title": "제목", "period": "", "markdown": "본문"})
        assert no_key.status_code == 503 and no_key.json()["errors"][0]["errorCode"] == "OPENAI_API_KEY_MISSING"
        assert "operator" not in no_key.text


def test_signed_users_files_workspace_spa_and_restart(deployed):
    with TestClient(app) as client:
        alice, bob = deployed(), deployed("bob")
        owner = client.get("/api/account", headers=alice).json()["id"]
        uploaded = client.post("/api/files", headers=alice,
                               files={"file": ("../../private.html", b"<script>private</script>", "text/html")})
        assert uploaded.status_code == 200
        reference = uploaded.json()
        file_id = reference["fileId"]
        download = client.get(f"/api/files/{file_id}", headers=alice)
        assert download.content == b"<script>private</script>"
        assert download.headers["content-disposition"].startswith("attachment;")
        assert download.headers["x-content-type-options"] == "nosniff"
        assert client.get(f"/api/files/{file_id}", headers=bob).status_code == 404
        payload = {"operation": "createContext", "args": ["작업", {**resume_input(), "inputType": "file", "original": reference}]}
        assert client.post("/api/workspace/commands", headers=bob, json=payload).status_code == 404
        created = client.post("/api/workspace/commands", headers=alice, json=payload)
        assert created.status_code == 200
        context_id = created.json()["result"]
        assert client.get("/api/workspace", headers=bob).json()["workspace"]["contexts"] == []
        assert client.post("/api/workspace/commands", headers=bob,
                           json={"operation": "deleteContext", "args": [context_id]}).status_code == 404
        store = WorkspaceRepository()
        store.register_run(owner, "interrupted-run", store.prepare_review(owner, context_id))
        for path in ("/api", "/api/missing", "/api/files/missing/extra"):
            response = client.get(path)
            assert response.status_code == 404 and response.headers["content-type"].startswith("application/json")
            assert "<!doctype" not in response.text
        assert client.get("/contexts/example").text.startswith("<!doctype html>")
        assert client.get("/asset.js").status_code == 200
        assert client.get("/assets/missing.js").status_code == 404
        assert client.get("/..%2Fencryption.key").status_code == 404
    with TestClient(app) as restarted:
        workspace = restarted.get("/api/workspace", headers=deployed()).json()["workspace"]
        assert "activeRun" not in workspace
        review = workspace["reviews"][0]
        assert review["id"] == "interrupted-run" and review["status"] == "failed"
        assert all(error["errorCode"] == "SERVER_RESTARTED" and error["canRetry"] for error in review["errors"])
        for endpoint in ("record", "result"):
            recovered = restarted.get(f"/api/reviews/interrupted-run/{endpoint}", headers=deployed())
            assert recovered.status_code == 200
            assert restarted.get(f"/api/reviews/interrupted-run/{endpoint}", headers=deployed("bob")).status_code == 404
        assert restarted.get(f"/api/files/{file_id}", headers=deployed()).content == b"<script>private</script>"


def test_extraction_runs_off_event_loop_and_rejects_concurrent_work(deployed, monkeypatch):
    started, release = threading.Event(), threading.Event()
    worker_threads = []

    def slow_extract(data):
        worker_threads.append(threading.get_ident())
        started.set()
        assert release.wait(5), "test failed to release extraction worker"
        return extract_text(data.decode())

    monkeypatch.setattr(resume_api, "extract_txt", slow_extract)

    async def scenario():
        loop_thread = threading.get_ident()
        async with app.router.lifespan_context(app):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url="https://resume.example.com") as client:
                first = asyncio.create_task(client.post("/api/resumes/extract/txt", headers=deployed(),
                                                        files={"file": ("one.txt", b"first", "text/plain")}))
                try:
                    assert await asyncio.to_thread(started.wait, 2)
                    health = await asyncio.wait_for(client.get("/health"), timeout=1)
                    assert health.status_code == 200
                    second = await asyncio.wait_for(client.post("/api/resumes/extract/txt", headers=deployed("bob"),
                                                    files={"file": ("two.txt", b"second", "text/plain")}), timeout=1)
                    assert second.status_code == 429
                    assert second.json()["errors"][0]["errorCode"] == "EXTRACTION_BUSY"
                finally:
                    release.set()
                    result = await first
                assert result.status_code == 200 and result.json()["document"]["text"] == "first"
                assert worker_threads == [worker_threads[0]] and worker_threads[0] != loop_thread
                again = await client.post("/api/resumes/extract/txt", headers=deployed(),
                                          files={"file": ("three.txt", b"third", "text/plain")})
                assert again.status_code == 200

    asyncio.run(scenario())
