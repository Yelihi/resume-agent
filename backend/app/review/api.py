import json
from functools import lru_cache
from typing import Literal

from fastapi import APIRouter, Depends
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.deployment.auth import User, get_current_user, require_active_user
from app.deployment.config import get_settings
from app.deployment.jobs import ai_capacity
from app.deployment.keys import get_user_api_key

from app.document_processing.quality import require_reviewable
from app.document_processing.models import FlowDocument, PageDocument
from app.errors import (
    ApiError,
    RetryNotAvailableError,
    ReviewAlreadyRunningError as ReviewAlreadyRunningApiError,
    ReviewInProgressError,
    ReviewNotFoundError,
)
from app.reference_material.models import ReferenceMaterial

from .contracts import PreviousReview, ReviewResponse, ReviewRecord, ReviewContext
from .openai_gateway import OpenAIReviewGateway
from .run_manager import ReviewAlreadyRunningError, ReviewRunManager

router = APIRouter(prefix="/api/reviews")


class ApiContract(BaseModel):
    model_config = ConfigDict(extra="forbid")


class PageReviewRequest(ApiContract):
    document: PageDocument
    materials: list[ReferenceMaterial] = Field(default_factory=list)
    previousReview: PreviousReview | None = None
    reviewContext: ReviewContext | None = None

    @model_validator(mode="after")
    def unique_sources(self):
        require_reviewable(self.document)
        _validate_source_ids(self.materials)
        if self.reviewContext and set(self.reviewContext.materialVersions) != {item.sourceId for item in self.materials}:
            raise ValueError("material versions must match sources")
        return self


class FlowReviewRequest(ApiContract):
    document: FlowDocument
    materials: list[ReferenceMaterial] = Field(default_factory=list)
    previousReview: PreviousReview | None = None
    reviewContext: ReviewContext | None = None

    @model_validator(mode="after")
    def unique_sources(self):
        require_reviewable(self.document)
        _validate_source_ids(self.materials)
        if self.reviewContext and set(self.reviewContext.materialVersions) != {item.sourceId for item in self.materials}:
            raise ValueError("material versions must match sources")
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
    record: ReviewRecord | None = None
    reviewId: str | None = None

    @model_validator(mode="after")
    def extraction_confirmed(self):
        if self.record:
            require_reviewable(self.record.document)
        if self.record is None and self.reviewId is None:
            raise ValueError("review ID or record required")
        return self


@lru_cache(maxsize=1)
def get_run_manager() -> ReviewRunManager:
    return ReviewRunManager(None if get_settings().mode == "server" else OpenAIReviewGateway.from_environment())


def _get(manager: ReviewRunManager, run_id: str, user: User):
    try:
        run = manager.get(run_id)
        if get_settings().mode == "server" and run.ownerId != user.id:
            raise KeyError(run_id)
        return run
    except KeyError as error:
        raise ReviewNotFoundError() from error


def _stored_record(user: User, run_id: str) -> ReviewRecord:
    if get_settings().mode != "server":
        raise ReviewNotFoundError()
    from app.workspace.repository import WorkspaceRepository
    stored = WorkspaceRepository().command(user.id, "restoreRecord", [run_id])["result"]
    return ReviewRecord.model_validate(stored)


def _start(manager: ReviewRunManager, request: PageReviewRequest | FlowReviewRequest) -> RunAccepted:
    try:
        run_id = manager.start(request.document, request.materials, request.previousReview, request.reviewContext)
    except ReviewAlreadyRunningError as error:
        raise ReviewAlreadyRunningApiError() from error
    return RunAccepted(runId=run_id)


async def _start_owned(manager, request, user):
    if get_settings().mode != "server":
        return _start(manager, request)
    if request.reviewContext is None:
        raise ReviewNotFoundError()
    return await _server_start(manager, user, request.reviewContext.contextId)


async def _server_start(manager, user, object_id, module_key=None):
    from app.workspace.repository import WorkspaceRepository
    repository = WorkspaceRepository()
    if module_key:
        saved = ReviewRecord.model_validate(repository.prepare_retry(user.id, object_id))
        prepared = {"document": saved.document.model_dump(mode="json"),
                    "materials": [item.model_dump(mode="json") for item in saved.materials],
                    "reviewContext": saved.reviewContext.model_dump(mode="json")}
    else:
        prepared = repository.prepare_review(user.id, object_id)
        contract = PageReviewRequest if prepared["kind"] == "page" else FlowReviewRequest
        stored = contract.model_validate({key: value for key, value in prepared.items() if key != "kind"})
    ai_capacity.acquire()
    gateway = None
    handed_off = False
    try:
        gateway = OpenAIReviewGateway.from_api_key(get_user_api_key(user))
        gateway.authorize = lambda: require_active_user(user)

        async def finish(run):
            try:
                if run.response.status.value == "cancelled":
                    repository.clear_active_run(user.id, run.runId)
                else:
                    repository.commit_review(user.id, manager.record(run.runId))
            finally:
                try:
                    await gateway.client.close()
                finally:
                    ai_capacity.release()

        kwargs = {"owner_id": user.id, "owner_user": user, "gateway": gateway, "finish": finish}
        if module_key:
            run_id = manager.restore_retry(saved, module_key, **kwargs)
        else:
            run_id = manager.start(stored.document, stored.materials, stored.previousReview, stored.reviewContext, **kwargs)
        handed_off = True
        try:
            repository.register_run(user.id, run_id, prepared)
        except Exception:
            manager.cancel(run_id)
            await manager.wait(run_id)
            raise
        return RunAccepted(runId=run_id)
    except BaseException:
        if handed_off:
            raise
        try:
            if gateway:
                await gateway.client.close()
        finally:
            ai_capacity.release()
        raise


