import pymupdf

from .errors import DocumentExtractionError
from .models import DocumentPage, NormalizedBBox, PageBlock, PageDocument, PageLine


def _normalized_bbox(raw: tuple[float, float, float, float], width: float, height: float) -> NormalizedBBox:
    x0, y0, x1, y1 = raw
    tolerance = 0.5
    if x0 < -tolerance or y0 < -tolerance or x1 > width + tolerance or y1 > height + tolerance:
        raise DocumentExtractionError("INVALID_COORDINATES", "문서에서 유효하지 않은 글자 위치를 찾았습니다.")
    x0, y0 = max(0, x0), max(0, y0)
    x1, y1 = min(width, x1), min(height, y1)
    if x1 <= x0 or y1 <= y0:
        raise DocumentExtractionError("INVALID_COORDINATES", "문서에서 유효하지 않은 글자 위치를 찾았습니다.")
    return NormalizedBBox(x=x0 / width, y=y0 / height, width=(x1 - x0) / width, height=(y1 - y0) / height)


def extract_embedded_blocks(page: pymupdf.Page, page_number: int, *, ignore_actual_text: bool = False) -> list[PageBlock]:
    # Expose missing Unicode mappings as U+FFFD so the OCR fallback can detect them.
    flags = pymupdf.TEXTFLAGS_DICT & ~pymupdf.TEXT_CID_FOR_UNKNOWN_UNICODE
    if ignore_actual_text:
        flags |= pymupdf.TEXT_IGNORE_ACTUALTEXT
    raw = page.get_text("dict", sort=False, flags=flags)
    blocks: list[PageBlock] = []
    line_number = 1
    for raw_block in raw["blocks"]:
        if raw_block.get("type") != 0:
            continue
        lines: list[PageLine] = []
        for raw_line in raw_block.get("lines", []):
            text = "".join(span.get("text", "") for span in raw_line.get("spans", []))
            if not text.strip():
                continue
            lines.append(
                PageLine(
                    lineId=f"p{page_number}-l{line_number}",
                    text=text,
                    bbox=_normalized_bbox(raw_line["bbox"], page.rect.width, page.rect.height),
                    textSource="embedded",
                    uncertainWords=[],
                )
            )
            line_number += 1
        if lines:
            blocks.append(
                PageBlock(
                    blockId=f"p{page_number}-b{len(blocks) + 1}",
                    bbox=_normalized_bbox(raw_block["bbox"], page.rect.width, page.rect.height),
                    lines=lines,
                )
            )
    return blocks


def _page(page: pymupdf.Page, page_number: int) -> DocumentPage:
    blocks = extract_embedded_blocks(page, page_number)
    if not blocks:
        raise DocumentExtractionError("NO_EXTRACTABLE_TEXT", "PDF에서 읽을 수 있는 텍스트를 찾지 못했습니다.")
    return DocumentPage(pageNumber=page_number, blocks=blocks)


def extract_pdf(data: bytes) -> PageDocument:
    try:
        source = pymupdf.open(stream=data, filetype="pdf")
    except (pymupdf.FileDataError, RuntimeError) as error:
        raise DocumentExtractionError("CORRUPT_PDF", "손상되었거나 읽을 수 없는 PDF입니다.") from error

    with source:
        if source.needs_pass:
            raise DocumentExtractionError("ENCRYPTED_PDF", "암호화된 PDF는 사용할 수 없습니다.")
        try:
            pages = [_page(page, index) for index, page in enumerate(source, start=1)]
        except DocumentExtractionError:
            raise
        except Exception as error:
            raise DocumentExtractionError("CORRUPT_PDF", "손상되었거나 읽을 수 없는 PDF입니다.") from error
    if not pages:
        raise DocumentExtractionError("NO_EXTRACTABLE_TEXT", "PDF에 페이지가 없습니다.")
    return PageDocument(pages=pages)
