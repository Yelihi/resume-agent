from dataclasses import dataclass
from functools import lru_cache
from io import BytesIO
from statistics import mean
from typing import Protocol

import pymupdf
from PIL import Image, ImageOps, UnidentifiedImageError

from .errors import DocumentExtractionError
from .models import DocumentPage, NormalizedBBox, PageBlock, PageDocument, PageLine
from .pdf import extract_embedded_blocks

MINIMUM_AVERAGE_CONFIDENCE = 50.0
UNCERTAIN_LINE_CONFIDENCE = 85.0


@dataclass(frozen=True)
class RawOcrLine:
    text: str
    bbox: tuple[float, float, float, float]
    confidence: float


class OcrEngine(Protocol):
    def recognize(self, image: Image.Image) -> list[RawOcrLine]: ...


@lru_cache(maxsize=1)
def _paddle_pipeline():
    from paddleocr import PaddleOCR

    return PaddleOCR(
        text_detection_model_name="PP-OCRv5_mobile_det",
        text_recognition_model_name="korean_PP-OCRv5_mobile_rec",
        use_doc_orientation_classify=False,
        use_doc_unwarping=False,
        use_textline_orientation=False,
    )


class PaddleOcrEngine:
    def recognize(self, image: Image.Image) -> list[RawOcrLine]:
        import numpy

        results = list(_paddle_pipeline().predict(numpy.asarray(image)))
        if not results:
            return []
        payload = results[0].json["res"]
        lines = []
        for text, confidence, box in zip(
            payload["rec_texts"],
            payload["rec_scores"],
            payload["rec_boxes"],
            strict=True,
        ):
            x0, y0, x1, y1 = [float(value) for value in box]
            lines.append(RawOcrLine(text, (x0, y0, x1 - x0, y1 - y0), float(confidence) * 100))
        return lines


def _has_usable_text(lines: list[RawOcrLine]) -> bool:
    usable = [line for line in lines if line.text.strip()]
    return bool(usable) and mean(line.confidence for line in usable) >= MINIMUM_AVERAGE_CONFIDENCE


def _preprocess(image: Image.Image) -> Image.Image:
    image = ImageOps.autocontrast(ImageOps.grayscale(ImageOps.exif_transpose(image)))
    if image.width < 1200:
        image = image.resize((image.width * 2, image.height * 2), Image.Resampling.LANCZOS)
    return image.convert("RGB")


def _recognize(image: Image.Image, engine: OcrEngine) -> tuple[list[RawOcrLine], Image.Image]:
    normalized = ImageOps.exif_transpose(image).convert("RGB")
    lines = [line for line in engine.recognize(normalized) if line.text.strip()]
    if _has_usable_text(lines):
        return lines, normalized
    retried = _preprocess(normalized)
    lines = [line for line in engine.recognize(retried) if line.text.strip()]
    if _has_usable_text(lines):
        return lines, retried
    raise DocumentExtractionError("OCR_QUALITY_TOO_LOW", "이미지에서 글자를 안정적으로 읽지 못했습니다.")


def _ocr_page_lines(
    raw_lines: list[RawOcrLine],
    image: Image.Image,
    page_number: int,
    clip: pymupdf.Rect | None = None,
    page_size: tuple[float, float] | None = None,
) -> list[PageLine]:
    result = []
    for index, raw in enumerate(raw_lines, start=1):
        x, y, width, height = raw.bbox
        if clip is None:
            bbox = NormalizedBBox(x=x / image.width, y=y / image.height, width=width / image.width, height=height / image.height)
        else:
            page_width, page_height = page_size or (clip.width, clip.height)
            scale_x, scale_y = clip.width / image.width, clip.height / image.height
            bbox = NormalizedBBox(
                x=(clip.x0 + x * scale_x) / page_width,
                y=(clip.y0 + y * scale_y) / page_height,
                width=width * scale_x / page_width,
                height=height * scale_y / page_height,
            )
        result.append(
            PageLine(
                lineId=f"p{page_number}-l{index}",
                text=raw.text,
                bbox=bbox,
                textSource="ocr",
                uncertainWords=raw.text.split() if raw.confidence < UNCERTAIN_LINE_CONFIDENCE else [],
            )
        )
    return result


def _bbox_iou(first: NormalizedBBox, second: NormalizedBBox) -> float:
    overlap_width = max(0.0, min(first.x + first.width, second.x + second.width) - max(first.x, second.x))
    overlap_height = max(0.0, min(first.y + first.height, second.y + second.height) - max(first.y, second.y))
    intersection = overlap_width * overlap_height
    union = first.width * first.height + second.width * second.height - intersection
    return intersection / union if union else 0.0


