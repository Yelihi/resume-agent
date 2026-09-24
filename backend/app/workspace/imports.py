import json
from typing import Annotated, Literal

from pydantic import Field, HttpUrl

from app.document_processing.models import FlowDocument, ModuleErrorDTO, PageDocument
from app.review.contracts import (ContextAnalysis, ExperienceRecommendation, MaterialReviewDTO, ModuleResult,
                                  ResolutionCheck, ReviewContext, SpellDiagnostic, SuggestionDTO)
from app.workspace.models import (Contract, ExperienceDocument, ExperienceInput, FileReference,
                                  Identifier, MaterialDraft, Text)
from app.workspace.repository import COLLECTIONS, get, require


class Context(Contract):
    id: Identifier
    name: str = Field(min_length=1, max_length=500)
    createdAt: str = Field(max_length=100)
    latestVersionId: Identifier
    latestReviewId: Identifier | None = None
    lastAttemptId: Identifier | None = None
    selectedExperienceIds: list[Identifier] = Field(default_factory=list, max_length=100)
    userFeedback: str = Field(max_length=2000)


class ResumeVersion(Contract):
    id: Identifier
    contextId: Identifier
    version: int = Field(ge=0)
    createdAt: str = Field(max_length=100)
    inputType: Literal["file", "text"]
    displayName: str = Field(max_length=500)
    original: FileReference | Text | None = None
    status: Literal["extracting", "ready", "failed"]
    documentKind: Literal["page", "flow"] | None = None
    document: PageDocument | FlowDocument | None = None


class Material(Contract):
    id: Identifier
    materialType: Literal["company", "jobPosting"]
    currentVersionId: Identifier | None
    deleted: bool
    draft: MaterialDraft | None = None


class MaterialVersion(MaterialDraft):
    id: Identifier
    materialId: Identifier
    version: int = Field(ge=1)
    createdAt: str = Field(max_length=100)
    legacyUrl: HttpUrl | None = None


class ContextMaterial(Contract):
    id: Annotated[str, Field(min_length=1, max_length=241)]
    contextId: Identifier
    materialId: Identifier


class FeedbackReference(Contract):
    id: Identifier
    contextId: Identifier
    reviewId: Identifier
    decision: Literal["resolve", "skip"]
    rating: Literal["up", "down"] | None


class ContextRefs(ReviewContext):
    feedback: list[FeedbackReference] = Field(default_factory=list)


class ReviewModules(Contract):
    spellCheck: ModuleResult[list[SpellDiagnostic]]
    companyContextAnalysis: ModuleResult[ContextAnalysis] | None = None
    jobPostingAnalysis: ModuleResult[ContextAnalysis] | None = None


class Review(Contract):
    id: Identifier
    contextId: Identifier
    resumeVersionId: Identifier | None
    createdAt: str = Field(max_length=100)
    input: ContextRefs
    status: Literal["success", "partial", "failed", "cancelled"]
    errors: list[ModuleErrorDTO]
    materialReviews: list[MaterialReviewDTO]
    resolutionChecks: list[ResolutionCheck]
    resultIds: list[Identifier]
    suggestionIds: list[Identifier]
    experienceRecommendations: list[ExperienceRecommendation] = Field(default_factory=list)
    modules: ReviewModules
    finalErrors: list[ModuleErrorDTO]
    finalFailed: bool


class SuggestionEntry(Contract):
    id: Identifier
    contextId: Identifier
    reviewId: Identifier
    resumeVersionId: Identifier | None
    content: SuggestionDTO
    rating: Literal["up", "down"] | None
    decision: Literal["open", "resolve", "skip"]
    verification: ResolutionCheck | None = None


class ReviewMaterial(Contract):
    id: Annotated[str, Field(min_length=1, max_length=241)]
    reviewId: Identifier
    materialVersionId: Identifier


class Experience(ExperienceInput):
    id: Identifier
    revision: int = Field(ge=1)
    createdAt: str = Field(max_length=100)
    updatedAt: str = Field(max_length=100)


class SavedExperienceDocument(ExperienceDocument):
    revision: int = Field(ge=1)
    createdAt: str = Field(max_length=100)
    updatedAt: str = Field(max_length=100)


class ImportedWorkspace(Contract):
    contexts: list[Context] = Field(max_length=1000)
    resumeVersions: list[ResumeVersion] = Field(max_length=10000)
    materials: list[Material] = Field(max_length=10000)
    materialVersions: list[MaterialVersion] = Field(max_length=10000)
    contextMaterials: list[ContextMaterial] = Field(max_length=10000)
    reviews: list[Review] = Field(max_length=10000)
    suggestions: list[SuggestionEntry] = Field(max_length=50000)
    reviewMaterials: list[ReviewMaterial] = Field(max_length=50000)
    experiences: list[Experience] = Field(max_length=1000)
    experienceDocuments: list[SavedExperienceDocument] = Field(max_length=10000)


