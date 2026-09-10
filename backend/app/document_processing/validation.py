from io import BytesIO
from typing import Literal
from zipfile import BadZipFile, ZipFile

from .models import ModuleErrorDTO, ResumeValidationPolicy

FileKind = Literal["pdf", "image", "docx", "txt"]


def utf16_length(text: str) -> int:
    return len(text.encode("utf-16-le")) // 2


def _error(code: str, message: str) -> ModuleErrorDTO:
    return ModuleErrorDTO(
        moduleKey="resumeInputValidation",
        inputSourceId=None,
        errorCode=code,
        userMessage=message,
        canRetry=False,
    )


def _is_docx(data: bytes) -> bool:
    try:
        with ZipFile(BytesIO(data)) as archive:
            names = set(archive.namelist())
            return "[Content_Types].xml" in names and "word/document.xml" in names
    except BadZipFile:
        return False


def detect_file_kind(data: bytes) -> FileKind | None:
    if data[:1024].lstrip().startswith(b"%PDF-"):
        return "pdf"
    if data.startswith((b"\x89PNG\r\n\x1a\n", b"\xff\xd8\xff", b"GIF87a", b"GIF89a")):
        return "image"
    if data.startswith((b"II*\x00", b"MM\x00*")) or data[:4] in {b"RIFF"} and data[8:12] == b"WEBP":
        return "image"
    if data.startswith(b"PK") and _is_docx(data):
        return "docx"
    if b"\x00" not in data:
        try:
            data.decode("utf-8-sig")
            return "txt"
        except UnicodeDecodeError:
            pass
    return None


def validate_file(
    expected_kind: FileKind,
    data: bytes,
    policy: ResumeValidationPolicy,
) -> list[ModuleErrorDTO]:
    if not data:
        return [_error("EMPTY_FILE", "빈 파일은 사용할 수 없습니다.")]
    limit = getattr(policy.maximumFileSizeBytes, expected_kind)
    if len(data) > limit:
        return [_error("FILE_TOO_LARGE", "파일 크기가 허용 범위를 초과했습니다.")]
    if detect_file_kind(data) != expected_kind:
        return [_error("UNSUPPORTED_MEDIA_TYPE", "선택한 입력 형식과 실제 파일 형식이 다릅니다.")]
    return []


def validate_text(text: str, policy: ResumeValidationPolicy) -> list[ModuleErrorDTO]:
    if not text.strip():
        return [_error("EMPTY_TEXT", "빈 텍스트는 사용할 수 없습니다.")]
    if utf16_length(text) > policy.maximumDirectTextCharacters:
        return [_error("TEXT_TOO_LONG", "입력한 텍스트가 허용 길이를 초과했습니다.")]
    return []
