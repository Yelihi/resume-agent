import logging
import os
from typing import Any

from openai import AsyncOpenAI

from app.document_processing.models import FlowDocument, ModuleErrorDTO, PageDocument
from app.errors import MissingOpenAiApiKeyError
from app.reference_material.models import ReferenceMaterial

from .contracts import AiReviewOutput, ModuleResult, PreviousReview, ContextAnalysis, ContextEvidence, ReviewContext
from .prompts import final_review_input, material_analysis_input

logger = logging.getLogger("resume_agent.review")


def _error(module_key: str, code: str, message: str, source_id: str | None = None) -> ModuleErrorDTO:
    return ModuleErrorDTO(
        moduleKey=module_key,
        inputSourceId=source_id,
        errorCode=code,
        userMessage=message,
        canRetry=True,
    )


def _all_source_urls(value: Any) -> set[str]:
    if hasattr(value, "model_dump"):
        value = value.model_dump()
    if isinstance(value, dict):
        urls = {str(value["url"]).rstrip("/")} if "url" in value else set()
        for child in value.values():
            urls.update(_all_source_urls(child))
        return urls
    if isinstance(value, (list, tuple)):
        urls: set[str] = set()
        for child in value:
            urls.update(_all_source_urls(child))
        return urls
    return set()


class OpenAIReviewGateway:
    def __init__(self, client: Any, model: str) -> None:
        self.client = client
        self.model = model
        self.authorize = None

    @classmethod
    def from_environment(cls) -> "OpenAIReviewGateway":
        api_key = os.environ.get("OPENAI_API_KEY")
        if not api_key:
            raise MissingOpenAiApiKeyError()
        return cls.from_api_key(api_key)

    @classmethod
    def from_api_key(cls, api_key: str) -> "OpenAIReviewGateway":
        return cls(
            client=AsyncOpenAI(api_key=api_key),
            model=os.environ.get("OPENAI_MODEL", "gpt-5.4-mini"),
        )

    async def analyze_materials(
        self,
        module_key: str,
        materials: list[ReferenceMaterial],
    ) -> ModuleResult[ContextAnalysis]:
        urls = [(material.sourceId, str(material.url).rstrip("/")) for material in materials if material.url]
        request: dict[str, Any] = {
            "model": self.model,
            "input": material_analysis_input(module_key, materials),
            "text_format": ContextAnalysis,
            "store": False,
        }
        if urls:
            request.update(
                tools=[{"type": "web_search"}],
                tool_choice="required",
                include=["web_search_call.action.sources"],
            )
        try:
            if self.authorize:
                self.authorize()
            response = await self.client.responses.parse(**request)
            parsed = response.output_parsed
            if not isinstance(parsed, ContextAnalysis):
                raise ValueError("missing parsed context analysis")
            if urls:
                source_urls = _all_source_urls(response.output)
                missing = [(source_id, url) for source_id, url in urls if url not in source_urls]
                if missing:
                    errors = [
                        _error(
                            module_key,
                            "SOURCE_NOT_VERIFIED",
                            "입력한 URL의 내용을 확인하지 못했습니다.",
                            source_id,
                        )
                        for source_id, _ in missing
                    ]
                    return ModuleResult(moduleKey=module_key, output=None, errors=errors)
            return ModuleResult(moduleKey=module_key, output=parsed, errors=[])
        except Exception:
            logger.warning("Material analysis failed for %s", module_key)
            return ModuleResult(
                moduleKey=module_key,
                output=None,
                errors=[_error(module_key, "AI_REQUEST_FAILED", "자료 분석을 완료하지 못했습니다.")],
            )

    async def final_review(
        self,
        document: PageDocument | FlowDocument,
        module_results: list[ModuleResult[Any]],
        previous_review: PreviousReview | None = None,
        materials: list[ReferenceMaterial] | None = None,
        review_context: ReviewContext | None = None,
    ) -> ModuleResult[AiReviewOutput]:
        serialized = [result.model_dump(mode="json") for result in module_results]
        try:
            if self.authorize:
                self.authorize()
            response = await self.client.responses.parse(
                model=self.model,
                input=final_review_input(document, serialized, previous_review, materials, review_context),
                text_format=AiReviewOutput,
                # Feedback never grants database, browser, file or execution capabilities.
                tools=[],
                tool_choice="none",
                store=False,
            )
            parsed = response.output_parsed
            if not isinstance(parsed, AiReviewOutput):
                raise ValueError("missing parsed review output")
            return ModuleResult(moduleKey="finalReview", output=parsed, errors=[])
        except Exception:
            logger.warning("Final review failed")
            return ModuleResult(
                moduleKey="finalReview",
                output=None,
                errors=[_error("finalReview", "AI_REQUEST_FAILED", "최종 검토를 완료하지 못했습니다.")],
            )
