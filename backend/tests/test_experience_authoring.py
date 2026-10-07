import asyncio
import json
from types import SimpleNamespace

import httpx

from app.experience.api import (
    DRAFT_RULES, FREE_DRAFT_RULES, METADATA_RULES, METADATA_REVIEW_RULES, WRITING_RULES, LinkContent, LinkLookup,
    MetadataResult, MetadataReview, WrittenContent, get_gateway,
)
from app.main import app


def test_metadata_reviews_original_meaning_before_returning_and_never_exposes_failed_draft():
    class Responses:
        calls = []
        failure = None

        async def parse(self, **kwargs):
            assert kwargs["store"] is False
            assert kwargs["tools"] == [] and kwargs["tool_choice"] == "none"
            self.calls.append(kwargs["input"][0]["content"])
            if self.calls[-1] == METADATA_RULES:
                assert "reasoning" not in kwargs
                return SimpleNamespace(output_parsed=MetadataResult(metadata="UNREVIEWED_DRAFT"))
            assert self.calls[-1] == METADATA_REVIEW_RULES
            assert kwargs["reasoning"] == {"effort": "medium"}
            body = json.loads(kwargs["input"][1]["content"])
            assert body["source"]["markdown"] == "취소한 요청의 결과를 무시했다."
            assert body["draft"]["metadata"] == "UNREVIEWED_DRAFT"
            if self.failure == "exception":
                raise RuntimeError("PRIVATE_REVIEW_FAILURE")
            return SimpleNamespace(output_parsed=None if self.failure == "missing" else MetadataReview(
                corrections=["행동의 대상을 원문에 맞게 복원"], metadata="취소한 요청의 결과를 무시했다.",
                talkingPoint=None, interviewQuestions=[]))

    async def scenario():
        responses = Responses()
        app.dependency_overrides[get_gateway] = lambda: SimpleNamespace(client=SimpleNamespace(responses=responses), model="gpt-5.4-mini")
        try:
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url="http://test") as client:
                data = {"title": "요청 처리", "period": "", "markdown": "취소한 요청의 결과를 무시했다."}
                result = await client.post("/api/experiences/metadata", json=data)
                assert result.json()["metadata"] == data["markdown"]
                assert responses.calls == [METADATA_RULES, METADATA_REVIEW_RULES]
                for failure in ("exception", "missing"):
                    responses.failure = failure
                    for accept in ("application/json", "text/event-stream"):
                        result = await client.post("/api/experiences/metadata", json=data, headers={"accept": accept})
                        assert "UNREVIEWED_DRAFT" not in result.text
                        assert "PRIVATE_REVIEW_FAILURE" not in result.text
                        if accept == "application/json":
                            assert result.status_code == 502
                        else:
                            events = [json.loads(line[6:]) for line in result.text.splitlines() if line.startswith("data: ")]
                            assert events[-1]["type"] == "failed"
                            assert all(event["type"] != "completed" for event in events)
                            assert any("검수" in event.get("message", "") for event in events)
        finally:
            app.dependency_overrides.clear()
    asyncio.run(scenario())


