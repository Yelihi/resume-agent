from fastapi import APIRouter, Depends

from app.deployment.auth import User, get_current_user
from app.workspace.models import Command
from app.workspace.imports import ImportRequest, import_workspace
from app.workspace.repository import WorkspaceRepository

router = APIRouter(prefix="/api/workspace")


@router.get("")
def load_workspace(user: User = Depends(get_current_user)):
    return WorkspaceRepository().load(user.id)


@router.post("/commands")
def workspace_command(command: Command, user: User = Depends(get_current_user)):
    return WorkspaceRepository().command(user.id, command.operation, command.args)


@router.post("/import")
def import_local_workspace(input: ImportRequest, user: User = Depends(get_current_user)):
    return import_workspace(WorkspaceRepository(), user.id, input)


@router.get("/import/{import_id}")
def import_status(import_id: str, user: User = Depends(get_current_user)):
    repository = WorkspaceRepository()
    with repository.database.connect() as connection:
        exists = connection.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='workspace_imports'").fetchone()
        imported = exists and connection.execute("SELECT 1 FROM workspace_imports WHERE owner_id=? AND import_id=?", (user.id, import_id)).fetchone()
    return {"imported": bool(imported)}
