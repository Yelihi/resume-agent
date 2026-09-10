import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.document_processing.models import ErrorResponse, ModuleErrorDTO
from app.errors import ApplicationError
from app.resume.api import router
from app.review.api import router as review_router

app = FastAPI(title="Resume Agent API")
app.include_router(router)
app.include_router(review_router)
logger = logging.getLogger("resume_agent")


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
    logger.exception("Unhandled request error", exc_info=error)
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
