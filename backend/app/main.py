import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.document_processing.models import ErrorResponse, ModuleErrorDTO
from app.errors import ApplicationError
from app.reference_material.api import router as material_router
from app.resume.api import router
from app.review.api import router as review_router
from app.experience.api import router as experience_router
from app.deployment.auth import enforce_same_origin, get_current_user
from app.deployment.config import get_settings
from app.deployment.keys import router as account_router
from app.deployment.operations import router as operations_router
from app.workspace.api import router as workspace_router
from app.workspace.files import router as files_router


def require_api_user(request: Request):
    if get_settings().mode == "server":
        return get_current_user(request)


@asynccontextmanager
async def lifespan(_: FastAPI):
    if get_settings().mode == "server":
        from app.workspace.repository import WorkspaceRepository
        WorkspaceRepository().interrupt_pending_runs()
    yield
    from app.review.api import get_run_manager
    if get_run_manager.cache_info().currsize:
        await get_run_manager().shutdown()

app = FastAPI(title="Resume Agent API", lifespan=lifespan)
for api_router in (router, review_router, material_router, experience_router, account_router, workspace_router, files_router, operations_router):
    app.include_router(api_router, dependencies=[Depends(enforce_same_origin), Depends(require_api_user)])
logger = logging.getLogger("resume_agent")


@app.middleware("http")
async def private_responses(request: Request, call_next):
    if get_settings().mode == "server" and request.url.path in {"/docs", "/redoc", "/openapi.json", "/docs/oauth2-redirect"}:
        return JSONResponse(status_code=404, content={"detail": "Not found"})
    response = await call_next(request)
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "private, no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


@app.exception_handler(ApplicationError)
async def api_error_handler(_: Request, error: ApplicationError) -> JSONResponse:
    body = ErrorResponse(errors=error.errors)
    return JSONResponse(status_code=error.status_code, content=body.model_dump())


@app.exception_handler(RequestValidationError)
async def request_validation_error_handler(_: Request, __: RequestValidationError) -> JSONResponse:
    body = ErrorResponse(
        errors=[
            ModuleErrorDTO(
                moduleKey="requestValidation",
                inputSourceId=None,
                errorCode="INVALID_REQUEST",
                userMessage="요청 형식을 확인해 주세요.",
                canRetry=False,
            )
        ]
    )
    return JSONResponse(status_code=422, content=body.model_dump())


@app.exception_handler(Exception)
async def unexpected_error_handler(_: Request, error: Exception) -> JSONResponse:
    # Exception messages may contain upstream keys or document content.
    logger.error("Unhandled request error (%s)", type(error).__name__)
    body = ErrorResponse(
        errors=[
            ModuleErrorDTO(
                moduleKey="server",
                inputSourceId=None,
                errorCode="INTERNAL_ERROR",
                userMessage="요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.",
                canRetry=True,
            )
        ]
    )
    return JSONResponse(status_code=500, content=body.model_dump())


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.exception_handler(StarletteHTTPException)
async def http_error_handler(_: Request, error: StarletteHTTPException) -> JSONResponse:
    body = ErrorResponse(errors=[ModuleErrorDTO(moduleKey="request", inputSourceId=None,
        errorCode="HTTP_ERROR", userMessage=str(error.detail), canRetry=False)])
    return JSONResponse(status_code=error.status_code, content=body.model_dump(), headers=error.headers)


@app.get("/{path:path}", include_in_schema=False)
async def frontend(path: str):
    if path == "api" or path.startswith("api/"):
        raise HTTPException(404, "API를 찾을 수 없습니다.")
    directory = Path(os.environ.get("RESUME_FRONTEND_DIR", Path(__file__).resolve().parents[2] / "frontend/dist")).resolve()
    candidate = (directory / path).resolve()
    if not candidate.is_relative_to(directory):
        raise HTTPException(404, "화면을 찾을 수 없습니다.")
    if candidate.is_file():
        return FileResponse(candidate)
    if Path(path).suffix or path.startswith("assets/") or not (directory / "index.html").is_file():
        raise HTTPException(404, "화면을 찾을 수 없습니다.")
    return FileResponse(directory / "index.html", headers={"Cache-Control": "no-cache"})