@router.post("/page", response_model=RunAccepted, status_code=202)
async def start_page(
    request: PageReviewRequest,
    manager: ReviewRunManager = Depends(get_run_manager),
    user: User = Depends(get_current_user),
) -> RunAccepted:
    return await _start_owned(manager, request, user)


@router.post("/flow", response_model=RunAccepted, status_code=202)
async def start_flow(
    request: FlowReviewRequest,
    manager: ReviewRunManager = Depends(get_run_manager),
    user: User = Depends(get_current_user),
) -> RunAccepted:
    return await _start_owned(manager, request, user)


@router.get("/{run_id}/result", response_model=ReviewResponse)
async def result(
    run_id: str,
    manager: ReviewRunManager = Depends(get_run_manager),
    user: User = Depends(get_current_user),
) -> ReviewResponse:
    try:
        run = _get(manager, run_id, user)
    except ReviewNotFoundError:
        return _stored_record(user, run_id).response
    if run.response is None:
        raise ReviewInProgressError()
    return run.response


@router.get("/{run_id}/events")
async def events(
    run_id: str,
    manager: ReviewRunManager = Depends(get_run_manager),
    user: User = Depends(get_current_user),
) -> StreamingResponse:
    _get(manager, run_id, user)

    async def body():
        server = get_settings().mode == "server"
        async for event in manager.stream_events(run_id, heartbeat=15 if server else None):
            if server:
                try:
                    require_active_user(user)
                except ApiError:
                    manager.cancel(run_id)
                    return
            if event.event == "keepalive":
                yield ": keep-alive\n\n"
                continue
            data = json.dumps({"message": event.message}, ensure_ascii=False)
            yield f"event: {event.event}\ndata: {data}\n\n"

    return StreamingResponse(body(), media_type="text/event-stream")


@router.post("/{run_id}/cancel", response_model=CancelAccepted, status_code=202)
async def cancel(
    run_id: str,
    manager: ReviewRunManager = Depends(get_run_manager),
    user: User = Depends(get_current_user),
) -> CancelAccepted:
    _get(manager, run_id, user)
    manager.cancel(run_id)
    return CancelAccepted(runId=run_id, cancelRequested=True)


@router.post("/{run_id}/retry", response_model=RunAccepted, status_code=202)
async def retry(
    run_id: str,
    request: RetryRequest,
    manager: ReviewRunManager = Depends(get_run_manager),
    user: User = Depends(get_current_user),
) -> RunAccepted:
    _get(manager, run_id, user)
    if get_settings().mode == "server":
        return await _server_start(manager, user, run_id, request.moduleKey)
    try:
        manager.retry(run_id, request.moduleKey)
    except (RuntimeError, ValueError) as error:
        raise RetryNotAvailableError() from error
    return RunAccepted(runId=run_id)


@router.get("/{run_id}/record", response_model=ReviewRecord)
async def record(run_id: str, manager: ReviewRunManager = Depends(get_run_manager),
                 user: User = Depends(get_current_user)) -> ReviewRecord:
    try:
        _get(manager, run_id, user)
    except ReviewNotFoundError:
        return _stored_record(user, run_id)
    try:
        return manager.record(run_id)
    except RuntimeError as error:
        raise ReviewInProgressError() from error


@router.post("/retry", response_model=RunAccepted, status_code=202)
async def retry_stored(
    request: StoredRetryRequest, manager: ReviewRunManager = Depends(get_run_manager),
    user: User = Depends(get_current_user),
) -> RunAccepted:
    if get_settings().mode == "server":
        review_id = request.reviewId or request.record.runId
        return await _server_start(manager, user, review_id, request.moduleKey)
    if request.record is None:
        raise RetryNotAvailableError()
    try:
        return RunAccepted(runId=manager.restore_retry(request.record, request.moduleKey))
    except ReviewAlreadyRunningError as error:
        raise ReviewAlreadyRunningApiError() from error
    except ValueError as error:
        raise RetryNotAvailableError() from error


@router.delete("/{run_id}", status_code=204)
async def release(run_id: str, manager: ReviewRunManager = Depends(get_run_manager),
                  user: User = Depends(get_current_user)) -> Response:
    if get_settings().mode == "server":
        _get(manager, run_id, user)
    try:
        manager.release(run_id)
    except RuntimeError as error:
        raise ReviewInProgressError() from error
    return Response(status_code=204)
