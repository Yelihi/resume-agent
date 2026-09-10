from enum import StrEnum
from typing import Generic, Literal, TypeVar

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, model_validator

from app.document_processing.models import FlowDocument, ModuleErrorDTO, PageDocument
from app.reference_material.models import MaterialType, ReferenceMaterial


class ReviewContract(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class SuggestionLocation(ReviewContract):
    lineIds: list[str] = Field(min_length=1, max_length=3)
    quote: str = Field(min_length=1)


SuggestionKind = Literal[
    "맞춤법",
    "사실성",
    "근거",
    "직무 관련성",
    "회사 맥락",
    "뉘앙스",
    "가독성",
    "기밀",
]
ReviewSource = Literal["기본 검토", "채용 공고", "회사 자료"]
MaterialReviewStatus = Literal["applied", "notApplied"]


class MaterialEvidence(ReviewContract):
    sourceId: str = Field(min_length=1)
    consideredPoint: str = Field(min_length=1)


class MaterialReviewDTO(ReviewContract):
    sourceId: str = Field(min_length=1)
    materialType: MaterialType
    status: MaterialReviewStatus
    reason: str = Field(min_length=1)


class SuggestionDTO(ReviewContract):
    location: SuggestionLocation = Field(alias="수정포인트위치")
    kind: SuggestionKind = Field(alias="수정성격")
    reviewSources: list[ReviewSource] = Field(alias="검토출처", min_length=1, max_length=3)
    materialEvidence: list[MaterialEvidence] = Field(alias="검토자료근거")
    reasonAndSuggestion: str = Field(alias="이유 및 제안", min_length=1)
    example: str = Field(alias="실제 수정 예시", min_length=1)


class AiReviewOutput(ReviewContract):
    materialReviews: list[MaterialReviewDTO]
    results: list[SuggestionDTO]


class ReviewStatus(StrEnum):
    SUCCESS = "success"
    PARTIAL = "partial"
    FAILED = "failed"
    CANCELLED = "cancelled"


class ReviewResponse(ReviewContract):
    status: ReviewStatus
    errors: list[ModuleErrorDTO]
    materialReviews: list[MaterialReviewDTO]
    results: list[SuggestionDTO]


class PreviousReview(ReviewContract):
    results: list[SuggestionDTO]
    userFeedback: str | None = Field(default=None, min_length=1)


OutputT = TypeVar("OutputT")


class ModuleResult(ReviewContract, Generic[OutputT]):
    moduleKey: str
    output: OutputT | None
    errors: list[ModuleErrorDTO]


class ContextEvidence(ReviewContract):
    sourceId: str
    statement: str = Field(min_length=1)


class ContextAnalysis(ReviewContract):
    summary: str = Field(min_length=1)
    evidence: list[ContextEvidence]


class SpellDiagnostic(ReviewContract):
    lineId: str
    quote: str
    replacement: str
    reason: str


class CompletedModules(ReviewContract):
    spellCheck: ModuleResult[list[SpellDiagnostic]]
    companyContextAnalysis: ModuleResult[ContextAnalysis] | None = None
    jobPostingAnalysis: ModuleResult[ContextAnalysis] | None = None
    finalReview: ModuleResult[AiReviewOutput]

    @model_validator(mode="after")
    def matching_keys(self):
        for key in type(self).model_fields:
            result = getattr(self, key)
            if result is not None and (
                result.moduleKey != key
                or any(error.moduleKey != key for error in result.errors)
                or (result.output is None and not result.errors)
            ):
                raise ValueError("invalid completed module")
        return self


class ReviewRecord(ReviewContract):
    """JSON record shared by storage and retry; contains no runtime objects."""

    runId: str = Field(min_length=1)
    createdAt: AwareDatetime
    document: PageDocument | FlowDocument
    materials: list[ReferenceMaterial]
    previousReview: PreviousReview | None = None
    moduleResults: CompletedModules
    response: ReviewResponse

    @model_validator(mode="after")
    def matching_materials(self):
        source_ids = [item.sourceId for item in self.materials]
        if len(source_ids) != len(set(source_ids)):
            raise ValueError("source IDs must be unique")
        for key, kind in (("companyContextAnalysis", MaterialType.COMPANY),
                          ("jobPostingAnalysis", MaterialType.JOB_POSTING)):
            module = getattr(self.moduleResults, key)
            sources = {item.sourceId for item in self.materials if item.materialType == kind}
            if bool(sources) != (module is not None):
                raise ValueError("completed modules must match input materials")
            if module and module.output and any(item.sourceId not in sources for item in module.output.evidence):
                raise ValueError("unknown analysis source")
        return self
