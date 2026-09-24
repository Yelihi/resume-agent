from collections.abc import Callable
from threading import Lock

from fastapi import APIRouter, File, UploadFile
from pydantic import BaseModel, ConfigDict
from starlette.concurrency import run_in_threadpool

from app.document_processing.errors import DocumentExtractionError
from app.document_processing.flow import extract_docx, extract_text, extract_txt
from app.document_processing.models import (
    ExtractFlowDocumentResponse,
    ExtractPageDocumentResponse,
    FlowDocument,
    ModuleErrorDTO,
    PageDocument,
    ResumeValidationPolicy,
)
from app.document_processing.ocr import extract_image, extract_pdf_with_ocr
from app.document_processing.quality import assess_document
from app.document_processing.validation import FileKind, validate_file, validate_text
from app.errors import ApiError

router = APIRouter(prefix="/api/resumes")
_extraction_slot = Lock()


def _extract(extractor, data):
    # Single-process OCR model: keep the slot until the worker finishes, even if its HTTP caller disconnects.
    if not _extraction_slot.acquire(blocking=False):
        raise ApiError(429, [ModuleErrorDTO(moduleKey="documentProcessing", inputSourceId=None,
            errorCode="EXTRACTION_BUSY", userMessage="다른 문서를 읽고 있습니다. 잠시 후 다시 시도해 주세요.", canRetry=True)])
    try:
        return assess_document(extractor(data))
    finally:
        _extraction_slot.release()

# ponytail: provisional ceilings; tune after representative page-count and memory benchmarks.
POLICY = ResumeValidationPolicy(
    maximumFileSizeBytes={
        "pdf": 20 * 1024 * 1024,
        "image": 15 * 1024 * 1024,
        "docx": 10 * 1024 * 1024,
        "txt": 2 * 1024 * 1024,
    },
    maximumDirectTextCharacters=100_000,
)


class DirectTextRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: str


def _status_for_validation(error: ModuleErrorDTO) -> int:
    if error.errorCode in {"FILE_TOO_LARGE", "TEXT_TOO_LONG"}:
        return 413
    if error.errorCode == "UNSUPPORTED_MEDIA_TYPE":
        return 415
    return 422


def _extraction_error(error: DocumentExtractionError) -> ApiError:
    return ApiError(
        422,
        [
            ModuleErrorDTO(
                moduleKey="documentProcessing",
                inputSourceId=None,
                errorCode=error.code,
                userMessage=error.user_message,
                canRetry=False,
            )
        ],
    )


async def _read(file: UploadFile, kind: FileKind) -> bytes:
    limit = getattr(POLICY.maximumFileSizeBytes, kind)
    try:
        return await file.read(limit + 1)
    finally:
        await file.close()


async def _extract_file(
    file: UploadFile,
    kind: FileKind,
    extractor: Callable[[bytes], PageDocument | FlowDocument],
) -> PageDocument | FlowDocument:
    data = await _read(file, kind)
    errors = validate_file(kind, data, POLICY)
    if errors:
        raise ApiError(_status_for_validation(errors[0]), errors)
    try:
        return await run_in_threadpool(_extract, extractor, data)
    except DocumentExtractionError as error:
        raise _extraction_error(error) from error


@router.get("/validation-policy", response_model=ResumeValidationPolicy)
async def validation_policy() -> ResumeValidationPolicy:
    return POLICY


@router.post("/extract/pdf", response_model=ExtractPageDocumentResponse)
async def pdf(file: UploadFile = File(...)) -> ExtractPageDocumentResponse:
    document = await _extract_file(file, "pdf", extract_pdf_with_ocr)
    return ExtractPageDocumentResponse(document=document, errors=[])


@router.post("/extract/image", response_model=ExtractPageDocumentResponse)
async def image(file: UploadFile = File(...)) -> ExtractPageDocumentResponse:
    document = await _extract_file(file, "image", extract_image)
    return ExtractPageDocumentResponse(document=document, errors=[])


@router.post("/extract/docx", response_model=ExtractFlowDocumentResponse)
async def docx(file: UploadFile = File(...)) -> ExtractFlowDocumentResponse:
    document = await _extract_file(file, "docx", extract_docx)
    return ExtractFlowDocumentResponse(document=document, errors=[])


@router.post("/extract/txt", response_model=ExtractFlowDocumentResponse)
async def txt(file: UploadFile = File(...)) -> ExtractFlowDocumentResponse:
    document = await _extract_file(file, "txt", extract_txt)
    return ExtractFlowDocumentResponse(document=document, errors=[])


@router.post("/extract/text", response_model=ExtractFlowDocumentResponse)
async def text(request: DirectTextRequest) -> ExtractFlowDocumentResponse:
    errors = validate_text(request.text, POLICY)
    if errors:
        raise ApiError(_status_for_validation(errors[0]), errors)
    return ExtractFlowDocumentResponse(document=assess_document(extract_text(request.text)), errors=[])
