from io import BytesIO
from typing import Iterable

from docx import Document
from docx.table import Table
from docx.text.paragraph import Paragraph

from .models import FlowBlock, FlowDocument, FlowLine
from .validation import utf16_length


def normalize_text(text: str) -> str:
    return text.removeprefix("\ufeff").replace("\r\n", "\n").replace("\r", "\n")


def extract_text(text: str) -> FlowDocument:
    normalized = normalize_text(text)
    blocks: list[FlowBlock] = []
    block_lines: list[FlowLine] = []
    line_number = 1
    utf16_cursor = 0

    for segment in normalized.splitlines(keepends=True):
        content = segment[:-1] if segment.endswith("\n") else segment
        content_length = utf16_length(content)
        if content.strip():
            block_lines.append(
                FlowLine(
                    lineId=f"f-l{line_number}",
                    text=content,
                    startOffset=utf16_cursor,
                    endOffset=utf16_cursor + content_length,
                )
            )
            line_number += 1
        elif block_lines:
            blocks.append(FlowBlock(blockId=f"f-b{len(blocks) + 1}", lines=block_lines))
            block_lines = []
        utf16_cursor += utf16_length(segment)

    if block_lines:
        blocks.append(FlowBlock(blockId=f"f-b{len(blocks) + 1}", lines=block_lines))
    return FlowDocument(text=normalized, blocks=blocks)


def extract_txt(data: bytes) -> FlowDocument:
    return extract_text(data.decode("utf-8-sig"))


def _container_lines(items: Iterable[Paragraph | Table]) -> list[str]:
    lines: list[str] = []
    for item in items:
        if isinstance(item, Paragraph):
            lines.append(item.text)
        else:
            for row in item.rows:
                lines.append("\t".join(cell.text for cell in row.cells))
    while lines and not lines[0].strip():
        lines.pop(0)
    while lines and not lines[-1].strip():
        lines.pop()
    return lines


def extract_docx(data: bytes) -> FlowDocument:
    document = Document(BytesIO(data))
    header = _container_lines(document.sections[0].header.iter_inner_content())
    body = _container_lines(document.iter_inner_content())
    footer = _container_lines(document.sections[-1].footer.iter_inner_content())
    text = "\n\n".join("\n".join(region) for region in (header, body, footer) if region)
    return extract_text(text)