def test_preparation_keeps_questions_but_clears_answers_with_invalid_evidence():
    class Responses:
        point_evidence = ["회귀 테스트를 추가했다."]
        result = MetadataResult(metadata="[해석] 회귀 검증", talkingPoints="- 회귀 테스트로 변경을 검증한 점을 어필하세요.",
                                interviewQuestions=[{"question": "변경을 어떻게 검증했나요?", "answer": "회귀 테스트를 추가했다.", "evidence": "회귀 테스트를 추가했다."},
                                                    {"question": "다른 대안은 무엇이었나요?", "answer": "", "evidence": ""},
                                                    {"question": "무엇을 추가했나요?", "answer": "회귀 테스트", "evidence": "회귀 테스트를 추가했다."}])

        async def parse(self, **kwargs):
            assert kwargs["tools"] == []
            assert "reasoning" not in kwargs  # Other configured models retain their supported defaults.
            assert "확인되지 않은 역할" not in kwargs["input"][1]["content"]
            return SimpleNamespace(output_parsed=MetadataReview(corrections=[], metadata=self.result.metadata,
                talkingPoint={"emphasis": "회귀 테스트로 변경을 검증한 점을 어필하세요.", "evidence": self.point_evidence, "caveat": "테스트 범위 확인"}
                    if self.result.talkingPoints else None, interviewQuestions=self.result.interviewQuestions)
                                   if kwargs["text_format"] is MetadataReview else self.result)

    async def scenario():
        responses = Responses()
        app.dependency_overrides[get_gateway] = lambda: SimpleNamespace(client=SimpleNamespace(responses=responses), model="test")
        try:
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url="http://test") as client:
                data = {"title": "Chromium 기여", "period": "", "markdown": "# 작업\n회귀 테스트를 추가했다."}
                result = await client.post("/api/experiences/metadata", json=data)
                assert result.status_code == 200
                assert result.json()["interviewQuestions"][1]["answer"] == ""
                assert result.json()["talkingPoints"] == "- 회귀 테스트로 변경을 검증한 점을 어필하세요.\n\n근거:\n> 회귀 테스트를 추가했다.\n\n확인할 점: 테스트 범위 확인"
                responses.point_evidence = ["본문에 없는 개인 성과"]
                checked = await client.post("/api/experiences/metadata", json=data)
                assert checked.json()["talkingPoints"] == ""
                assert checked.json()["interviewQuestions"][0]["answer"] == "회귀 테스트를 추가했다."
                responses.point_evidence = ["회귀 테스트를 추가했다.", "작업"]
                checked = await client.post("/api/experiences/metadata", json=data)
                assert "근거 1:\n> 회귀 테스트를 추가했다." in checked.json()["talkingPoints"]
                assert "근거 2:\n> 작업" in checked.json()["talkingPoints"]
                responses.point_evidence = ["회귀 테스트를 추가했다."]
                for evidence in ("본문에 없는 측정 결과", "", " "):
                    responses.result.interviewQuestions[0].answer = "회귀 테스트를 추가했다."
                    responses.result.interviewQuestions[0].evidence = evidence
                    checked = await client.post("/api/experiences/metadata", json=data)
                    assert checked.status_code == 200
                    questions = checked.json()["interviewQuestions"]
                    assert questions[0] == {"question": "변경을 어떻게 검증했나요?", "answer": "", "evidence": ""}
                    assert questions[2]["answer"] == "회귀 테스트"
                    assert checked.json()["metadata"] == responses.result.metadata
                responses.result.talkingPoints = ""
                sparse = await client.post("/api/experiences/metadata", json=data)
                assert sparse.status_code == 200
                assert len(sparse.json()["interviewQuestions"]) == 2
                assert sparse.json()["interviewQuestions"][0]["question"] == "변경을 어떻게 검증했나요?"
                assert all(not question["answer"] and not question["evidence"] for question in sparse.json()["interviewQuestions"])
        finally:
            app.dependency_overrides.clear()
    asyncio.run(scenario())


def test_draft_verifies_sources_and_metadata_uses_edited_markdown():
    source = {"id": "link", "kind": "link", "name": "PR", "text": "",
              "url": "https://example.com/pr", "createdAt": "2026-09-21"}

    class Responses:
        async def parse(self, **kwargs):
            assert kwargs["store"] is False
            if kwargs["text_format"] is LinkLookup:
                assert kwargs["tool_choice"] == "required"
                return SimpleNamespace(output=[{"url": source["url"]}], output_parsed=LinkLookup(
                    sources=[LinkContent(sourceId="link", text="검색 조건 URL 저장")]))
            assert kwargs["tools"] == [] and kwargs["tool_choice"] == "none"
            body = json.loads(kwargs["input"][1]["content"])
            if kwargs["text_format"] in (MetadataResult, MetadataReview):
                rules = kwargs["input"][0]["content"]
                if rules == METADATA_REVIEW_RULES:
                    assert body["draft"]["metadata"] == "## 역량과 증거\n[해석] URL 상태 관리"
                    body = body["source"]
                else:
                    assert rules == METADATA_RULES
                assert body["markdown"] == "# 직접 수정한 경험\n검색 조건을 URL에 저장했다."
                assert set(body) == {"title", "period", "markdown"}
                result = MetadataResult(metadata="## 역량과 증거\n[해석] URL 상태 관리")
                return SimpleNamespace(output_parsed=MetadataReview(corrections=[], metadata=result.metadata,
                                       talkingPoint=None, interviewQuestions=[])
                                       if kwargs["text_format"] is MetadataReview else result)
            assert kwargs["input"][0]["content"] == DRAFT_RULES
            assert "직접 작성한 역할" in body["input"]["markdown"]
            assert "resume" not in body["input"]
            assert body["sourceNotes"] == [{"sourceId": "link", "text": "검색 조건 URL 저장", "verified": True, "failureReason": None}]
            return SimpleNamespace(output_parsed=WrittenContent(markdown="# 초안", summary="검색 개선", questions=["성과는?"]))

    async def scenario():
        app.dependency_overrides[get_gateway] = lambda: SimpleNamespace(client=SimpleNamespace(responses=Responses()), model="test")
        try:
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url="http://test") as client:
                draft = await client.post("/api/experiences/draft", json={"title": "검색 개선", "period": "", "markdown": "직접 작성한 역할", "sources": [source]})
                assert draft.status_code == 200
                assert draft.json()["questions"] == ["성과는?"]
                assert draft.json()["sourceNotes"][0]["verified"] is True
                metadata = await client.post("/api/experiences/metadata", json={"title": "검색 개선", "period": "", "markdown": "# 직접 수정한 경험\n검색 조건을 URL에 저장했다."})
                assert metadata.status_code == 200
                assert "[해석]" in metadata.json()["metadata"]
        finally:
            app.dependency_overrides.clear()
    asyncio.run(scenario())


