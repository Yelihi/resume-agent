import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.deployment.auth import User, get_current_user
from app.deployment.database import Database
from app.workspace import files
from app.workspace.repository import WorkspaceRepository
from app.workspace.imports import ImportRequest, import_workspace


def resume(original="hello"):
    return dict(inputType="file" if isinstance(original, dict) else "text", displayName="resume", original=original, documentKind="flow",
                document={"text": "hello", "blocks": [{"blockId": "f-b1", "lines": [{"lineId": "f-l1", "text": "hello", "startOffset": 0, "endOffset": 5}]}]})


def repository(tmp_path):
    database = Database(tmp_path)
    with database.connect() as connection:
        connection.executemany("INSERT INTO users(id,subject,email) VALUES(?,?,?)", [("alice", "alice", "alice@test"), ("bob", "bob", "bob@test")])
    return WorkspaceRepository(database)


def test_owner_isolation_retention_and_atomic_conflicts(tmp_path):
    repo = repository(tmp_path)
    command = lambda operation, *args: repo.command("alice", operation, list(args))
    context = command("createContext", "one", resume())["result"]
    before = repo.load("alice")
    version = before["workspace"]["contexts"][0]["latestVersionId"]
    command("addResumeVersion", context, resume("new original"), version)
    assert [item["original"] for item in repo.load("alice")["workspace"]["resumeVersions"]] == ["hello", "new original"]
    before = repo.load("alice")
    with pytest.raises(HTTPException):
        command("addResumeVersion", context, resume(), version)
    assert repo.load("alice") == before
    assert repo.load("bob")["workspace"]["contexts"] == []
    with pytest.raises(HTTPException):
        repo.command("bob", "deleteContext", [context])
    material = command("saveMaterial", dict(title="job", materialType="jobPosting", content="engineer", source="note"))["result"]
    before = repo.load("alice")
    with pytest.raises(HTTPException):
        command("attachMaterial", context, [material, "missing"])
    assert repo.load("alice") == before
    with pytest.raises(ValidationError):
        command("createContext", "one", {**resume(), "owner_id": "bob"})
    with pytest.raises(HTTPException):
        command("createContext", "one", resume({"fileId": "not-owned"}))
    assert repo.load("alice") == before
    command("attachMaterial", context, material)
    prepared = repo.prepare_review("alice", context)
    repo.register_run("alice", "run-1", prepared)
    with pytest.raises(HTTPException):
        command("deleteContext", context)
    record = dict(runId="run-1", createdAt="2026-09-24T00:00:00Z", reviewContext=prepared["reviewContext"], document=prepared["document"],
                  response=dict(status="success", errors=[], materialReviews=[], results=[]),
                  moduleResults={"spellCheck": {"moduleKey": "spellCheck", "output": [], "errors": []}, "finalReview": {"errors": [], "output": {}}})
    repo.commit_review("alice", record)
    restored = command("restoreRecord", "run-1")["result"]
    assert restored["document"] == prepared["document"]
    command("deleteMaterial", material)
    assert command("restoreRecord", "run-1")["result"]["materials"] == prepared["materials"]
    with pytest.raises(HTTPException):
        repo.command("bob", "restoreRecord", ["run-1"])
    with pytest.raises(ValidationError):
        command("completeReview", record)


