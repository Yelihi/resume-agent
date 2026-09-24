import json
import time

import jwt
import pytest
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import Depends, FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.testclient import TestClient

from app.deployment.auth import User, _jwks_client, enforce_same_origin, get_current_user, require_active_user
from app.deployment.config import get_settings
from app.deployment.database import get_database
from app.deployment.keys import get_user_api_key, router
from app.deployment.operations import is_operator, router as operations_router
from app.errors import ApiError, ApplicationError
from app.main import api_error_handler, request_validation_error_handler
from scripts.manage_users import manage


@pytest.fixture
def server(tmp_path, monkeypatch):
    key_file = tmp_path / "encryption.key"
    key_file.write_bytes(Fernet.generate_key())
    key_file.chmod(0o600)
    for name, value in {
        "RESUME_DEPLOYMENT_MODE": "server",
        "RESUME_DATA_DIR": str(tmp_path / "data"),
        "RESUME_KEY_FILE": str(key_file),
        "RESUME_PUBLIC_ORIGIN": "https://resume.example.com",
        "CF_ACCESS_TEAM_DOMAIN": "test.cloudflareaccess.com",
        "CF_ACCESS_AUD": "application-id",
        "RESUME_ACCESS_ASSERTION_HEADER": "cf-access-jwt-assertion",
        "OPENAI_API_KEY": "sk-operator-key-never-use",
    }.items():
        monkeypatch.setenv(name, value)
    get_settings.cache_clear()
    get_database.cache_clear()
    _jwks_client.cache_clear()
    with get_database().connect() as connection:
        connection.executemany("INSERT INTO user_invitations(email) VALUES (?)", [("alice@example.com",), ("bob@example.com",), ("reused@example.com",)])
    private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    public_jwk = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(private.public_key()))
    public_jwk.update(kid="test-key", use="sig", alg="RS256")
    monkeypatch.setattr(jwt.PyJWKClient, "fetch_data", lambda self: {"keys": [public_jwk]})
    app = FastAPI(dependencies=[Depends(enforce_same_origin), Depends(get_current_user)])
    app.add_exception_handler(ApplicationError, api_error_handler)
    app.add_exception_handler(RequestValidationError, request_validation_error_handler)
    app.include_router(router)
    app.include_router(operations_router)

    def headers(subject="alice", **claims):
        payload = {"sub": subject, "email": f"{subject}@example.com", "iss": "https://test.cloudflareaccess.com", "aud": "application-id", "exp": int(time.time()) + 60}
        payload.update(claims)
        return {"cf-access-jwt-assertion": jwt.encode(payload, private, algorithm="RS256", headers={"kid": "test-key"}), "origin": "https://resume.example.com"}

    with TestClient(app) as client:
        yield client, headers, key_file
    get_settings.cache_clear()
    get_database.cache_clear()
    _jwks_client.cache_clear()


def test_signed_authentication_and_key_isolation(server):
    client, headers, _ = server
    alice_headers, bob_headers = headers(), headers("bob")
    alice = client.get("/api/account", headers=alice_headers).json()
    bob = client.get("/api/account", headers=bob_headers).json()
    assert alice["id"] != bob["id"]
    assert not bob["hasOpenAiKey"]
    secret = "sk-alice-secret-api-key-12345"  # gitleaks:allow — synthetic test input
    response = client.put("/api/account/openai-key", headers=alice_headers, json={"apiKey": secret})
    assert response.status_code == 204
    account = client.get("/api/account", headers=alice_headers)
    assert account.json()["maskedOpenAiKey"] == "sk-…2345"
    assert account.headers["cache-control"] == "no-store"
    assert secret not in account.text
    assert not client.get("/api/account", headers=bob_headers).json()["hasOpenAiKey"]
    with get_database().connect() as connection:
        ciphertext = connection.execute("SELECT ciphertext FROM user_keys WHERE owner_id=?", (alice["id"],)).fetchone()[0]
    assert secret.encode() not in ciphertext
    assert get_user_api_key(User(alice["id"], alice["email"])) == secret
    with pytest.raises(ApiError, match="OPENAI_API_KEY_MISSING"):
        get_user_api_key(User(bob["id"], bob["email"]))
    replacement = "sk-alice-replaced-api-key-67890"
    assert client.put("/api/account/openai-key", headers=alice_headers, json={"apiKey": replacement}).status_code == 204
    assert get_user_api_key(User(alice["id"], alice["email"])) == replacement
    assert client.delete("/api/account/openai-key", headers=bob_headers).status_code == 204
    assert client.get("/api/account", headers=alice_headers).json()["hasOpenAiKey"]
    assert client.delete("/api/account/openai-key", headers=alice_headers).status_code == 204
    with pytest.raises(ApiError, match="OPENAI_API_KEY_MISSING"):
        get_user_api_key(User(alice["id"], alice["email"]))


