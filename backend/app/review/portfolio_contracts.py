import re
from typing import Literal

from pydantic import Field, model_validator

from app.document_processing.models import NormalizedBBox
from .contracts import ReviewContract

_NUMBER = re.compile(r"[+−-]?\d+(?:[,.]\d+)*(?:[ \t]*[%％])?")


def citation_contains_value(quote: str, value: str) -> bool:
    value = " ".join(value.split())
    if not value:
        return False
    pattern = re.escape(value)
    if value[0].isdigit():
        pattern = r"(?<![\d.,])" + pattern
    if value[-1].isdigit():
        pattern += r"(?!\d|[.,]\d)"
    return bool(re.search(pattern, " ".join(quote.split())))


class PortfolioFile(ReviewContract):
    fileId: str


class PortfolioVersion(ReviewContract):
    id: str
    contextId: str
    name: str = Field(min_length=1, max_length=500)
    createdAt: str
    pageCount: int = Field(ge=1, le=30)
    original: PortfolioFile


class PortfolioFinding(ReviewContract):
    basis: Literal["text", "image"]
    category: Literal["message", "evidence", "structure", "visual"]
    quote: str | None
    bbox: NormalizedBBox | None
    diagnosis: str = Field(min_length=1, max_length=600)
    proposedChange: str = Field(min_length=1, max_length=600)
    replacementText: str | None = Field(default=None, min_length=1, max_length=600)

    def verified_replacement(self) -> str | None:
        if self.basis != "text" or not self.quote or self.category == "visual" or not self.replacementText:
            return None
        replacement = self.replacementText.strip()
        if not replacement or " ".join(replacement.split()) == " ".join(self.quote.split()):
            return None
        source_numbers = {re.sub(r"\s+", "", number) for number in _NUMBER.findall(self.quote)}
        replacement_numbers = {re.sub(r"\s+", "", number) for number in _NUMBER.findall(replacement)}
        return replacement if replacement_numbers <= source_numbers else None


class ComparisonSource(ReviewContract):
    kind: Literal["portfolio", "resume", "experience"]
    id: str
    version: str
    title: str = Field(max_length=500)
    text: str = Field(max_length=60000)


class CandidateCitation(ReviewContract):
    source: int = Field(ge=0, le=101)
    quote: str = Field(min_length=1, max_length=800)
    value: str = Field(min_length=1, max_length=160)


class ConflictCandidate(ReviewContract):
    project: str = Field(min_length=1, max_length=120)
    field: Literal["period", "metric", "role"]
    left: CandidateCitation
    right: CandidateCitation


class EvidenceCitation(ReviewContract):
    kind: Literal["portfolio", "resume", "experience"]
    id: str
    version: str
    title: str = Field(max_length=500)
    quote: str = Field(min_length=1, max_length=800)
    value: str = Field(min_length=1, max_length=160)


class DocumentConflict(ReviewContract):
    project: str = Field(min_length=1, max_length=120)
    field: Literal["period", "metric", "role"]
    left: EvidenceCitation
    right: EvidenceCitation


class PortfolioComparison(ReviewContract):
    sources: list[ComparisonSource] = Field(default_factory=list, max_length=101)

    @model_validator(mode="after")
    def comparison_inputs(self):
        ids = {(item.kind, item.id) for item in self.sources}
        if (len(ids) != len(self.sources) or any(item.kind == "portfolio" for item in self.sources)
                or sum(len(item.text) for item in self.sources) > 120000):
            raise ValueError("invalid comparison inputs")
        return self


class PortfolioReview(ReviewContract):
    id: str
    contextId: str
    portfolioVersionId: str
    pageNumber: int = Field(ge=1, le=30)
    policyVersion: Literal["portfolio-1"] = "portfolio-1"
    createdAt: str
    text: str = Field(max_length=24000)
    textStatus: Literal["complete", "unavailable", "failed"]
    imageStatus: Literal["complete", "failed"]
    comparisonStatus: Literal["complete", "unavailable", "failed"] = "unavailable"
    conflicts: list[DocumentConflict] = Field(default_factory=list, max_length=12)
    findings: list[PortfolioFinding] = Field(max_length=12)

    @model_validator(mode="after")
    def check_evidence(self):
        if self.conflicts and self.comparisonStatus != "complete":
            raise ValueError("comparison was not completed")
        for conflict in self.conflicts:
            if (conflict.left.kind, conflict.left.id) == (conflict.right.kind, conflict.right.id):
                raise ValueError("comparison requires different sources")
            if conflict.left.value.strip() == conflict.right.value.strip():
                raise ValueError("comparison requires different values")
            for citation in (conflict.left, conflict.right):
                if not citation_contains_value(citation.quote, citation.value):
                    raise ValueError("value is missing from citation")
                if citation.kind == "portfolio" and (citation.id != self.portfolioVersionId
                        or citation.version != self.portfolioVersionId
                        or " ".join(citation.quote.split()) not in " ".join(self.text.split())):
                    raise ValueError("comparison citation is outside the reviewed page")
        for finding in self.findings:
            if finding.replacementText is not None and finding.verified_replacement() is None:
                raise ValueError("replacement must be grounded in the quoted text")
            if finding.basis == "text" and (self.textStatus != "complete" or not finding.quote
                    or " ".join(finding.quote.split()) not in " ".join(self.text.split())
                    or finding.category == "visual"):
                raise ValueError("finding does not match page text")
            if finding.basis == "image" and self.imageStatus != "complete":
                raise ValueError("image was not reviewed")
        return self
