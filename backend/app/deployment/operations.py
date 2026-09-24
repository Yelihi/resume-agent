import os
from datetime import datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel

from app.deployment.auth import User, deployment_error, get_current_user
from app.deployment.config import get_settings

router = APIRouter(prefix="/api/operations", tags=["operations"])


def is_operator(user: User) -> bool:
    operator_id = os.environ.get("RESUME_OPERATOR_ID", "")
    return get_settings().mode == "server" and bool(operator_id) and user.id == operator_id


class BackupStatus(BaseModel):
    lastAttemptAt: datetime | None
    lastSuccessAt: datetime | None
    error: Literal["BACKUP_NOT_RUN", "BACKUP_STATUS_UNAVAILABLE", "BACKUP_OR_RETENTION_FAILED"] | None


@router.get("/backup", response_model=BackupStatus)
def backup_status(user: Annotated[User, Depends(get_current_user)], response: Response) -> BackupStatus:
    if not is_operator(user):
        raise deployment_error(403, "OPERATOR_REQUIRED", "운영자만 백업 상태를 확인할 수 있습니다.")
    response.headers["Cache-Control"] = "no-store"
    try:
        return BackupStatus.model_validate_json((get_settings().data_dir / "backup-status.json").read_text())
    except FileNotFoundError:
        return BackupStatus(lastAttemptAt=None, lastSuccessAt=None, error="BACKUP_NOT_RUN")
    except (OSError, ValueError):
        return BackupStatus(lastAttemptAt=None, lastSuccessAt=None, error="BACKUP_STATUS_UNAVAILABLE")
