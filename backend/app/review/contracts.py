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
    id: str | None = None
    previousSuggestionId: str | None = None
    location: SuggestionLocation = Field(alias="수정포인트위치")
    kind: SuggestionKind = Field(alias="수정성격")
    reviewSources: list[ReviewSource] = Field(alias="검토출처", min_length=1, max_length=3)
    materialEvidence: list[MaterialEvidence] = Field(alias="검토자료근거")
    reasonAndSuggestion: str = Field(alias="이유 및 제안", min_length=1)
    example: str = Field(alias="실제 수정 예시", min_length=1)


class ResolutionCheck(ReviewContract):
    suggestionId: str = Field(min_length=1)
    status: Literal["resolved", "notApplied", "uncertain"]
    reason: str = Field(min_length=1)
    evidence: SuggestionLocation | None = None


class SuggestionFeedback(ReviewContract):
    id: str = Field(min_length=1)
    contextId: str = Field(min_length=1)
    reviewId: str = Field(min_length=1)
    decision: Literal["resolve", "skip"]
    rating: Literal["up", "down"] | None = None
    suggestion: SuggestionDTO


class ResolvedMemory(ReviewContract):
    suggestionId: str = Field(min_length=1)
    quote: str = Field(min_length=1)
    reason: str = Field(min_length=1)


class ExperienceCandidate(ReviewContract):
    id: str = Field(min_length=1, max_length=120)
    title: str = Field(min_length=1, max_length=500)
    period: str = Field(max_length=200)
    revision: int = Field(ge=1)
    markdown: str = Field(min_length=1, max_length=60000)
    metadata: str = Field(max_length=12000)

    @model_validator(mode="after")
    def nonblank_content(self):
        if any(not value.strip() for value in (self.id, self.title, self.markdown)):
            raise ValueError("experience ID, title and markdown must not be blank")
        return self


class ExperienceRecommendation(ReviewContract):
    experienceId: str = Field(min_length=1)
    decision: Literal["include", "suggest", "omit"]
    reason: str = Field(min_length=1)
    jobEvidence: list[MaterialEvidence]
    resumeBullets: list[str] = Field(max_length=4)
    placement: str

    @model_validator(mode="after")
    def nonblank_reason(self):
        if not self.reason.strip():
            raise ValueError("recommendation reason must not be blank")
        return self


class ReviewContext(ReviewContract):
    contextId: str = Field(min_length=1)
    resumeVersionId: str = Field(min_length=1)
    materialVersions: dict[str, str] = Field(default_factory=dict)
    previousReviewId: str | None = None
    feedback: list[SuggestionFeedback] = Field(default_factory=list)
    resolved: list[ResolvedMemory] = Field(default_factory=list)
    userFeedback: str | None = Field(default=None, max_length=2000)
    experiences: list[ExperienceCandidate] = Field(default_factory=list, max_length=100)
    selectedExperienceIds: list[str] = Field(default_factory=list, max_length=100)

    @model_validator(mode="after")
    def scoped_feedback(self):
        ids = [item.id for item in self.feedback]
        if len(ids) != len(set(ids)) or any(item.contextId != self.contextId for item in self.feedback):
            raise ValueError("feedback must be unique and belong to this context")
        if any(not value.strip() for value in self.materialVersions.values()):
            raise ValueError("material version IDs must not be empty")
        resolved_ids = [item.suggestionId for item in self.resolved]
        if len(resolved_ids) != len(set(resolved_ids)) or set(ids) & set(resolved_ids):
            raise ValueError("resolved memory must be unique")
        experience_ids = {item.id for item in self.experiences}
        selected_ids = set(self.selectedExperienceIds)
        if len(experience_ids) != len(self.experiences):
            raise ValueError("experience IDs must be unique")
        if len(selected_ids) != len(self.selectedExperienceIds) or not selected_ids <= experience_ids:
            raise ValueError("selected experience IDs must be unique and match candidates")
        if sum(len(item.markdown) + len(item.metadata) + len(item.title) + len(item.period) + len(item.id)
               for item in self.experiences) > 600000:
            raise ValueError("experience input exceeds 600000 characters")
        return self


class AiReviewOutput(ReviewContract):
    experienceRecommendations: list[ExperienceRecommendation] = Field(default_factory=list)
    resolutionChecks: list[ResolutionCheck] = Field(default_factory=list)
    materialReviews: list[MaterialReviewDTO]
    results: list[SuggestionDTO]


class ReviewStatus(StrEnum):
    SUCCESS = "success"
    PARTIAL = "partial"
    FAILED = "failed"
    CANCELLED = "cancelled"


class ReviewResponse(ReviewContract):
    experienceRecommendations: list[ExperienceRecommendation] = Field(default_factory=list)
    resolutionChecks: list[ResolutionCheck] = Field(default_factory=list)
    status: ReviewStatus
    errors: list[ModuleErrorDTO]
    materialReviews: list[MaterialReviewDTO]
    results: list[SuggestionDTO]


class PreviousReview(ReviewContract):
    results: list[SuggestionDTO]
    userFeedback: str | None = Field(default=None, min_length=1, max_length=2000)


OutputT = TypeVar("OutputT")


class ModuleResult(ReviewContract, Generic[OutputT]):
    moduleKey: str
    output: OutputT | None
    errors: list[ModuleErrorDTO]


class ContextEvidence(ReviewContract):
    sourceId: str
    statement: str = Field(min_length=1)


class MaterialSummary(ReviewContract):
    sourceId: str = Field(min_length=1)
    summary: str = Field(min_length=1, max_length=240)


class ContextAnalysis(ReviewContract):
    summary: str = Field(min_length=1)
    evidence: list[ContextEvidence]
    materialSummaries: list[MaterialSummary] = Field(default_factory=list)


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
    reviewContext: ReviewContext | None = None
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
        if self.reviewContext and set(self.reviewContext.materialVersions) != set(source_ids):
            raise ValueError("material versions must match sources")
        for key, kind in (("companyContextAnalysis", MaterialType.COMPANY),
                          ("jobPostingAnalysis", MaterialType.JOB_POSTING)):
            module = getattr(self.moduleResults, key)
            sources = {item.sourceId for item in self.materials if item.materialType == kind}
            if bool(sources) != (module is not None):
                raise ValueError("completed modules must match input materials")
            if module and module.output and any(item.sourceId not in sources for item in module.output.evidence):
                raise ValueError("unknown analysis source")
            if module and module.output:
                summary_ids = [item.sourceId for item in module.output.materialSummaries]
                if len(summary_ids) != len(set(summary_ids)) or any(key not in sources for key in summary_ids):
                    raise ValueError("invalid summary source")
        return self
