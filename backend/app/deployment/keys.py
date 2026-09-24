import os
import re
from typing import Annotated

from cryptography.fernet import Fernet, InvalidToken
from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, Field, SecretStr

from app.deployment.auth import User, deployment_error, enforce_same_origin, get_current_user
from app.deployment.config import get_settings, read_encryption_key
from app.deployment.database import get_database
from app.deployment.operations import is_operator

router = APIRouter(prefix="/api/account", tags=["account"], dependencies=[Depends(enforce_same_origin)])
CurrentUser = Annotated[User, Depends(get_current_user)]


class KeyInput(BaseModel):
    apiKey: SecretStr = Field(min_length=16, max_length=512)


class AccountResponse(BaseModel):
    id: str
    email: str
    mode: str
    isOperator: bool
    hasOpenAiKey: bool
    maskedOpenAiKey: str | None


def _cipher() -> Fernet:
    path = get_settings().key_file
    if path is None:
        raise deployment_error(503, "KEY_STORAGE_UNAVAILABLE", "API 키 저장소가 설정되지 않았습니다.")
    return Fernet(read_encryption_key(path))


@router.get("", response_model=AccountResponse)
def account(user: CurrentUser, response: Response) -> AccountResponse:
    response.headers["Cache-Control"] = "no-store"
    with get_database().connect() as connection:
        row = connection.execute("SELECT masked FROM user_keys WHERE owner_id=?", (user.id,)).fetchone()
    return AccountResponse(id=user.id, email=user.email, mode=get_settings().mode, isOperator=is_operator(user),
                           hasOpenAiKey=row is not None, maskedOpenAiKey=row["masked"] if row else None)


@router.put("/openai-key", status_code=204)
def save_key(payload: KeyInput, user: CurrentUser) -> Response:
    key = payload.apiKey.get_secret_value().strip()
    if not re.fullmatch(r"sk-[A-Za-z0-9_-]{13,509}", key):
        raise deployment_error(422, "INVALID_OPENAI_API_KEY", "OpenAI API 키 형식을 확인해 주세요.")
    ciphertext = _cipher().encrypt(key.encode())
    with get_database().connect() as connection:
        connection.execute("INSERT INTO user_keys(owner_id, ciphertext, masked) VALUES (?, ?, ?) ON CONFLICT(owner_id) DO UPDATE SET ciphertext=excluded.ciphertext, masked=excluded.masked",
                           (user.id, ciphertext, "sk-…" + key[-4:]))
    return Response(status_code=204, headers={"Cache-Control": "no-store"})


@router.delete("/openai-key", status_code=204)
def delete_key(user: CurrentUser) -> Response:
    with get_database().connect() as connection:
        connection.execute("DELETE FROM user_keys WHERE owner_id=?", (user.id,))
    return Response(status_code=204, headers={"Cache-Control": "no-store"})


def get_user_api_key(user: User) -> str:
    with get_database().connect() as connection:
        row = connection.execute("SELECT ciphertext FROM user_keys WHERE owner_id=?", (user.id,)).fetchone()
    if row is not None:
        try:
            return _cipher().decrypt(row["ciphertext"]).decode()
        except InvalidToken:
            raise deployment_error(503, "OPENAI_API_KEY_UNREADABLE", "저장된 API 키를 읽을 수 없습니다. 키를 다시 등록해 주세요.") from None
    if get_settings().mode == "local" and (key := os.environ.get("OPENAI_API_KEY", "").strip()):
        return key
    raise deployment_error(503, "OPENAI_API_KEY_MISSING", "설정에서 내 OpenAI API 키를 등록해 주세요.")