def test_rejects_missing_forged_expired_and_wrong_claims(server):
    client, headers, _ = server
    assert client.get("/api/account", headers={"cf-access-authenticated-user-email": "alice@example.com", "userId": "alice"}).status_code == 401
    for claims in ({"exp": 1}, {"exp": None}, {"aud": "other"}, {"iss": "https://evil.example"}, {"sub": ""}, {"email": ""}):
        assert client.get("/api/account", headers=headers(**claims)).status_code == 401
    forged = headers()
    pieces = forged["cf-access-jwt-assertion"].split(".")
    pieces[2] = "A" * len(pieces[2])
    forged["cf-access-jwt-assertion"] = ".".join(pieces)
    assert client.get("/api/account", headers=forged).status_code == 401
    same_email = "reused@example.com"
    first = client.get("/api/account", headers=headers("old-subject", email=same_email)).json()
    second = client.get("/api/account", headers=headers("new-subject", email=same_email)).json()
    assert first["id"] != second["id"]


def test_write_origin_and_invalid_key_never_echo_secret(server):
    client, headers, _ = server
    key = {"apiKey": "sk-sample-secret-api-key"}
    for origin in (None, "null", "https://evil.example", "https://resume.example.com.evil.example"):
        request_headers = headers()
        request_headers.pop("origin")
        if origin is not None:
            request_headers["origin"] = origin
        assert client.put("/api/account/openai-key", headers=request_headers, json=key).status_code == 403
    request_headers = headers()
    request_headers["sec-fetch-site"] = "cross-site"
    assert client.put("/api/account/openai-key", headers=request_headers, json=key).status_code == 403
    for secret in ("not-an-openai-key-secret", "sk-short"):
        response = client.put("/api/account/openai-key", headers=headers(), json={"apiKey": secret})
        assert response.status_code == 422
        assert secret not in response.text


def test_startup_rejects_insecure_or_missing_encryption_key(server, monkeypatch):
    _, _, key_file = server
    key_file.chmod(0o644)
    get_settings.cache_clear()
    with pytest.raises(RuntimeError, match="owner-only"):
        get_settings()
    key_file.chmod(0o600)
    key_file.unlink()
    with pytest.raises(FileNotFoundError):
        get_settings()
    assert not key_file.exists()
    monkeypatch.delenv("RESUME_KEY_FILE")
    with pytest.raises(RuntimeError, match="requires"):
        get_settings()


def test_settings_reject_repository_storage_and_bad_mode(server, monkeypatch):
    from pathlib import Path

    monkeypatch.setenv("RESUME_DATA_DIR", str(Path(__file__).resolve().parents[3] / "private-data"))
    get_settings.cache_clear()
    with pytest.raises(RuntimeError, match="outside the repository"):
        get_settings()
    monkeypatch.setenv("RESUME_DEPLOYMENT_MODE", "production")
    with pytest.raises(RuntimeError, match="local or server"):
        get_settings()


