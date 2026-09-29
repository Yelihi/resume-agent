import json
from datetime import datetime, timezone
from uuid import uuid4

from fastapi import HTTPException

from app.workspace.models import Command

COLLECTIONS = ("contexts", "resumeVersions", "materials", "materialVersions", "contextMaterials",
               "reviews", "suggestions", "reviewMaterials", "experiences", "experienceDocuments")


def now():
    return datetime.now(timezone.utc).isoformat()


def require(condition, message, status=409):
    if not condition:
        raise HTTPException(status, message)
    return condition


def find(state, collection, identifier):
    return next((item for item in state[collection] if item["id"] == identifier), None)


def get(state, collection, identifier):
    return require(find(state, collection, identifier), "자료를 찾을 수 없습니다.", 404)


def editable(state, identifier):
    context = get(state, "contexts", identifier)
    require(state.get("activeRun", {}).get("contextId") != identifier, "진행 중인 검토를 먼저 완료하거나 취소해 주세요.")
    return context


def refs(review_context):
    return {**review_context, "feedback": [{key: value for key, value in item.items() if key != "suggestion"}
                                          for item in review_context.get("feedback", [])]}


def file_ids(value):
    if isinstance(value, dict):
        return ({value["fileId"]} if "fileId" in value else set()).union(*(file_ids(child) for child in value.values()))
    if isinstance(value, list):
        return set().union(*(file_ids(child) for child in value))
    return set()


