from typing import Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator


class ContractModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ModuleErrorDTO(ContractModel):
    moduleKey: str
    inputSourceId: str | None
    errorCode: str
    userMessage: str
    canRetry: bool


class NormalizedBBox(ContractModel):
    x: float = Field(ge=0, lt=1)
    y: float = Field(ge=0, lt=1)
    width: float = Field(gt=0, le=1)
    height: float = Field(gt=0, le=1)

    @model_validator(mode="after")
    def fits_page(self) -> Self:
        if self.x + self.width > 1 or self.y + self.height > 1:
            raise ValueError("bbox must fit within normalized page bounds")
        return self


class ExtractionIssue(ContractModel):
    stage: Literal["assessment", "recovery"]
    code: str
    message: str
    pageNumber: int | None = None
    lineIds: list[str] = Field(default_factory=list)
    bbox: NormalizedBBox | None = None
    recovered: bool = False


class ExtractionReport(ContractModel):
    status: Literal["complete", "recovered", "needs_review"]
    issues: list[ExtractionIssue] = Field(default_factory=list)
    confirmed: bool = False


class PageLine(ContractModel):
    lineId: str = Field(pattern=r"^p[1-9]\d*-l[1-9]\d*$")
    text: str = Field(min_length=1)
    bbox: NormalizedBBox
    textSource: Literal["embedded", "ocr"]
    uncertainWords: list[str]


class PageBlock(ContractModel):
    blockId: str = Field(pattern=r"^p[1-9]\d*-b[1-9]\d*$")
    bbox: NormalizedBBox
    lines: list[PageLine] = Field(min_length=1)


class DocumentPage(ContractModel):
    pageNumber: int = Field(ge=1)
    blocks: list[PageBlock] = Field(min_length=1)


class PageDocument(ContractModel):
    pages: list[DocumentPage] = Field(min_length=1)
    extraction: ExtractionReport | None = None

    @model_validator(mode="after")
    def validate_ids(self) -> Self:
        line_ids: set[str] = set()
        for page_index, page in enumerate(self.pages, start=1):
            if page.pageNumber != page_index:
                raise ValueError("page numbers must be contiguous and 1-based")
            expected_line = 1
            for block_index, block in enumerate(page.blocks, start=1):
                if block.blockId != f"p{page_index}-b{block_index}":
                    raise ValueError("block ID does not match its page and position")
                for line in block.lines:
                    if line.lineId != f"p{page_index}-l{expected_line}":
                        raise ValueError("line ID does not match its page and position")
                    if line.lineId in line_ids:
                        raise ValueError("line IDs must be unique")
                    line_ids.add(line.lineId)
                    expected_line += 1
        return self


class FlowLine(ContractModel):
    lineId: str = Field(pattern=r"^f-l[1-9]\d*$")
    text: str = Field(min_length=1)
    startOffset: int = Field(ge=0)
    endOffset: int = Field(gt=0)

    @model_validator(mode="after")
    def offsets_are_ordered(self) -> Self:
        if self.endOffset <= self.startOffset:
            raise ValueError("endOffset must be greater than startOffset")
        return self


class FlowBlock(ContractModel):
    blockId: str = Field(pattern=r"^f-b[1-9]\d*$")
    lines: list[FlowLine] = Field(min_length=1)


def utf16_slice(text: str, start: int, end: int) -> str:
    encoded = text.encode("utf-16-le")
    try:
        return encoded[start * 2 : end * 2].decode("utf-16-le")
    except UnicodeDecodeError as error:
        raise ValueError("offset splits a UTF-16 surrogate pair") from error


class FlowDocument(ContractModel):
    text: str = Field(min_length=1)
    blocks: list[FlowBlock] = Field(min_length=1)
    extraction: ExtractionReport | None = None

    @model_validator(mode="after")
    def validate_lines(self) -> Self:
        expected_block = 1
        expected_line = 1
        previous_end = 0
        for block in self.blocks:
            if block.blockId != f"f-b{expected_block}":
                raise ValueError("block ID does not match its position")
            expected_block += 1
            for line in block.lines:
                if line.lineId != f"f-l{expected_line}":
                    raise ValueError("line ID does not match its position")
                if line.startOffset < previous_end:
                    raise ValueError("line offsets must not overlap")
                if utf16_slice(self.text, line.startOffset, line.endOffset) != line.text:
                    raise ValueError("line offsets do not resolve to line text")
                previous_end = line.endOffset
                expected_line += 1
        return self


class FileSizeLimits(ContractModel):
    pdf: int = Field(gt=0)
    image: int = Field(gt=0)
    docx: int = Field(gt=0)
    txt: int = Field(gt=0)


class ResumeValidationPolicy(ContractModel):
    maximumFileSizeBytes: FileSizeLimits
    maximumDirectTextCharacters: int = Field(gt=0)


class ExtractPageDocumentResponse(ContractModel):
    document: PageDocument
    errors: list[ModuleErrorDTO]


class ExtractFlowDocumentResponse(ContractModel):
    document: FlowDocument
    errors: list[ModuleErrorDTO]


class ErrorResponse(ContractModel):
    errors: list[ModuleErrorDTO] = Field(min_length=1)