def test_only_designated_internal_account_can_view_safe_backup_status(server, monkeypatch):
    client, headers, _ = server
    alice_headers, bob_headers = headers(), headers("bob")
    alice = client.get("/api/account", headers=alice_headers).json()
    monkeypatch.delenv("RESUME_OPERATOR_ID", raising=False)
    assert not client.get("/api/account", headers=alice_headers).json()["isOperator"]
    assert client.get("/api/operations/backup", headers=alice_headers).status_code == 403
    monkeypatch.setenv("RESUME_OPERATOR_ID", alice["email"])
    assert client.get("/api/operations/backup", headers=alice_headers).status_code == 403
    monkeypatch.setenv("RESUME_OPERATOR_ID", alice["id"])
    assert client.get("/api/account", headers=alice_headers).json()["isOperator"]
    forged_headers = {**bob_headers, "userId": alice["id"], "cf-access-authenticated-user-email": alice["email"]}
    assert client.get("/api/operations/backup", headers=forged_headers).status_code == 403
    assert not client.get("/api/account", headers=bob_headers).json()["isOperator"]
    assert client.get("/api/operations/backup", headers=alice_headers).json() == {"lastAttemptAt": None, "lastSuccessAt": None, "error": "BACKUP_NOT_RUN"}
    status_file = get_settings().data_dir / "backup-status.json"
    status_file.write_text(json.dumps({"lastAttemptAt": "2026-09-24T01:02:03+00:00", "lastSuccessAt": "2026-09-24T01:02:04+00:00", "error": None, "secret": "never-expose"}))
    response = client.get("/api/operations/backup", headers=alice_headers)
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    assert set(response.json()) == {"lastAttemptAt", "lastSuccessAt", "error"}
    assert response.json()["lastSuccessAt"] == "2026-09-24T01:02:04Z"
    assert "never-expose" not in response.text
    for invalid in ("not json", "{}", '{"error":"secret-never-expose"}', '{"lastSuccessAt":"secret-never-expose"}'):
        status_file.write_text(invalid)
        response = client.get("/api/operations/backup", headers=alice_headers)
        assert response.json()["error"] == "BACKUP_STATUS_UNAVAILABLE"
        assert "secret-never-expose" not in response.text
    monkeypatch.setenv("RESUME_DEPLOYMENT_MODE", "local")
    get_settings.cache_clear()
    assert not is_operator(User(alice["id"], alice["email"]))


def test_invitation_and_disabled_account_rechecked_without_identity_transfer(server):
    client, headers, _ = server
    database = get_database()
    unknown = headers("uninvited")
    assert client.get("/api/account", headers=unknown).status_code == 403
    with database.connect() as connection:
        assert not connection.execute("SELECT 1 FROM users WHERE email='uninvited@example.com'").fetchone()
    manage(database, "invite", " Uninvited@Example.com ")
    account = client.get("/api/account", headers=unknown).json()
    user = User(account["id"], "ignored-not-trusted@example.com")
    require_active_user(user)
    with pytest.raises(ApiError, match="INVALID_AUTHENTICATION"):
        require_active_user(User(user.id, "", expires_at=time.time() - 1))
    manage(database, "disable", user.id)
    assert client.get("/api/account", headers=unknown).status_code == 403
    with pytest.raises(ApiError, match="ACCOUNT_ACCESS_REVOKED"):
        require_active_user(user)
    manage(database, "enable", user.id)
    assert client.get("/api/account", headers=unknown).json()["id"] == user.id
    manage(database, "revoke", "uninvited@example.com")
    assert client.get("/api/account", headers=unknown).status_code == 403
    with pytest.raises(ApiError, match="ACCOUNT_ACCESS_REVOKED"):
        require_active_user(user)
    manage(database, "enable", user.id)
    assert client.get("/api/account", headers=unknown).status_code == 403
    manage(database, "invite", "uninvited@example.com")
    recreated = client.get("/api/account", headers=headers("new-identity", email="uninvited@example.com")).json()
    assert recreated["id"] != user.id


def test_only_configured_assertion_header_is_verified(server, monkeypatch):
    client, headers, _ = server
    direct = headers()
    direct["x-resume-user-jwt"] = "forged"
    assert client.get("/api/account", headers=direct).status_code == 200
    monkeypatch.setenv("RESUME_ACCESS_ASSERTION_HEADER", "x-resume-user-jwt")
    get_settings.cache_clear()
    assert client.get("/api/account", headers=headers()).status_code == 401
    forwarded = {"x-resume-user-jwt": headers()["cf-access-jwt-assertion"], "cf-access-jwt-assertion": "unrelated-origin-service-token"}
    assert client.get("/api/account", headers=forwarded).status_code == 200
    forwarded["x-resume-user-jwt"] = "forged"
    forwarded["cf-access-jwt-assertion"] = headers()["cf-access-jwt-assertion"]
    assert client.get("/api/account", headers=forwarded).status_code == 401
    monkeypatch.setenv("RESUME_ACCESS_ASSERTION_HEADER", "authorization")
    get_settings.cache_clear()
    with pytest.raises(RuntimeError, match="RESUME_ACCESS_ASSERTION_HEADER"):
        get_settings()