def test_authoring_rejects_invalid_input_and_redacts_failures():
    class Responses:
        calls = 0

        async def parse(self, **kwargs):
            self.calls += 1
            raise RuntimeError("PRIVATE_SOURCE_MATERIAL")

    async def scenario():
        responses = Responses()
        app.dependency_overrides[get_gateway] = lambda: SimpleNamespace(client=SimpleNamespace(responses=responses), model="test")
        try:
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url="http://test") as client:
                base = {"title": "경험", "period": "", "markdown": "작성 내용"}
                source = {"id": "note", "kind": "note", "name": "메모", "text": "내용", "createdAt": ""}
                invalid = [
                    ("draft", {**base, "markdown": " \n", "sources": []}),
                    ("draft", {**base, "sources": [source, source]}),
                    ("draft", {**base, "sources": [{**source, "kind": "link", "url": "file:///private/image.png"}]}),
                    ("draft", {**base, "resume": {"text": "not allowed"}}),
                    ("draft", {**base, "sources": [{**source, "id": str(i), "text": "x" * 100_000} for i in range(6)]}),
                    ("metadata", {**base, "markdown": " \n"}),
                    ("metadata", {**base, "markdown": "x" * 60_001}),
                    ("metadata", {**base, "sources": []}),
                ]
                for path, data in invalid:
                    assert (await client.post(f"/api/experiences/{path}", json=data)).status_code == 422
                assert responses.calls == 0
                for path in ("draft", "metadata"):
                    failed = await client.post(f"/api/experiences/{path}", json=base)
                    assert failed.status_code == 502
                    assert "PRIVATE_SOURCE_MATERIAL" not in failed.text
                    assert "유지" in failed.text
        finally:
            app.dependency_overrides.clear()
    asyncio.run(scenario())


def test_resume_writing_accepts_markdown_without_attachments():
    class Responses:
        async def parse(self, **kwargs):
            assert kwargs["input"][0]["content"] == WRITING_RULES
            experience = json.loads(kwargs["input"][1]["content"])["input"]["experience"]
            assert experience["markdown"] == "직접 작성한 경험"
            assert experience["metadata"] == "[해석] 사용자 경험 개선"
            assert experience["sources"] == []
            return SimpleNamespace(output_parsed=WrittenContent(markdown="# 작성본", summary="요약", questions=[]))

    async def scenario():
        app.dependency_overrides[get_gateway] = lambda: SimpleNamespace(client=SimpleNamespace(responses=Responses()), model="test")
        try:
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url="http://test") as client:
                data = {"experience": {"id": "exp", "title": "경험", "period": "", "revision": 1,
                        "markdown": "직접 작성한 경험", "metadata": "[해석] 사용자 경험 개선", "sources": []},
                        "resume": {"id": "resume", "text": "이력서"}, "materials": []}
                result = await client.post("/api/experiences/write", json=data)
                assert result.status_code == 200 and result.json()["sourceNotes"] == []
                data["experience"]["markdown"] = ""
                assert (await client.post("/api/experiences/write", json=data)).status_code == 422
        finally:
            app.dependency_overrides.clear()
    asyncio.run(scenario())


