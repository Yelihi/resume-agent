from io import BytesIO

import pymupdf
import pytest
from PIL import Image

from app.document_processing.errors import DocumentExtractionError
from app.document_processing.models import NormalizedBBox, PageLine
from app.document_processing.ocr import RawOcrLine, extract_image, extract_pdf_with_ocr, remove_overlaps


class FakeEngine:
    def __init__(self, results: list[list[RawOcrLine]]) -> None:
        self.results = results
        self.calls = 0

    def recognize(self, image: Image.Image) -> list[RawOcrLine]:
        result = self.results[self.calls]
        self.calls += 1
        return result


def image_bytes(width: int = 200, height: int = 100) -> bytes:
    output = BytesIO()
    Image.new("RGB", (width, height), "white").save(output, "PNG")
    return output.getvalue()


def line(text: str = "React 2025.08", confidence: float = 95) -> RawOcrLine:
    return RawOcrLine(text=text, bbox=(20, 10, 100, 30), confidence=confidence)


def test_extracts_image_as_page_document_with_normalized_bbox() -> None:
    document = extract_image(image_bytes(), FakeEngine([[line()]]))

    result = document.pages[0].blocks[0].lines[0]
    assert result.lineId == "p1-l1"
    assert result.textSource == "ocr"
    assert result.bbox == NormalizedBBox(x=0.1, y=0.1, width=0.5, height=0.3)


def test_marks_all_tokens_uncertain_when_line_confidence_is_low() -> None:
    document = extract_image(image_bytes(), FakeEngine([[line(confidence=70)]]))

    assert document.pages[0].blocks[0].lines[0].uncertainWords == ["React", "2025.08"]


def test_retries_once_with_preprocessing_then_succeeds() -> None:
    engine = FakeEngine([[], [line()]])

    extract_image(image_bytes(), engine)

    assert engine.calls == 2


def test_ignores_empty_ocr_lines_when_other_text_is_usable() -> None:
    document = extract_image(image_bytes(), FakeEngine([[line(), line(text="")]]))

    lines = document.pages[0].blocks[0].lines
    assert [item.text for item in lines] == ["React 2025.08"]


def test_fails_after_one_preprocessing_retry() -> None:
    with pytest.raises(DocumentExtractionError) as captured:
        extract_image(image_bytes(), FakeEngine([[], []]))

    assert captured.value.code == "OCR_QUALITY_TOO_LOW"


def test_scanned_pdf_uses_full_page_ocr() -> None:
    source = pymupdf.open()
    source.new_page(width=200, height=100)

    document = extract_pdf_with_ocr(source.tobytes(), FakeEngine([[line()]]))

    assert document.pages[0].blocks[0].lines[0].text == "React 2025.08"


def test_hybrid_pdf_keeps_embedded_text_and_adds_image_text() -> None:
    source = pymupdf.open()
    page = source.new_page(width=400, height=300)
    page.insert_text((30, 40), "Embedded")
    page.insert_image(pymupdf.Rect(30, 100, 230, 200), stream=image_bytes())

    document = extract_pdf_with_ocr(source.tobytes(), FakeEngine([[line("Image text")]]))
    lines = [item for block in document.pages[0].blocks for item in block.lines]

    assert [item.textSource for item in lines] == ["embedded", "ocr"]
    assert [item.lineId for item in lines] == ["p1-l1", "p1-l2"]


def test_embedded_line_wins_when_ocr_line_overlaps() -> None:
    embedded = PageLine(
        lineId="p1-l1",
        text="Native",
        bbox=NormalizedBBox(x=0.1, y=0.1, width=0.4, height=0.1),
        textSource="embedded",
        uncertainWords=[],
    )
    ocr = PageLine(
        lineId="p1-l2",
        text="OCR duplicate",
        bbox=NormalizedBBox(x=0.1, y=0.1, width=0.4, height=0.1),
        textSource="ocr",
        uncertainWords=[],
    )

    assert remove_overlaps([embedded], [ocr]) == []