class ImportRequest(Contract):
    importId: Identifier
    workspace: ImportedWorkspace


def validate_relationships(state):
    for collection in COLLECTIONS:
        ids = [item["id"] for item in state[collection]]
        require(len(ids) == len(set(ids)), "이관 자료에 중복 식별자가 있습니다.", 422)
    for context in state["contexts"]:
        require(get(state, "resumeVersions", context["latestVersionId"])["contextId"] == context["id"], "이력서의 작업 공간이 일치하지 않습니다.", 422)
        for key in ("latestReviewId", "lastAttemptId"):
            if context.get(key):
                require(get(state, "reviews", context[key])["contextId"] == context["id"], "검토의 작업 공간이 일치하지 않습니다.", 422)
        for identifier in context.get("selectedExperienceIds", []):
            get(state, "experiences", identifier)
    for version in state["resumeVersions"]:
        get(state, "contexts", version["contextId"])
        if version.get("document"):
            require((version["documentKind"] == "page") == ("pages" in version["document"]), "이력서 종류가 일치하지 않습니다.", 422)
    for material in state["materials"]:
        if material["currentVersionId"]:
            require(get(state, "materialVersions", material["currentVersionId"])["materialId"] == material["id"], "자료 버전 연결이 일치하지 않습니다.", 422)
    for version in state["materialVersions"]:
        require(get(state, "materials", version["materialId"])["materialType"] == version["materialType"], "자료 종류가 일치하지 않습니다.", 422)
    for link in state["contextMaterials"]:
        get(state, "contexts", link["contextId"])
        get(state, "materials", link["materialId"])
        require(link["id"] == f'{link["contextId"]}:{link["materialId"]}', "자료 연결 식별자가 일치하지 않습니다.", 422)
    for experience in state["experiences"]:
        ids = [source["id"] for source in experience["sources"]]
        require(len(ids) == len(set(ids)), "중복된 경험 출처입니다.", 422)
    for document in state["experienceDocuments"]:
        get(state, "contexts", document["contextId"])
        experience = get(state, "experiences", document["experienceId"])
        require(document["input"]["experience"]["id"] == experience["id"], "경험 연결이 일치하지 않습니다.", 422)
        require(get(state, "resumeVersions", document["input"]["resume"]["id"])["contextId"] == document["contextId"], "작성본의 이력서 연결이 일치하지 않습니다.", 422)
        source_ids = {source["id"] for source in experience["sources"]}
        require(all(source["id"] in source_ids for source in document["input"]["experience"]["sources"]) and all(note["sourceId"] in source_ids for note in document["sourceNotes"]), "작성본의 출처 연결이 일치하지 않습니다.", 422)
        for material in document["input"]["materials"]:
            get(state, "materials", material["id"])
            require(any(version["materialId"] == material["id"] and all(version[key] == material[key] for key in ("title", "content", "materialType")) for version in state["materialVersions"]), "작성본의 자료 내용이 일치하지 않습니다.", 422)
    for suggestion in state["suggestions"]:
        review = get(state, "reviews", suggestion["reviewId"])
        require(review["contextId"] == suggestion["contextId"] and review["resumeVersionId"] == suggestion["resumeVersionId"] and suggestion["content"]["id"] == suggestion["id"], "제안 연결이 일치하지 않습니다.", 422)
        previous_id = suggestion["content"].get("previousSuggestionId")
        if previous_id:
            require(get(state, "suggestions", previous_id)["contextId"] == suggestion["contextId"], "이전 제안 연결이 일치하지 않습니다.", 422)
        if suggestion.get("verification"):
            require(get(state, "suggestions", suggestion["verification"]["suggestionId"])["contextId"] == suggestion["contextId"], "제안 확인 연결이 일치하지 않습니다.", 422)
        require(all(item["sourceId"] in review["input"].get("materialVersions", {}) for item in suggestion["content"]["검토자료근거"]), "제안 자료 근거가 일치하지 않습니다.", 422)
    for review in state["reviews"]:
        get(state, "contexts", review["contextId"])
        context = review["input"]
        require(context["contextId"] == review["contextId"], "검토 입력 연결이 일치하지 않습니다.", 422)
        require(get(state, "resumeVersions", context["resumeVersionId"])["contextId"] == review["contextId"], "검토 원문 연결이 일치하지 않습니다.", 422)
        if review["resumeVersionId"]:
            require(review["resumeVersionId"] == context["resumeVersionId"], "검토 원문 버전이 일치하지 않습니다.", 422)
        if context.get("previousReviewId"):
            require(get(state, "reviews", context["previousReviewId"])["contextId"] == review["contextId"], "이전 검토 연결이 일치하지 않습니다.", 422)
        for material_id, version_id in context.get("materialVersions", {}).items():
            require(get(state, "materialVersions", version_id)["materialId"] == material_id, "검토 자료 연결이 일치하지 않습니다.", 422)
        source_ids = set(context.get("materialVersions", {}))
        for item in review["materialReviews"]:
            require(item["sourceId"] in source_ids, "검토 자료 요약 연결이 일치하지 않습니다.", 422)
            require(get(state, "materials", item["sourceId"])["materialType"] == item["materialType"], "검토 자료 종류가 일치하지 않습니다.", 422)
        for module in review["modules"].values():
            if module and isinstance(module.get("output"), dict):
                require(all(item["sourceId"] in source_ids for item in module["output"].get("evidence", []) + module["output"].get("materialSummaries", [])), "검토 모듈의 자료 연결이 일치하지 않습니다.", 422)
        for item in context.get("feedback", []):
            suggestion = get(state, "suggestions", item["id"])
            require(suggestion["contextId"] == review["contextId"] and suggestion["reviewId"] == item["reviewId"], "피드백 연결이 일치하지 않습니다.", 422)
        for identifier in review["resultIds"]:
            require(get(state, "suggestions", identifier)["reviewId"] == review["id"], "검토 결과 연결이 일치하지 않습니다.", 422)
        for identifier in review["suggestionIds"] + [check["suggestionId"] for check in review["resolutionChecks"]] + [item["suggestionId"] for item in context.get("resolved", [])]:
            require(get(state, "suggestions", identifier)["contextId"] == review["contextId"], "검토 제안 연결이 일치하지 않습니다.", 422)
        for candidate in context.get("experiences", []):
            get(state, "experiences", candidate["id"])
        candidate_ids = {item["id"] for item in context.get("experiences", [])}
        for recommendation in review.get("experienceRecommendations", []):
            require(recommendation["experienceId"] in candidate_ids and all(item["sourceId"] in source_ids for item in recommendation["jobEvidence"]), "경험 추천 연결이 일치하지 않습니다.", 422)
    actual_links = {(link["reviewId"], link["materialVersionId"]) for link in state["reviewMaterials"]}
    expected_links = {(review["id"], identifier) for review in state["reviews"] for identifier in review["input"].get("materialVersions", {}).values()}
    require(actual_links == expected_links, "검토 자료 버전 연결이 일치하지 않습니다.", 422)
    for link in state["reviewMaterials"]:
        require(link["id"] == f'{link["reviewId"]}:{link["materialVersionId"]}', "검토 자료 식별자가 일치하지 않습니다.", 422)