def test_authoring_sse_progress_completion_and_safe_failure():
    class Responses:
        fail = False

        async def parse(self, **kwargs):
            if self.fail:
                raise RuntimeError("PRIVATE_SOURCE_MATERIAL")
            if kwargs["text_format"] in (MetadataResult, MetadataReview):
                result = MetadataResult(metadata="문제와 해결 근거")
                return SimpleNamespace(output_parsed=MetadataReview(corrections=[], metadata=result.metadata,
                                       talkingPoint=None, interviewQuestions=[])
                                       if kwargs["text_format"] is MetadataReview else result)
            return SimpleNamespace(output_parsed=WrittenContent(markdown="# 초안", summary="요약", questions=[]))

    async def scenario():
        responses = Responses()
        app.dependency_overrides[get_gateway] = lambda: SimpleNamespace(client=SimpleNamespace(responses=responses), model="test")
        try:
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url="http://test") as client:
                for path in ("draft", "metadata"):
                    payload = {"title": "경험", "period": "", "markdown": "본문"}
                    result = await client.post(f"/api/experiences/{path}", json=payload, headers={"accept": "text/event-stream"})
                    assert result.status_code == 200
                    assert result.headers["content-type"].startswith("text/event-stream")
                    events = [json.loads(line[6:]) for line in result.text.splitlines() if line.startswith("data: ")]
                    assert events[0]["type"] == "progress"
                    assert all(event["message"] for event in events[:-1])
                    assert events[-1]["type"] == "completed"
                    assert events[-1]["result"]["markdown" if path == "draft" else "metadata"]
                    responses.fail = True
                    failed = await client.post(f"/api/experiences/{path}", json=payload, headers={"accept": "text/event-stream"})
                    assert '"type": "failed"' in failed.text
                    assert '"type": "completed"' not in failed.text
                    assert "PRIVATE_SOURCE_MATERIAL" not in failed.text
                    responses.fail = False
        finally:
            app.dependency_overrides.clear()
    asyncio.run(scenario())


def test_authoring_stream_emits_before_completion_and_cancels_disconnected_work():
    from app.experience.api import authoring_stream

    async def scenario():
        cancelled = asyncio.Event()

        async def operation(progress):
            await progress("진행 중")
            try:
                await asyncio.Event().wait()
            finally:
                cancelled.set()

        stream = authoring_stream(operation).body_iterator
        first = await asyncio.wait_for(anext(stream), timeout=1)
        assert json.loads(first.removeprefix("data: ")) == {"type": "progress", "message": "진행 중"}
        assert not cancelled.is_set()
        await stream.aclose()
        assert cancelled.is_set()

    asyncio.run(scenario())


def test_optional_template_preserves_source_guards_and_reports_lookup_failures():
    class Responses:
        rules = []

        async def parse(self, **kwargs):
            if kwargs["text_format"] is LinkLookup:
                return SimpleNamespace(output=[{"url": "https://unrelated.example"}], output_parsed=LinkLookup(sources=[
                    LinkContent(sourceId="unreadable", text=""),
                    LinkContent(sourceId="unverified", text="UNVERIFIED_CLAIM"),
                ]))
            self.rules.append(kwargs["input"][0]["content"])
            assert kwargs["tools"] == [] and kwargs["tool_choice"] == "none"
            body = json.loads(kwargs["input"][1]["content"])
            assert body["input"]["markdown"] == "- 첫 번째 기여\n- 두 번째 기여"
            assert [note["failureReason"] for note in body["sourceNotes"]] == ["content_unavailable", "source_unverified"]
            assert all(not note["verified"] for note in body["sourceNotes"])
            assert "UNVERIFIED_CLAIM" not in kwargs["input"][1]["content"]
            return SimpleNamespace(output_parsed=WrittenContent(markdown="# 활동 목록", summary="활동", questions=[]))

    async def scenario():
        responses = Responses()
        app.dependency_overrides[get_gateway] = lambda: SimpleNamespace(client=SimpleNamespace(responses=responses), model="test")
        try:
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url="http://test") as client:
                data = {"title": "기여 목록", "period": "", "markdown": "- 첫 번째 기여\n- 두 번째 기여", "sources": [
                    {"id": identifier, "kind": "link", "name": "작업", "text": "", "url": f"https://example.com/{identifier}", "createdAt": "2026-09-29"}
                    for identifier in ("unreadable", "unverified")
                ]}
                # Omitted flag keeps existing clients' recommended template.
                default = await client.post("/api/experiences/draft", json=data)
                assert default.status_code == 200
                for enabled in (False, True):
                    result = await client.post("/api/experiences/draft", json={**data, "useTemplate": enabled}, headers={"accept": "text/event-stream"})
                    events = [json.loads(line[6:]) for line in result.text.splitlines() if line.startswith("data: ")]
                    assert events[-1]["type"] == "completed"
                    assert events[-1]["result"]["sourceNotes"][0]["failureReason"] == "content_unavailable"
                assert responses.rules == [DRAFT_RULES, FREE_DRAFT_RULES, DRAFT_RULES]
                assert "고정 섹션을 강제하지 않는다" in FREE_DRAFT_RULES
                assert "verified=true인 sourceNotes만" in FREE_DRAFT_RULES
        finally:
            app.dependency_overrides.clear()
    asyncio.run(scenario())
