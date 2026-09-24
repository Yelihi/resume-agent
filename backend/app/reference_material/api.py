import re
import asyncio

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from app.errors import ApiError
from app.deployment.auth import User, get_current_user, require_active_user
from app.deployment.config import get_settings
from app.deployment.keys import get_user_api_key
from app.deployment.jobs import ai_capacity, watch_user
from app.review.openai_gateway import OpenAIReviewGateway
from app.document_processing.models import ModuleErrorDTO
from app.review.api import get_run_manager
from app.review.run_manager import ReviewRunManager
from .models import MaterialType, ReferenceMaterial

router = APIRouter(prefix="/api/materials")


class MaterialPreviewRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    materialType: MaterialType
    content: str = Field(min_length=1, max_length=100_000)


class MaterialPreviewResponse(BaseModel):
    content: str
    sources: list[str]


@router.post("/preview", response_model=MaterialPreviewResponse)
async def preview(request: MaterialPreviewRequest, manager: ReviewRunManager = Depends(get_run_manager),
                  user: User = Depends(get_current_user)):
    urls = list(dict.fromkeys(url.rstrip(".,;!?)>]}") for url in re.findall(r"https?://[^\s<>'\"]+", request.content)))
    if not urls:
        return MaterialPreviewResponse(content=request.content, sources=[])
    try:
        materials = [ReferenceMaterial(sourceId=f"preview-{index}", materialType=request.materialType, inputType="url", url=url) for index, url in enumerate(urls)]
    except ValidationError:
        raise ApiError(422, [ModuleErrorDTO(moduleKey="referenceMaterial", inputSourceId=None,
            errorCode="INVALID_URL", userMessage="자료 URL을 확인해 주세요.", canRetry=False)]) from None
    key = "companyContextAnalysis" if request.materialType is MaterialType.COMPANY else "jobPostingAnalysis"
    server = get_settings().mode == "server"
    gateway = manager.gateway
    if server:
        ai_capacity.acquire()
    try:
        if server:
            gateway = OpenAIReviewGateway.from_api_key(get_user_api_key(user))
            gateway.authorize = lambda: require_active_user(user)
        async with watch_user(user if server else None), asyncio.timeout(120):
            result = await gateway.analyze_materials(key, materials)
            if server:
                require_active_user(user)
    finally:
        if server:
            try:
                if gateway:
                    await gateway.client.close()
            finally:
                ai_capacity.release()
    if result.output is None or result.errors:
        raise ApiError(422, result.errors or [ModuleErrorDTO(moduleKey=key, inputSourceId=None,
            errorCode="EMPTY_PREVIEW", userMessage="자료 내용을 가져오지 못했습니다. 입력을 확인해 주세요.", canRetry=True)])
    text = "\n\n".join([result.output.summary, *[item.statement for item in result.output.evidence]])
    return MaterialPreviewResponse(content=text, sources=urls)