def import_workspace(repository, user_id, request: ImportRequest):
    state = request.workspace.model_dump(mode="json", by_alias=True, exclude_unset=True)
    encoded = json.dumps(state, ensure_ascii=False)
    require(len(encoded.encode()) <= 50 * 1024 * 1024, "이관 자료는 50 MB 이하로 업로드해 주세요.", 413)
    with repository.database.connect() as connection:
        connection.execute("CREATE TABLE IF NOT EXISTS workspace_imports(owner_id TEXT NOT NULL REFERENCES users(id), import_id TEXT NOT NULL, PRIMARY KEY(owner_id,import_id))")
        connection.execute("BEGIN IMMEDIATE")
        existing, revision = repository._read(connection, user_id)
        if connection.execute("SELECT 1 FROM workspace_imports WHERE owner_id=? AND import_id=?", (user_id, request.importId)).fetchone():
            return {"workspace": existing, "revision": revision, "result": None}
        # ponytail: only empty-account imports; add merging when users need multiple local archives.
        require(not existing.get("activeRun") and not any(existing[key] for key in COLLECTIONS), "가져오기는 비어 있는 서버 계정에서만 가능합니다.")
        validate_relationships(state)
        repository._validate_files(connection, user_id, state)
        revision += 1
        connection.execute("INSERT INTO workspaces(owner_id,revision,snapshot) VALUES(?,?,?) ON CONFLICT(owner_id) DO UPDATE SET revision=excluded.revision,snapshot=excluded.snapshot", (user_id, revision, encoded))
        connection.execute("INSERT INTO workspace_imports(owner_id,import_id) VALUES(?,?)", (user_id, request.importId))
    return {"workspace": state, "revision": revision, "result": None}