def remove_overlaps(embedded: list[PageLine], ocr: list[PageLine]) -> list[PageLine]:
    return [candidate for candidate in ocr if all(_bbox_iou(native.bbox, candidate.bbox) < 0.5 for native in embedded)]


def _union_bbox(lines: list[PageLine]) -> NormalizedBBox:
    x0 = min(line.bbox.x for line in lines)
    y0 = min(line.bbox.y for line in lines)
    x1 = max(line.bbox.x + line.bbox.width for line in lines)
    y1 = max(line.bbox.y + line.bbox.height for line in lines)
    return NormalizedBBox(x=x0, y=y0, width=x1 - x0, height=y1 - y0)


def _renumber(page_number: int, groups: list[tuple[NormalizedBBox, list[PageLine]]]) -> DocumentPage:
    blocks = []
    line_number = 1
    for _, lines in groups:
        if not lines:
            continue
        numbered = []
        for line in lines:
            numbered.append(line.model_copy(update={"lineId": f"p{page_number}-l{line_number}"}))
            line_number += 1
        blocks.append(PageBlock(blockId=f"p{page_number}-b{len(blocks) + 1}", bbox=_union_bbox(numbered), lines=numbered))
    if not blocks:
        raise DocumentExtractionError("OCR_QUALITY_TOO_LOW", "문서에서 글자를 안정적으로 읽지 못했습니다.")
    return DocumentPage(pageNumber=page_number, blocks=blocks)


def extract_image(data: bytes, engine: OcrEngine | None = None) -> PageDocument:
    try:
        image = Image.open(BytesIO(data))
        image.load()
    except (UnidentifiedImageError, OSError) as error:
        raise DocumentExtractionError("CORRUPT_IMAGE", "손상되었거나 읽을 수 없는 이미지입니다.") from error
    raw, used_image = _recognize(image, engine or PaddleOcrEngine())
    lines = _ocr_page_lines(raw, used_image, 1)
    return PageDocument(pages=[_renumber(1, [(_union_bbox(lines), lines)])])


def _render(page: pymupdf.Page, clip: pymupdf.Rect | None = None) -> Image.Image:
    pixmap = page.get_pixmap(matrix=pymupdf.Matrix(2, 2), clip=clip, alpha=False)
    image = Image.open(BytesIO(pixmap.tobytes("png")))
    image.load()
    return image


def extract_pdf_with_ocr(data: bytes, engine: OcrEngine | None = None) -> PageDocument:
    engine = engine or PaddleOcrEngine()
    try:
        source = pymupdf.open(stream=data, filetype="pdf")
    except (pymupdf.FileDataError, RuntimeError) as error:
        raise DocumentExtractionError("CORRUPT_PDF", "손상되었거나 읽을 수 없는 PDF입니다.") from error
    with source:
        if source.needs_pass:
            raise DocumentExtractionError("ENCRYPTED_PDF", "암호화된 PDF는 사용할 수 없습니다.")
        pages = []
        for page_number, page in enumerate(source, start=1):
            embedded_blocks = extract_embedded_blocks(page, page_number)
            embedded_lines = [line for block in embedded_blocks for line in block.lines]
            groups = [(block.bbox, block.lines) for block in embedded_blocks]
            if not embedded_blocks:
                image = _render(page)
                raw, used_image = _recognize(image, engine)
                lines = _ocr_page_lines(raw, used_image, page_number)
                groups.append((_union_bbox(lines), lines))
            else:
                seen_rects: set[tuple[float, float, float, float]] = set()
                for image_info in page.get_images(full=True):
                    for clip in page.get_image_rects(image_info[0]):
                        key = tuple(clip)
                        if key in seen_rects or clip.is_empty:
                            continue
                        seen_rects.add(key)
                        rendered = _render(page, clip)
                        try:
                            raw, used_image = _recognize(rendered, engine)
                        except DocumentExtractionError:
                            continue
                        lines = _ocr_page_lines(
                            raw,
                            used_image,
                            page_number,
                            clip=clip,
                            page_size=(page.rect.width, page.rect.height),
                        )
                        lines = remove_overlaps(embedded_lines, lines)
                        if lines:
                            groups.append((_union_bbox(lines), lines))
            pages.append(_renumber(page_number, groups))
    if not pages:
        raise DocumentExtractionError("NO_EXTRACTABLE_TEXT", "PDF에 페이지가 없습니다.")
    return PageDocument(pages=pages)
