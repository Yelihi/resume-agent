import json
from functools import lru_cache
from typing import Literal

from fastapi import APIRouter, Depends
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.document_processing.models import FlowDocument, PageDocument
from app.errors import (
    RetryNotAvailableError,
    ReviewAlreadyRunningError as ReviewAlreadyRunningApiError,
    ReviewInProgressError,
    ReviewNotFoundError,
)
from app.reference_material.models import ReferenceMaterial

from .contracts import PreviousReview, ReviewResponse, ReviewRecord
from .openai_gateway import OpenAIReviewGateway
from .run_manager import ReviewAlreadyRunningError, ReviewRunManager

router = APIRouter(prefix="/api/reviews")


class ApiContract(BaseModel):
    model_config = ConfigDict(extra="forbid")


class PageReviewRequest(ApiContract):
    document: PageDocument
    materials: list[ReferenceMaterial] = Field(default_factory=list)
    previousReview: PreviousReview | None = None

    @model_validator(mode="after")
    def unique_sources(self):
        _validate_source_ids(self.materials)
        return self


class FlowReviewRequest(ApiContract):
    document: FlowDocument
    materials: list[ReferenceMaterial] = Field(default_factory=list)
    previousReview: PreviousReview | None = None

    @model_validator(mode="after")
    def unique_sources(self):
        _validate_source_ids(self.materials)
        return self


def _validate_source_ids(materials: list[ReferenceMaterial]) -> None:
    source_ids = [item.sourceId for item in materials]
    if len(source_ids) != len(set(source_ids)):
        raise ValueError("source IDs must be unique")


class RunAccepted(ApiContract):
    runId: str


class CancelAccepted(ApiContract):
    runId: str
    cancelRequested: bool


class RetryRequest(ApiContract):
    moduleKey: Literal[
        "spellCheck",
        "companyContextAnalysis",
        "jobPostingAnalysis",
        "finalReview",
    ]


class StoredRetryRequest(RetryRequest):
    record: ReviewRecord


@lru_cache(maxsize=1)
def get_run_manager() -> ReviewRunManager:
    return ReviewRunManager(OpenAIReviewGateway.from_environment())


def _get(manager: ReviewRunManager, run_id: str):
    try:
        return manager.get(run_id)
    except KeyError as error:
        raise ReviewNotFoundError() from error


def _start(manager: ReviewRunManager, request: PageReviewRequest | FlowReviewRequest) -> RunAccepted:
    try:
        run_id = manager.start(request.document, request.materials, request.previousReview)
    except ReviewAlreadyRunningError as error:
        raise ReviewAlreadyRunningApiError() from error
    return RunAccepted(runId=run_id)


@router.post("/page", response_model=RunAccepted, status_code=202)
async def start_page(
    request: PageReviewRequest,
    manager: ReviewRunManager = Depends(get_run_manager),
) -> RunAccepted:
    return _start(manager, request)


@router.post("/flow", response_model=RunAccepted, status_code=202)
async def start_flow(
    request: FlowReviewRequest,
    manager: ReviewRunManager = Depends(get_run_manager),
) -> RunAccepted:
    return _start(manager, request)


@router.get("/{run_id}/result", response_model=ReviewResponse)
async def result(
    run_id: str,
    manager: ReviewRunManager = Depends(get_run_manager),
) -> ReviewResponse:
    run = _get(manager, run_id)
    if run.response is None:
        raise ReviewInProgressError()
    return run.response


@router.get("/{run_id}/events")
async def events(
    run_id: str,
    manager: ReviewRunManager = Depends(get_run_manager),
) -> StreamingResponse:
    _get(manager, run_id)

    async def body():
        async for event in manager.stream_events(run_id):
            data = json.dumps({"message": event.message}, ensure_ascii=False)
            yield f"event: {event.event}\ndata: {data}\n\n"

    return StreamingResponse(body(), media_type="text/event-stream")


@router.post("/{run_id}/cancel", response_model=CancelAccepted, status_code=202)
async def cancel(
    run_id: str,
    manager: ReviewRunManager = Depends(get_run_manager),
) -> CancelAccepted:
    _get(manager, run_id)
    manager.cancel(run_id)
    return CancelAccepted(runId=run_id, cancelRequested=True)


@router.post("/{run_id}/retry", response_model=RunAccepted, status_code=202)
async def retry(
    run_id: str,
    request: RetryRequest,
    manager: ReviewRunManager = Depends(get_run_manager),
) -> RunAccepted:
    _get(manager, run_id)
    try:
        manager.retry(run_id, request.moduleKey)
    except (RuntimeError, ValueError) as error:
        raise RetryNotAvailableError() from error
    return RunAccepted(runId=run_id)


@router.get("/{run_id}/record", response_model=ReviewRecord)
async def record(run_id: str, manager: ReviewRunManager = Depends(get_run_manager)) -> ReviewRecord:
    _get(manager, run_id)
    try:
        return manager.record(run_id)
    except RuntimeError as error:
        raise ReviewInProgressError() from error


@router.post("/retry", response_model=RunAccepted, status_code=202)
async def retry_stored(
    request: StoredRetryRequest, manager: ReviewRunManager = Depends(get_run_manager),
) -> RunAccepted:
    try:
        return RunAccepted(runId=manager.restore_retry(request.record, request.moduleKey))
    except ReviewAlreadyRunningError as error:
        raise ReviewAlreadyRunningApiError() from error
    except ValueError as error:
        raise RetryNotAvailableError() from error


@router.delete("/{run_id}", status_code=204)
async def release(run_id: str, manager: ReviewRunManager = Depends(get_run_manager)) -> Response:
    try:
        manager.release(run_id)
    except RuntimeError as error:
        raise ReviewInProgressError() from error
    return Response(status_code=204)
