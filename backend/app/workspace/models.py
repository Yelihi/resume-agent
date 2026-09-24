from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, TypeAdapter, model_validator

from app.document_processing.models import FlowDocument, PageDocument

Identifier = Annotated[str, Field(min_length=1, max_length=120)]
Text = Annotated[str, Field(max_length=100_000)]


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid")


class FileReference(Contract):
    fileId: Identifier


class ResumeInput(Contract):
    inputType: Literal["file", "text"]
    displayName: str = Field(min_length=1, max_length=500)
    original: FileReference | Text
    documentKind: Literal["page", "flow"]
    document: PageDocument | FlowDocument

    @model_validator(mode="after")
    def matching_document(self):
        if (self.documentKind == "page") != isinstance(self.document, PageDocument):
            raise ValueError("document kind must match document")
        if self.inputType == "file" and not isinstance(self.original, FileReference):
            raise ValueError("file input requires an uploaded original")
        return self


class MaterialDraft(Contract):
    title: str = Field(min_length=1, max_length=500)
    materialType: Literal["company", "jobPosting"]
    content: Text
    source: str = Field(max_length=2000)
    original: FileReference | Text | None = None


class ExperienceSource(Contract):
    id: Identifier
    kind: Literal["note", "link", "file"]
    name: str = Field(max_length=500)
    text: Text
    url: HttpUrl | None = None
    original: FileReference | None = None
    createdAt: str = Field(max_length=100)

    @model_validator(mode="after")
    def valid_source(self):
        if self.kind == "link":
            if not self.url or self.url.username or self.url.password or self.original:
                raise ValueError("link requires an HTTP(S) URL without credentials")
        elif self.url or (not self.text.strip() and not (self.kind == "file" and self.original)):
            raise ValueError("note/file requires content and no URL")
        if self.kind == "note" and self.original:
            raise ValueError("note cannot carry a file original")
        return self


class ExperienceInput(Contract):
    title: str = Field(max_length=500)
    period: str = Field(max_length=200)
    sources: list[ExperienceSource] = Field(max_length=100)
    markdown: str | None = Field(default=None, max_length=60_000)
    metadata: str | None = Field(default=None, max_length=12_000)


class ExperienceSnapshot(ExperienceInput):
    id: Identifier
    revision: int = Field(ge=1)


class WritingResume(Contract):
    id: Identifier
    text: Text


class WritingMaterial(Contract):
    id: Identifier
    title: str = Field(max_length=500)
    content: Text
    materialType: Literal["company", "jobPosting"]


class WritingInput(Contract):
    experience: ExperienceSnapshot
    resume: WritingResume
    materials: list[WritingMaterial] = Field(max_length=20)


class SourceNote(Contract):
    sourceId: Identifier
    text: Text
    verified: bool


class ExperienceDocument(Contract):
    id: Identifier
    contextId: Identifier
    experienceId: Identifier
    input: WritingInput
    markdown: str = Field(min_length=1, max_length=60_000)
    summary: str = Field(max_length=10_000)
    questions: list[Annotated[str, Field(max_length=4000)]] = Field(max_length=20)
    sourceNotes: list[SourceNote] = Field(max_length=100)


class Feedback(Contract):
    rating: Literal["up", "down"] | None = None
    decision: Literal["open", "resolve", "skip"] | None = None


ARGUMENTS = {
    "createContext": tuple[Annotated[str, Field(min_length=1, max_length=500)], ResumeInput],
    "addResumeVersion": tuple[Identifier, ResumeInput, Identifier],
    "saveMaterial": tuple[MaterialDraft, Identifier | None, Identifier | None, Identifier | None],
    "attachMaterial": tuple[Identifier, Identifier | Annotated[list[Identifier], Field(max_length=100)]],
    "detachMaterial": tuple[Identifier, Identifier],
    "deleteMaterial": tuple[Identifier],
    "deleteContext": tuple[Identifier],
    "saveExperience": tuple[ExperienceInput, Identifier | None, Annotated[int, Field(ge=1)] | None],
    "saveExperienceDocument": tuple[ExperienceDocument, Annotated[int, Field(ge=1)] | None],
    "deleteExperienceDocument": tuple[Identifier],
    "setSuggestionFeedback": tuple[Identifier, Identifier, Feedback],
    "saveReviewFeedback": tuple[Identifier, Annotated[str, Field(max_length=2000)]],
    "setContextExperiences": tuple[Identifier, Annotated[list[Identifier], Field(max_length=100)]],
    "prepareReview": tuple[Identifier],
    "prepareRetry": tuple[Identifier],
    "restoreRecord": tuple[Identifier],
    "clearActiveRun": tuple[Identifier],
    # Compatibility acknowledgements carry IDs only; records and run inputs are server-owned.
    "registerRun": tuple[Identifier],
    "completeReview": tuple[Identifier],
}
OPTIONAL_COUNTS = {"saveMaterial": 4, "saveExperience": 3, "saveExperienceDocument": 2}


class Command(Contract):
    operation: Literal[tuple(ARGUMENTS)]
    args: list[Any] = Field(max_length=4)

    @model_validator(mode="after")
    def validate_arguments(self):
        args = self.args + [None] * max(0, OPTIONAL_COUNTS.get(self.operation, 0) - len(self.args))
        adapter = TypeAdapter(ARGUMENTS[self.operation])
        validated = adapter.validate_python(args)
        self.args = list(adapter.dump_python(validated, mode="json", exclude_unset=True))
        if len(str(self.args)) > 2_000_000:
            raise ValueError("workspace command is too large")
        return self
