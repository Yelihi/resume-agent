from io import BytesIO
from zipfile import ZipFile

from app.document_processing.models import ResumeValidationPolicy
from app.document_processing.validation import detect_file_kind, validate_file, validate_text


def policy() -> ResumeValidationPolicy:
    return ResumeValidationPolicy(
        maximumFileSizeBytes={"pdf": 32, "image": 32, "docx": 512, "txt": 32},
        maximumDirectTextCharacters=4,
    )


def docx_bytes() -> bytes:
    output = BytesIO()
    with ZipFile(output, "w") as archive:
        archive.writestr("[Content_Types].xml", "<Types />")
        archive.writestr("word/document.xml", "<document />")
    return output.getvalue()


def test_detects_actual_file_kinds() -> None:
    assert detect_file_kind(b"%PDF-1.7\n") == "pdf"
    assert detect_file_kind(b"\x89PNG\r\n\x1a\n") == "image"
    assert detect_file_kind(b"\xff\xd8\xff\xe0") == "image"
    assert detect_file_kind(docx_bytes()) == "docx"
    assert detect_file_kind("한글 text".encode()) == "txt"


def test_rejects_empty_and_disguised_file() -> None:
    assert validate_file("pdf", b"", policy())[0].errorCode == "EMPTY_FILE"
    assert validate_file("pdf", b"plain text", policy())[0].errorCode == "UNSUPPORTED_MEDIA_TYPE"


def test_rejects_file_and_direct_text_over_policy_limit() -> None:
    assert validate_file("pdf", b"%PDF-" + b"x" * 40, policy())[0].errorCode == "FILE_TOO_LARGE"
    assert validate_text("12345", policy())[0].errorCode == "TEXT_TOO_LONG"


def test_direct_text_limit_counts_utf16_code_units() -> None:
    assert validate_text("A😀B", policy()) == []
    assert validate_text("A😀BC", policy())[0].errorCode == "TEXT_TOO_LONG"


def test_rejects_blank_direct_text() -> None:
    assert validate_text(" \n", policy())[0].errorCode == "EMPTY_TEXT"
