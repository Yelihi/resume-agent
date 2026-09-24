import os
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from fastapi.responses import FileResponse

from app.deployment.auth import User, get_current_user
from app.deployment.database import get_database
from app.workspace.repository import WorkspaceRepository, file_ids

router = APIRouter(prefix="/api/files")
MAX_FILE_BYTES = 25 * 1024 * 1024


@router.post("")
def upload_file(file: UploadFile, user: User = Depends(get_current_user)):
    database = get_database()
    directory = database.data_dir / "files"
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    identifier = str(uuid4())
    path = directory / identifier
    size = 0
    try:
        with path.open("xb") as target:
            os.chmod(path, 0o600)
            while chunk := file.file.read(1024 * 1024):
                size += len(chunk)
                if size > MAX_FILE_BYTES:
                    raise HTTPException(413, "원본 파일은 25 MB 이하로 업로드해 주세요.")
                target.write(chunk)
            target.flush()
            os.fsync(target.fileno())
        if size == 0:
            raise HTTPException(422, "빈 파일은 업로드할 수 없습니다.")
        with database.connect() as connection:
            connection.execute("INSERT INTO files(id,owner_id,filename,content_type,size) VALUES(?,?,?,?,?)",
                               (identifier, user.id, (file.filename or "original")[:500], (file.content_type or "application/octet-stream")[:200], size))
    except BaseException:
        path.unlink(missing_ok=True)
        raise
    return {"fileId": identifier}


@router.get("/{file_id}")
def download_file(file_id: str, user: User = Depends(get_current_user)):
    database = get_database()
    with database.connect() as connection:
        row = connection.execute("SELECT * FROM files WHERE id=? AND owner_id=?", (file_id, user.id)).fetchone()
    if row is None:
        raise HTTPException(404, "원본 파일을 찾을 수 없습니다.")
    path = database.data_dir / "files" / row["id"]
    if not path.is_file():
        raise HTTPException(404, "원본 파일을 찾을 수 없습니다.")
    return FileResponse(path, filename=row["filename"], media_type=row["content_type"],
                        headers={"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"})


@router.delete("/{file_id}", status_code=204)
def delete_unused_file(file_id: str, user: User = Depends(get_current_user)):
    database = get_database()
    repository = WorkspaceRepository(database)
    with database.connect() as connection:
        connection.execute("BEGIN IMMEDIATE")
        row = connection.execute("SELECT id FROM files WHERE id=? AND owner_id=?", (file_id, user.id)).fetchone()
        if not row:
            raise HTTPException(404, "원본 파일을 찾을 수 없습니다.")
        state, _ = repository._read(connection, user.id)
        if file_id in file_ids(state):
            raise HTTPException(409, "저장한 자료에서 사용하는 원본은 삭제할 수 없습니다.")
        connection.execute("DELETE FROM files WHERE id=? AND owner_id=?", (file_id, user.id))
    with database.connect() as connection:
        connection.execute("BEGIN IMMEDIATE")
        (database.data_dir / "files" / row["id"]).unlink(missing_ok=True)
