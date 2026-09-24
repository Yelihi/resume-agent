from dataclasses import dataclass
from functools import lru_cache
from time import time
from uuid import uuid4

import jwt
from fastapi import Request

from app.deployment.config import get_settings
from app.deployment.database import get_database
from app.document_processing.models import ModuleErrorDTO
from app.errors import ApiError


def deployment_error(status: int, code: str, message: str) -> ApiError:
    return ApiError(status, [ModuleErrorDTO(moduleKey="account", inputSourceId=None, errorCode=code, userMessage=message, canRetry=False)])


@dataclass(frozen=True)
class User:
    id: str
    email: str
    expires_at: float | None = None


@lru_cache(maxsize=4)
def _jwks_client(domain: str) -> jwt.PyJWKClient:
    return jwt.PyJWKClient(f"https://{domain}/cdn-cgi/access/certs", timeout=5)


def get_current_user(request: Request) -> User:
    settings = get_settings()
    expires_at = None
    if settings.mode == "local":
        subject, email = "local", "local@localhost"
    else:
        tokens = request.headers.getlist(settings.access_assertion_header)
        if len(tokens) != 1 or not tokens[0] or len(tokens[0]) > 16384:
            raise deployment_error(401, "AUTHENTICATION_REQUIRED", "로그인이 필요합니다.")
        try:
            token = tokens[0]
            key = _jwks_client(settings.access_team_domain).get_signing_key_from_jwt(token)
            claims = jwt.decode(token, key.key, algorithms=["RS256"], audience=settings.access_audience,
                                issuer=f"https://{settings.access_team_domain}",
                                options={"require": ["exp", "iss", "aud", "sub", "email"]})
            subject, email = claims["sub"], claims["email"]
            if not isinstance(subject, str) or not subject or not isinstance(email, str) or not email:
                raise jwt.InvalidTokenError()
            email = email.strip().lower()
            expires_at = float(claims["exp"])
            subject = f"{claims['iss']}|{subject}"
        except jwt.PyJWTError:
            raise deployment_error(401, "INVALID_AUTHENTICATION", "로그인이 만료되었거나 유효하지 않습니다. 다시 로그인해 주세요.") from None
    with get_database().connect() as connection:
        if settings.mode == "server":
            connection.execute("BEGIN IMMEDIATE")
            invited = connection.execute("SELECT 1 FROM user_invitations WHERE email=?", (email,)).fetchone()
            existing = connection.execute("SELECT disabled FROM users WHERE subject=?", (subject,)).fetchone()
            if not invited or (existing is not None and existing["disabled"]):
                raise deployment_error(403, "ACCOUNT_ACCESS_REVOKED", "초대된 활성 계정만 이용할 수 있습니다. 운영자에게 문의해 주세요.")
        connection.execute("INSERT INTO users(id, subject, email) VALUES (?, ?, ?) ON CONFLICT(subject) DO UPDATE SET email=excluded.email",
                           ("local" if settings.mode == "local" else str(uuid4()), subject, email))
        row = connection.execute("SELECT id, email FROM users WHERE subject=?", (subject,)).fetchone()
    return User(row["id"], row["email"], expires_at)


def require_active_user(user: User) -> None:
    if get_settings().mode == "local":
        return
    if user.expires_at is not None and time() >= user.expires_at:
        raise deployment_error(401, "INVALID_AUTHENTICATION", "로그인이 만료되었습니다. 다시 로그인해 주세요.")
    with get_database().connect() as connection:
        active = connection.execute("""
            SELECT 1 FROM users u JOIN user_invitations i ON i.email=lower(trim(u.email))
            WHERE u.id=? AND u.disabled=0
        """, (user.id,)).fetchone()
    if active is None:
        raise deployment_error(403, "ACCOUNT_ACCESS_REVOKED", "초대된 활성 계정만 이용할 수 있습니다. 운영자에게 문의해 주세요.")


def enforce_same_origin(request: Request) -> None:
    settings = get_settings()
    if settings.mode == "local" or request.method in {"GET", "HEAD", "OPTIONS"}:
        return
    origins = request.headers.getlist("origin")
    if origins != [settings.public_origin] or request.headers.get("sec-fetch-site") not in {None, "same-origin", "none"}:
        raise deployment_error(403, "ORIGIN_REJECTED", "같은 서비스 화면에서 다시 요청해 주세요.")