class WorkspaceRepository:
    def __init__(self, database=None):
        if database is None:
            from app.deployment.database import get_database
            database = get_database()
        self.database = database
        with database.connect() as connection:
            connection.execute("""CREATE TABLE IF NOT EXISTS workspaces (
                owner_id TEXT PRIMARY KEY REFERENCES users(id), revision INTEGER NOT NULL,
                snapshot TEXT NOT NULL)""")

    def _read(self, connection, owner):
        row = connection.execute("SELECT revision,snapshot FROM workspaces WHERE owner_id=?", (owner,)).fetchone()
        return (json.loads(row["snapshot"]), row["revision"]) if row else ({key: [] for key in COLLECTIONS}, 0)

    def load(self, user_id):
        with self.database.connect() as connection:
            state, revision = self._read(connection, user_id)
            return {"workspace": state, "revision": revision}

    def _write(self, user_id, action):
        # ponytail: whole-workspace transactions suit a few users; normalize tables when snapshots grow large.
        with self.database.connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            state, revision = self._read(connection, user_id)
            previous_files = file_ids(state)
            result = action(state)
            self._validate_files(connection, user_id, state)
            revision += 1
            connection.execute("""INSERT INTO workspaces(owner_id,revision,snapshot) VALUES(?,?,?)
                ON CONFLICT(owner_id) DO UPDATE SET revision=excluded.revision,snapshot=excluded.snapshot""",
                               (user_id, revision, json.dumps(state, ensure_ascii=False)))
            removed_files = previous_files - file_ids(state)
            for identifier in removed_files:
                connection.execute("DELETE FROM files WHERE id=? AND owner_id=?", (identifier, user_id))
        if removed_files:
            # Keep backup's writer lock through file reads; committed deletions are safe to unlink afterward.
            with self.database.connect() as connection:
                connection.execute("BEGIN IMMEDIATE")
                for identifier in removed_files:
                    (self.database.data_dir / "files" / identifier).unlink(missing_ok=True)
        return {"workspace": state, "revision": revision, "result": result}

    def _validate_files(self, connection, owner, value):
        if isinstance(value, dict):
            if "fileId" in value:
                require(connection.execute("SELECT 1 FROM files WHERE id=? AND owner_id=?",
                                           (value["fileId"], owner)).fetchone(), "원본 파일을 찾을 수 없습니다.", 404)
            for child in value.values():
                self._validate_files(connection, owner, child)
        elif isinstance(value, list):
            for child in value:
                self._validate_files(connection, owner, child)

    def command(self, user_id, operation, args):
        command = Command(operation=operation, args=args)
        operation, args = command.operation, command.args
        if operation in {"prepareReview", "prepareRetry", "restoreRecord", "registerRun", "completeReview", "clearActiveRun"}:
            loaded = self.load(user_id)
            state = loaded["workspace"]
            if operation == "prepareReview":
                result = self._prepare(state, args[0])
            elif operation == "prepareRetry":
                result = self._retry(state, args[0])
            elif operation == "restoreRecord":
                result = self._restore(state, args[0])
            else:
                active = state.get("activeRun")
                if operation == "registerRun":
                    require((active and active["runId"] == args[0]) or find(state, "reviews", args[0]), "서버에서 시작한 검토가 아닙니다.")
                elif operation == "completeReview":
                    get(state, "reviews", args[0])
                else:
                    require(not active or active["runId"] != args[0], "검토 취소 API로 실행을 먼저 취소해 주세요.")
                result = None
            return {**loaded, "result": result}
        return self._write(user_id, lambda state: self._mutate(state, operation, args))

    def _mutate(self, state, operation, args):
        if operation == "createContext":
            name, resume = args
            require(name.strip(), "작업 이름을 입력해 주세요.", 422)
            identifier, version_id, created = str(uuid4()), str(uuid4()), now()
            state["contexts"].append(dict(id=identifier, name=name.strip(), createdAt=created, latestVersionId=version_id, userFeedback=""))
            state["resumeVersions"].append({**resume, "status": "ready", "id": version_id, "contextId": identifier, "version": 1, "createdAt": created})
            return identifier
        if operation == "addResumeVersion":
            context_id, resume, base = args
            context = editable(state, context_id)
            require(context["latestVersionId"] == base, "다른 화면에서 수정본이 저장됐습니다. 최신 내용을 확인해 주세요.")
            old = get(state, "resumeVersions", base)
            version_id = str(uuid4())
            state["resumeVersions"].append({**resume, "status": "ready", "id": version_id, "contextId": context_id, "version": old["version"] + 1, "createdAt": now()})
            context["latestVersionId"] = version_id
        elif operation == "saveMaterial":
            draft, material_id, context_id, base = args
            require(draft["title"].strip() and draft["content"].strip(), "자료 제목과 내용을 입력해 주세요.", 422)
            if context_id:
                editable(state, context_id)
            material = get(state, "materials", material_id) if material_id else None
            require(not material or not material["deleted"], "삭제한 자료입니다.")
            require(not material or material["currentVersionId"] == base, "자료가 갱신됐습니다. 최신 내용을 다시 열어 주세요.")
            old = get(state, "materialVersions", base) if material and base else None
            require(not old or old["materialType"] == draft["materialType"], "기존 자료의 종류는 변경할 수 없습니다.")
            material_id = material_id or str(uuid4())
            if not old or any(old.get(key) != draft.get(key) for key in ("title", "content", "source", "original")):
                version_id = str(uuid4())
                state["materialVersions"].append({**draft, "title": draft["title"].strip(), "id": version_id, "materialId": material_id,
                                                  "version": (old["version"] if old else 0) + 1, "createdAt": now()})
                if material:
                    material["currentVersionId"] = version_id
                else:
                    state["materials"].append(dict(id=material_id, materialType=draft["materialType"], currentVersionId=version_id, deleted=False))
            if context_id:
                self._attach(state, context_id, material_id)
            return material_id
        elif operation == "attachMaterial":
            context_id, ids = args
            editable(state, context_id)
            for identifier in ([ids] if isinstance(ids, str) else ids):
                material = get(state, "materials", identifier)
                require(not material["deleted"] and material["currentVersionId"], "저장 완료된 자료를 선택해 주세요.")
                self._attach(state, context_id, identifier)
        elif operation == "detachMaterial":
            context_id, material_id = args
            editable(state, context_id)
            state["contextMaterials"] = [item for item in state["contextMaterials"] if item["id"] != f"{context_id}:{material_id}"]
        elif operation == "deleteMaterial":
            material = get(state, "materials", args[0])
            material["deleted"] = True
            state["contextMaterials"] = [item for item in state["contextMaterials"] if item["materialId"] != args[0]]
            self._collect_materials(state)
        elif operation == "deleteContext":
            context_id = args[0]
            editable(state, context_id)
            review_ids = {item["id"] for item in state["reviews"] if item["contextId"] == context_id}
            state["reviewMaterials"] = [item for item in state["reviewMaterials"] if item["reviewId"] not in review_ids]
            for collection in ("resumeVersions", "reviews", "suggestions", "contextMaterials", "experienceDocuments"):
                state[collection] = [item for item in state[collection] if item["contextId"] != context_id]
            state["contexts"] = [item for item in state["contexts"] if item["id"] != context_id]
            self._collect_materials(state)
        elif operation == "saveExperience":
            draft, identifier, base = args
            require(all(source["text"].strip() or source.get("url") or source.get("original") for source in draft["sources"]), "빈 원본 자료입니다.", 422)
            if draft.get("markdown") is not None:
                require(draft["markdown"].strip() and (draft.get("metadata") or "").strip(), "경험 본문과 메타데이터를 확인해 주세요.", 422)
            old = get(state, "experiences", identifier) if identifier else None
            require(not old or old["revision"] == base, "경험 기록이 변경됐습니다. 최신 기록을 다시 열어 주세요.")
            removed = draft.pop("removedSourceIds", [])
            old_sources = (old or {}).get("sources", [])
            require(len(removed) == len(set(removed)) and set(removed) <= {source["id"] for source in old_sources}, "삭제할 원본 자료를 다시 확인해 주세요.")
            sources = [source for source in old_sources if source["id"] not in removed] + draft["sources"]
            require(sources or (draft.get("markdown", (old or {}).get("markdown")) or "").strip(), "메모, 링크 또는 파일을 추가해 주세요.", 422)
            require(len(sources) <= 100, "한 경험에는 원본을 100개까지 보관할 수 있습니다.", 422)
            source_ids = [source["id"] for source in draft["sources"]]
            require(len(source_ids) == len(set(source_ids)) and not set(source_ids) & {source["id"] for source in (old or {}).get("sources", [])}, "이미 저장한 원본은 다시 추가할 수 없습니다.")
            identifier, updated = identifier or str(uuid4()), now()
            title = draft["title"].strip() or (old or {}).get("title") or (draft.get("markdown") or "").split("\n")[0].lstrip("# ")[:80] or (draft["sources"][0]["name"][:80] if draft["sources"] else "경험")
            item = {**(old or {}), **draft, "id": identifier, "title": title, "sources": sources, "revision": (old or {}).get("revision", 0) + 1, "createdAt": (old or {}).get("createdAt", updated), "updatedAt": updated}
            if old:
                old.update(item)
            else:
                state["experiences"].append(item)
            state["experiences"].sort(key=lambda item: item["updatedAt"], reverse=True)
            return identifier
        elif operation == "saveExperienceDocument":
            document, base = args
            require(document["markdown"].strip(), "작성할 내용을 입력해 주세요.", 422)
            get(state, "contexts", document["contextId"])
            experience = get(state, "experiences", document["experienceId"])
            resume = get(state, "resumeVersions", document["input"]["resume"]["id"])
            old = find(state, "experienceDocuments", document["id"])
            require((old and old["contextId"] == document["contextId"] and old["experienceId"] == document["experienceId"] and old["revision"] == base) or (not old and base is None), "다른 화면에서 작성본을 수정했습니다. 최신 작성본을 다시 열어 주세요.")
            source_ids = {source["id"] for source in experience["sources"]}
            historical_sources = old["input"]["experience"]["sources"] if old else []
            require(resume["contextId"] == document["contextId"] and document["input"]["experience"]["id"] == experience["id"] and all(source["id"] in source_ids or source in historical_sources for source in document["input"]["experience"]["sources"]), "작성본의 원본 연결을 확인해 주세요.")
            for item in document["input"]["materials"]:
                get(state, "materials", item["id"])
                require(any(version["materialId"] == item["id"] and all(version[key] == item[key] for key in ("title", "content", "materialType")) for version in state["materialVersions"]), "작성본의 자료 연결을 확인해 주세요.")
            note_source_ids = source_ids | {source["id"] for source in historical_sources} | {note["sourceId"] for note in (old or {}).get("sourceNotes", [])}
            require(all(note["sourceId"] in note_source_ids for note in document["sourceNotes"]), "작성본의 출처를 확인해 주세요.")
            updated = now()
            item = {**document, "revision": (old or {}).get("revision", 0) + 1, "createdAt": (old or {}).get("createdAt", updated), "updatedAt": updated}
            if old:
                old.update(item)
            else:
                state["experienceDocuments"].append(item)
        elif operation == "deleteExperienceDocument":
            state["experienceDocuments"] = [item for item in state["experienceDocuments"] if item["id"] != args[0]]
        elif operation == "setSuggestionFeedback":
            context_id, identifier, change = args
            context = editable(state, context_id)
            item = get(state, "suggestions", identifier)
            latest = find(state, "reviews", context.get("latestReviewId"))
            require(item["contextId"] == context_id and latest and identifier in latest["suggestionIds"], "현재 작업 공간의 제안만 변경할 수 있습니다.")
            require(change.get("decision", "open") is not None, "제안 결정을 확인해 주세요.", 422)
            item.update(change)
        elif operation == "saveReviewFeedback":
            editable(state, args[0])["userFeedback"] = args[1]
        elif operation == "setContextExperiences":
            context = editable(state, args[0])
            ids = list(dict.fromkeys(args[1]))
            for identifier in ids:
                item = get(state, "experiences", identifier)
                require((item.get("markdown") or "").strip() and (item.get("metadata") or "").strip(), "경험 본문과 메타데이터를 먼저 저장해 주세요.")
            context["selectedExperienceIds"] = ids

    def _attach(self, state, context_id, material_id):
        identifier = f"{context_id}:{material_id}"
        if not find(state, "contextMaterials", identifier):
            state["contextMaterials"].append(dict(id=identifier, contextId=context_id, materialId=material_id))

    def _collect_materials(self, state):
        keep = set(state.get("activeRun", {}).get("input", {}).get("materialVersions", {}).values())
        keep.update(item["materialVersionId"] for item in state["reviewMaterials"])
        keep.update(item["id"] for item in state["materialVersions"] if not get(state, "materials", item["materialId"])["deleted"])
        document_materials = {item["id"] for document in state["experienceDocuments"] for item in document["input"]["materials"]}
        keep.update(item["id"] for item in state["materialVersions"] if item["materialId"] in document_materials)
        state["materialVersions"] = [item for item in state["materialVersions"] if item["id"] in keep]
        ids = {item["materialId"] for item in state["materialVersions"]}
        state["materials"] = [item for item in state["materials"] if not item["deleted"] or item["id"] in ids]

    def _materials(self, state, versions):
        result = []
        for source_id, version_id in versions.items():
            version = get(state, "materialVersions", version_id)
            require(version["materialId"] == source_id, "자료 버전의 연결이 올바르지 않습니다.")
            url = version.get("legacyUrl")
            result.append(dict(sourceId=source_id, materialType=version["materialType"], inputType="url" if url else "document", content=None if url else version["content"], url=url))
        return result

    def _memory(self, state, context, allow_open=False):
        previous = find(state, "reviews", context.get("latestReviewId"))
        active = [item for item in state["suggestions"] if item["id"] in (previous or {}).get("suggestionIds", [])]
        require(allow_open or not any(item["decision"] == "open" for item in active), "각 제안에 Resolve 또는 Skip을 선택해 주세요.")
        active_ids = {item["id"] for item in active}
        feedback = [{**{key: item[key] for key in ("id", "contextId", "reviewId", "decision", "rating")}, "suggestion": item["content"]}
                    for item in state["suggestions"] if item["contextId"] == context["id"] and item["decision"] != "open" and (item["decision"] == "skip" or item["id"] in active_ids)]
        resolved = [dict(suggestionId=check["suggestionId"], reason=check["reason"], quote=get(state, "suggestions", check["suggestionId"])["content"]["수정포인트위치"]["quote"])
                    for check in (previous or {}).get("resolutionChecks", []) if check["status"] == "resolved"]
        return dict(contextId=context["id"], previousReviewId=(previous or {}).get("id"), feedback=feedback, resolved=resolved, userFeedback=context["userFeedback"] or None)

    def _prepare(self, state, context_id):
        require(not state.get("activeRun"), "다른 검토가 진행 중입니다.")
        context = get(state, "contexts", context_id)
        resume = get(state, "resumeVersions", context["latestVersionId"])
        require(resume.get("document") and resume.get("documentKind") and resume["status"] == "ready", "이력서 추출을 완료해 주세요.")
        versions = {}
        for link in state["contextMaterials"]:
            if link["contextId"] == context_id:
                material = get(state, "materials", link["materialId"])
                require(not material["deleted"] and material["currentVersionId"], "자료를 저장해 주세요.")
                versions[material["id"]] = material["currentVersionId"]
        materials = self._materials(state, versions)
        has_jd = any(item["materialType"] == "jobPosting" for item in materials)
        experiences = [{key: item[key] for key in ("id", "title", "period", "revision", "markdown", "metadata")}
                       for item in state["experiences"] if has_jd and (item.get("markdown") or "").strip() and (item.get("metadata") or "").strip()]
        require(len(experiences) <= 100 and len(json.dumps(experiences, ensure_ascii=False)) <= 600_000, "검토할 경험 자료가 너무 큽니다.")
        selected = context.get("selectedExperienceIds", []) if has_jd else []
        require(set(selected) <= {item["id"] for item in experiences}, "선택한 경험 본문과 메타데이터를 확인해 주세요.")
        return dict(kind=resume["documentKind"], document=resume["document"], materials=materials,
                    reviewContext={**self._memory(state, context), "resumeVersionId": resume["id"], "materialVersions": versions, "experiences": experiences, "selectedExperienceIds": selected})

    def prepare_review(self, user_id, context_id):
        return self._prepare(self.load(user_id)["workspace"], context_id)

    def _restore(self, state, review_id):
        review = get(state, "reviews", review_id)
        resume = get(state, "resumeVersions", review["resumeVersionId"])
        result = dict(materialReviews=review["materialReviews"], experienceRecommendations=review.get("experienceRecommendations", []), resolutionChecks=review["resolutionChecks"], results=[get(state, "suggestions", identifier)["content"] for identifier in review["resultIds"]])
        context = {**review["input"], "feedback": [{**item, "suggestion": get(state, "suggestions", item["id"])["content"]} for item in review["input"].get("feedback", [])]}
        return dict(runId=review_id, createdAt=review["createdAt"], document=resume["document"], materials=self._materials(state, context.get("materialVersions", {})), reviewContext=context,
                    response={**result, "status": review["status"], "errors": review["errors"]}, moduleResults={**review["modules"], "finalReview": dict(moduleKey="finalReview", errors=review["finalErrors"], output=None if review["finalFailed"] else result)})

    def _retry(self, state, review_id):
        require(not state.get("activeRun"), "진행 중인 검토를 먼저 완료하거나 취소해 주세요.")
        record = self._restore(state, review_id)
        context = get(state, "contexts", record["reviewContext"]["contextId"])
        require(context.get("lastAttemptId") == review_id, "최신 검토 기록을 확인해 주세요.")
        require(any(error["canRetry"] for error in record["response"]["errors"]), "다시 실행할 오류가 없습니다.")
        record["reviewContext"].update(self._memory(state, context, True))
        return record

    def prepare_retry(self, user_id, review_id):
        return self._retry(self.load(user_id)["workspace"], review_id)

    def register_run(self, user_id, run_id, prepared):
        def register(state):
            require(not state.get("activeRun"), "이미 진행 중인 검토가 있습니다.")
            context = prepared["reviewContext"]
            get(state, "contexts", context["contextId"])
            resume = get(state, "resumeVersions", context["resumeVersionId"])
            require(resume["contextId"] == context["contextId"], "이력서 연결이 올바르지 않습니다.")
            require(resume["document"] == prepared["document"], "검토 원문이 변경됐습니다.")
            self._materials(state, context.get("materialVersions", {}))
            for feedback in context.get("feedback", []):
                suggestion = get(state, "suggestions", feedback["id"])
                require(suggestion["contextId"] == context["contextId"] and suggestion["reviewId"] == feedback["reviewId"], "이전 제안 연결이 올바르지 않습니다.")
            state["activeRun"] = dict(runId=run_id, contextId=context["contextId"], input=refs(context))
        return self._write(user_id, register)

    def clear_active_run(self, user_id, run_id):
        def clear(state):
            if state.get("activeRun", {}).get("runId") == run_id:
                del state["activeRun"]
                self._collect_materials(state)
        return self._write(user_id, clear)

    def interrupt_pending_runs(self):
        with self.database.connect() as connection:
            owners = [row["owner_id"] for row in connection.execute("SELECT owner_id FROM workspaces")]
        interrupted = 0
        for owner in owners:
            state = self.load(owner)["workspace"]
            active = state.get("activeRun")
            if not active:
                continue
            context = {**active["input"], "feedback": [{**item, "suggestion": get(state, "suggestions", item["id"])["content"]} for item in active["input"].get("feedback", [])]}
            materials = self._materials(state, context.get("materialVersions", {}))
            keys = ["spellCheck", "finalReview"]
            for kind, key in (("company", "companyContextAnalysis"), ("jobPosting", "jobPostingAnalysis")):
                if any(item["materialType"] == kind for item in materials):
                    keys.append(key)
            modules = {key: dict(moduleKey=key, output=None, errors=[dict(moduleKey=key, inputSourceId=None, errorCode="SERVER_RESTARTED", userMessage="서버가 재시작되어 검토가 중단됐습니다. 다시 실행해 주세요.", canRetry=True)]) for key in keys}
            self.commit_review(owner, dict(runId=active["runId"], createdAt=now(), reviewContext=context,
                document=get(state, "resumeVersions", context["resumeVersionId"])["document"], materials=materials,
                response=dict(status="failed", errors=[error for module in modules.values() for error in module["errors"]], materialReviews=[], results=[]), moduleResults=modules))
            interrupted += 1
        return interrupted

    def commit_review(self, user_id, record):
        if hasattr(record, "model_dump"):
            record = record.model_dump(mode="json", by_alias=True)

        def commit(state):
            if find(state, "reviews", record["runId"]):
                return
            active = require(state.get("activeRun"), "저장할 실행을 찾을 수 없습니다.")
            require(active["runId"] == record["runId"], "다른 실행의 결과는 저장할 수 없습니다.")
            context = get(state, "contexts", active["contextId"])
            require(record.get("reviewContext") and record["reviewContext"]["contextId"] == active["contextId"] and record["reviewContext"]["resumeVersionId"] == active["input"]["resumeVersionId"], "검토 결과의 작업 공간이 일치하지 않습니다.")
            response = record["response"]
            if response["status"] == "cancelled":
                del state["activeRun"]
                self._collect_materials(state)
                return
            previous = find(state, "reviews", context.get("latestReviewId"))
            successful = response["status"] in {"success", "partial"}
            result_ids, suggestion_ids = [], []
            checks = response.get("resolutionChecks", [])
            if successful:
                for raw in response["results"]:
                    content = {**raw, "id": raw.get("id") or str(uuid4()), "previousSuggestionId": raw.get("previousSuggestionId"), "검토출처": raw.get("검토출처") or ["기본 검토"], "검토자료근거": raw.get("검토자료근거", [])}
                    old = get(state, "suggestions", content["previousSuggestionId"]) if content["previousSuggestionId"] else None
                    require(not old or old["contextId"] == context["id"], "다른 작업 공간의 제안입니다.")
                    require(not find(state, "suggestions", content["id"]), "중복된 제안 식별자입니다.")
                    item = dict(id=content["id"], contextId=context["id"], reviewId=record["runId"], resumeVersionId=active["input"]["resumeVersionId"], content=content, rating=(old or {}).get("rating"), decision="open")
                    check = next((check for check in checks if old and check["suggestionId"] == old["id"]), None)
                    if check:
                        item["verification"] = check
                    state["suggestions"].append(item)
                    result_ids.append(content["id"])
                    suggestion_ids.append(content["id"])
                for feedback in active["input"].get("feedback", []):
                    if feedback["decision"] != "resolve":
                        continue
                    old = get(state, "suggestions", feedback["id"])
                    require(old["contextId"] == context["id"], "다른 작업 공간의 제안입니다.")
                    check = next((check for check in checks if check["suggestionId"] == old["id"]), dict(suggestionId=old["id"], status="uncertain", reason="수정 반영 결과를 확인하지 못했습니다.", evidence=None))
                    if check["status"] != "resolved" and not any(item.get("previousSuggestionId") == old["id"] for item in response["results"]):
                        old.update(decision="open", verification=check)
                        suggestion_ids.append(old["id"])
            final = record["moduleResults"]["finalReview"]
            review = dict(id=record["runId"], contextId=context["id"], resumeVersionId=active["input"]["resumeVersionId"], createdAt=record["createdAt"], input=active["input"], status=response["status"], errors=response["errors"], materialReviews=response["materialReviews"], experienceRecommendations=response.get("experienceRecommendations", []), resolutionChecks=checks, resultIds=result_ids, suggestionIds=suggestion_ids if successful else (previous or {}).get("suggestionIds", []), modules={key: value for key, value in record["moduleResults"].items() if key != "finalReview"}, finalErrors=final["errors"], finalFailed=final["output"] is None)
            state["reviews"].append(review)
            for version_id in active["input"].get("materialVersions", {}).values():
                get(state, "materialVersions", version_id)
                state["reviewMaterials"].append(dict(id=f'{review["id"]}:{version_id}', reviewId=review["id"], materialVersionId=version_id))
            context["lastAttemptId"] = review["id"]
            if successful:
                context["latestReviewId"] = review["id"]
            del state["activeRun"]
        return self._write(user_id, commit)
