import pytest
from pydantic import ValidationError

from app.document_processing.models import (
    DocumentPage,
    FlowBlock,
    FlowDocument,
    FlowLine,
    NormalizedBBox,
    PageBlock,
    PageDocument,
    PageLine,
)


def bbox() -> NormalizedBBox:
    return NormalizedBBox(x=0.1, y=0.2, width=0.3, height=0.1)


def test_page_document_accepts_valid_location_contract() -> None:
    document = PageDocument(
        pages=[
            DocumentPage(
                pageNumber=1,
                blocks=[
                    PageBlock(
                        blockId="p1-b1",
                        bbox=bbox(),
                        lines=[
                            PageLine(
                                lineId="p1-l1",
                                text="React, TypeScript",
                                bbox=bbox(),
                                textSource="embedded",
                                uncertainWords=[],
                            )
                        ],
                    )
                ],
            )
        ]
    )

    assert document.pages[0].blocks[0].lines[0].lineId == "p1-l1"


@pytest.mark.parametrize(
    "values",
    [
        {"x": -0.1, "y": 0, "width": 0.1, "height": 0.1},
        {"x": 0, "y": 0, "width": 0, "height": 0.1},
        {"x": 0.9, "y": 0, "width": 0.2, "height": 0.1},
    ],
)
def test_bbox_rejects_out_of_page_values(values: dict[str, float]) -> None:
    with pytest.raises(ValidationError):
        NormalizedBBox(**values)


def test_page_document_rejects_duplicate_line_ids() -> None:
    line = {
        "lineId": "p1-l1",
        "text": "same id",
        "bbox": bbox().model_dump(),
        "textSource": "embedded",
        "uncertainWords": [],
    }

    with pytest.raises(ValidationError):
        PageDocument(
            pages=[
                {
                    "pageNumber": 1,
                    "blocks": [
                        {"blockId": "p1-b1", "bbox": bbox().model_dump(), "lines": [line]},
                        {"blockId": "p1-b2", "bbox": bbox().model_dump(), "lines": [line]},
                    ],
                }
            ]
        )


def test_flow_document_uses_utf16_offsets() -> None:
    text = "A😀B"
    document = FlowDocument(
        text=text,
        blocks=[
            FlowBlock(
                blockId="f-b1",
                lines=[FlowLine(lineId="f-l1", text=text, startOffset=0, endOffset=4)],
            )
        ],
    )

    assert document.blocks[0].lines[0].endOffset == 4


def test_flow_document_rejects_offset_that_does_not_resolve_to_line() -> None:
    with pytest.raises(ValidationError):
        FlowDocument(
            text="A😀B",
            blocks=[
                FlowBlock(
                    blockId="f-b1",
                    lines=[FlowLine(lineId="f-l1", text="A😀B", startOffset=0, endOffset=3)],
                )
            ],
        )
