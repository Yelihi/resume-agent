import pymupdf
import pytest

from app.document_processing.errors import DocumentExtractionError
from app.document_processing.pdf import extract_pdf


def text_pdf() -> bytes:
    document = pymupdf.open()
    page = document.new_page(width=600, height=800)
    page.insert_textbox(pymupdf.Rect(72, 72, 300, 150), "First line\nSecond line")
    return document.tobytes()


def test_extracts_pdf_pages_blocks_lines_and_normalized_bbox() -> None:
    document = extract_pdf(text_pdf())

    assert len(document.pages) == 1
    assert document.pages[0].pageNumber == 1
    lines = [line for block in document.pages[0].blocks for line in block.lines]
    assert [line.text for line in lines] == ["First line", "Second line"]
    assert [line.lineId for line in lines] == ["p1-l1", "p1-l2"]
    assert all(line.textSource == "embedded" for line in lines)
    assert all(0 <= line.bbox.x < 1 and line.bbox.x + line.bbox.width <= 1 for line in lines)


def test_preserves_pdf_block_order_instead_of_forcing_column_order() -> None:
    source = pymupdf.open()
    page = source.new_page(width=600, height=800)
    page.insert_textbox(pymupdf.Rect(340, 72, 560, 160), "RIGHT\nCOLUMN")
    page.insert_textbox(pymupdf.Rect(40, 72, 260, 160), "LEFT\nCOLUMN")

    document = extract_pdf(source.tobytes())

    lines = [line for block in document.pages[0].blocks for line in block.lines]
    assert [line.text for line in lines] == ["RIGHT", "COLUMN", "LEFT", "COLUMN"]
    assert lines[0].bbox.x > lines[2].bbox.x


def test_rejects_encrypted_pdf() -> None:
    source = pymupdf.open(stream=text_pdf(), filetype="pdf")
    encrypted = source.tobytes(
        encryption=pymupdf.PDF_ENCRYPT_AES_256,
        owner_pw="owner",
        user_pw="secret",
    )

    with pytest.raises(DocumentExtractionError) as captured:
        extract_pdf(encrypted)

    assert captured.value.code == "ENCRYPTED_PDF"


def test_rejects_corrupt_pdf() -> None:
    with pytest.raises(DocumentExtractionError) as captured:
        extract_pdf(b"%PDF-1.7\nnot a pdf")

    assert captured.value.code == "CORRUPT_PDF"