def test_file_ownership_and_originals_survive_new_versions(tmp_path, monkeypatch):
    repo = repository(tmp_path)
    monkeypatch.setattr(files, "get_database", lambda: repo.database)
    app = FastAPI()
    app.include_router(files.router)
    app.dependency_overrides[get_current_user] = lambda: User("alice", "alice@test")
    with TestClient(app) as client:
        uploaded = client.post("/api/files", files={"file": ("resume.txt", b"original", "text/plain")})
        assert uploaded.status_code == 200
        ref = uploaded.json()
        identifier = ref["fileId"]
        orphan = client.post("/api/files", files={"file": ("unused.txt", b"unused", "text/plain")}).json()["fileId"]
        assert client.delete(f"/api/files/{orphan}").status_code == 204
        context = repo.command("alice", "createContext", ["one", resume(ref)])["result"]
        assert client.delete(f"/api/files/{identifier}").status_code == 409
        version = repo.load("alice")["workspace"]["contexts"][0]["latestVersionId"]
        repo.command("alice", "addResumeVersion", [context, resume(), version])
        assert client.get(f"/api/files/{identifier}").content == b"original"
        app.dependency_overrides[get_current_user] = lambda: User("bob", "bob@test")
        assert client.get(f"/api/files/{identifier}").status_code == 404
        assert client.delete(f"/api/files/{identifier}").status_code == 404
        with pytest.raises(HTTPException):
            repo.command("bob", "createContext", ["stolen", resume(ref)])
        app.dependency_overrides[get_current_user] = lambda: User("alice", "alice@test")
        second = repo.command("alice", "createContext", ["two", resume(ref)])["result"]
        repo.command("alice", "deleteContext", [context])
        assert client.get(f"/api/files/{identifier}").status_code == 200
        repo.command("alice", "deleteContext", [second])
        assert client.get(f"/api/files/{identifier}").status_code == 404
        assert not (tmp_path / "files" / identifier).exists()


def test_experience_revision_and_document_relations(tmp_path):
    repo = repository(tmp_path)
    draft = dict(title="project", period="2026", sources=[], markdown="work", metadata="skill")
    experience = repo.command("alice", "saveExperience", [draft])["result"]
    before = repo.load("alice")
    with pytest.raises(HTTPException):
        repo.command("alice", "saveExperience", [draft, experience, 9])
    assert repo.load("alice") == before
    repo.command("alice", "saveExperience", [draft, experience, 1])
    assert repo.load("alice")["workspace"]["experiences"][0]["revision"] == 2


def test_import_atomic_idempotent_and_rejects_bad_relationships(tmp_path):
    repo = repository(tmp_path)
    repo.command("alice", "createContext", ["work", resume()])
    snapshot = repo.load("alice")["workspace"]
    request = ImportRequest(importId="import-1", workspace=snapshot)
    result = import_workspace(repo, "bob", request)
    assert result["workspace"] == snapshot
    assert import_workspace(repo, "bob", request) == result
    with pytest.raises(HTTPException):
        import_workspace(repo, "bob", ImportRequest(importId="import-2", workspace=snapshot))
    with pytest.raises(ValidationError):
        ImportRequest(importId="bad", workspace={**snapshot, "activeRun": {"runId": "forged"}})
    with repo.database.connect() as connection:
        connection.execute("INSERT INTO users(id,subject,email) VALUES('charlie','charlie','charlie@test')")
    snapshot["contexts"][0]["latestVersionId"] = "missing"
    with pytest.raises(HTTPException):
        import_workspace(repo, "charlie", ImportRequest(importId="bad", workspace=snapshot))
    assert repo.load("charlie")["revision"] == 0


def test_restart_marks_pending_as_retryable_without_running_ai(tmp_path):
    repo = repository(tmp_path)
    context = repo.command("alice", "createContext", ["work", resume()])["result"]
    repo.register_run("alice", "pending", repo.prepare_review("alice", context))
    assert repo.interrupt_pending_runs() == 1
    assert repo.interrupt_pending_runs() == 0
    restored = repo.prepare_retry("alice", "pending")
    assert restored["response"]["status"] == "failed"
    assert restored["response"]["errors"][0]["errorCode"] == "SERVER_RESTARTED"
    from app.review.contracts import ReviewRecord
    ReviewRecord.model_validate(restored)


@pytest.mark.parametrize("source", [
    {"kind": "link", "url": "javascript:alert(1)"},
    {"kind": "link", "url": "not-a-url"},
    {"kind": "link", "url": "https://secret:password@example.com"},
    {"kind": "link"},
    {"kind": "note", "url": "https://example.com"},
])
def test_experience_source_validation(tmp_path, source):
    repo = repository(tmp_path)
    with pytest.raises(ValidationError):
        repo.command("alice", "saveExperience", [dict(title="test", period="", sources=[dict(id="source", name="test", text="content", createdAt="2026-09-24", **source)])])
    assert repo.load("alice")["revision"] == 0
