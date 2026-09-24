import asyncio
from dataclasses import dataclass
from collections.abc import Awaitable, Callable
from typing import Any, Protocol

from app.document_processing.models import FlowDocument, PageDocument
from app.reference_material.models import MaterialType, ReferenceMaterial

from .contracts import AiReviewOutput, ModuleResult, PreviousReview, ReviewResponse, ReviewStatus, ReviewContext
from .spell_check import check_spelling
from .validation import assemble_review_response


class ReviewGateway(Protocol):
    async def analyze_materials(
        self,
        module_key: str,
        materials: list[ReferenceMaterial],
    ) -> ModuleResult[Any]: ...

    async def final_review(
        self,
        document: PageDocument | FlowDocument,
        module_results: list[ModuleResult[Any]],
        previous_review: PreviousReview | None = None,
        materials: list[ReferenceMaterial] | None = None,
        review_context: ReviewContext | None = None,
    ) -> ModuleResult[AiReviewOutput]: ...


@dataclass(frozen=True)
class ReviewOutcome:
    response: ReviewResponse
    moduleResults: list[ModuleResult[Any]]


async def _ignore_progress(_: str, __: str) -> None:
    return None


async def _ignore_module(_: ModuleResult[Any]) -> None:
    return None


def build_outcome(
    document: PageDocument | FlowDocument,
    preliminary: list[ModuleResult[Any]],
    final: ModuleResult[AiReviewOutput],
    materials: list[ReferenceMaterial] | None = None,
    review_context: ReviewContext | None = None,
) -> ReviewOutcome:
    module_results = [*preliminary, final]
    errors = [error for result in module_results for error in result.errors]
    if final.output is None:
        return ReviewOutcome(
            response=ReviewResponse(status=ReviewStatus.FAILED, errors=errors, materialReviews=[], results=[]),
            moduleResults=module_results,
        )
    return ReviewOutcome(
        response=assemble_review_response(document, final.output, errors, materials, review_context),
        moduleResults=module_results,
    )


class ReviewOrchestrator:
    def __init__(self, gateway: ReviewGateway) -> None:
        self.gateway = gateway

    async def run(
        self,
        document: PageDocument | FlowDocument,
        materials: list[ReferenceMaterial],
        *,
        previous_review: PreviousReview | None = None,
        review_context: ReviewContext | None = None,
        on_progress: Callable[[str, str], Awaitable[None]] = _ignore_progress,
        on_module: Callable[[ModuleResult[Any]], Awaitable[None]] = _ignore_module,
    ) -> ReviewOutcome:
        await on_progress("spellCheck", "이력서 기본 내용을 검토하고 있습니다.")
        spell_result = await asyncio.to_thread(check_spelling, document)
        preliminary: list[ModuleResult[Any]] = [spell_result]
        await on_module(spell_result)
        company = [item for item in materials if item.materialType is MaterialType.COMPANY]
        job_postings = [item for item in materials if item.materialType is MaterialType.JOB_POSTING]
        analysis_tasks = []
        if company:
            analysis_tasks.append(self.gateway.analyze_materials("companyContextAnalysis", company))
        if job_postings:
            analysis_tasks.append(self.gateway.analyze_materials("jobPostingAnalysis", job_postings))
        if analysis_tasks:
            await on_progress("referenceAnalysis", "지원 자료를 적용하고 있습니다.")
            tasks = [asyncio.create_task(task) for task in analysis_tasks]
            try:
                for task in asyncio.as_completed(tasks):
                    result = await task
                    preliminary.append(result)
                    await on_module(result)
            finally:
                for task in tasks:
                    task.cancel()
                await asyncio.gather(*tasks, return_exceptions=True)

        await on_progress("finalReview", "수정 제안을 종합하고 있습니다.")
        final = await self.gateway.final_review(document, preliminary, previous_review, materials, **({"review_context": review_context} if review_context else {}))
        await on_module(final)
        return build_outcome(document, preliminary, final, materials, review_context)
