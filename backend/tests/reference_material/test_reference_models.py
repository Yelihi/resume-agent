import pytest
from pydantic import ValidationError

from app.reference_material.models import (
    MaterialType,
    ReferenceMaterial,
    ReferenceMaterials,
)


def test_text_document_and_url_are_explicitly_distinguished() -> None:
    text = ReferenceMaterial(
        sourceId="company-1",
        materialType=MaterialType.COMPANY,
        inputType="text",
        content="기술로 고객 문제를 해결합니다.",
    )
    document = ReferenceMaterial(
        sourceId="job-1",
        materialType=MaterialType.JOB_POSTING,
        inputType="document",
        content="React 경력자를 찾습니다.",
    )
    url = ReferenceMaterial(
        sourceId="company-2",
        materialType=MaterialType.COMPANY,
        inputType="url",
        url="https://example.com/about",
    )

    assert (text.content, document.content, str(url.url)) == (
        "기술로 고객 문제를 해결합니다.",
        "React 경력자를 찾습니다.",
        "https://example.com/about",
    )


@pytest.mark.parametrize(
    "payload",
    [
        {"sourceId": "x", "materialType": "company", "inputType": "text", "content": "   "},
        {"sourceId": "x", "materialType": "company", "inputType": "url", "url": "file:///tmp/a"},
        {
            "sourceId": "x",
            "materialType": "jobPosting",
            "inputType": "url",
            "url": "https://example.com",
            "content": "둘 다 금지",
        },
    ],
)
def test_invalid_material_is_rejected(payload: dict[str, str]) -> None:
    with pytest.raises(ValidationError):
        ReferenceMaterial.model_validate(payload)


def test_duplicate_source_ids_are_rejected() -> None:
    item = {
        "sourceId": "same",
        "materialType": "company",
        "inputType": "text",
        "content": "자료",
    }

    with pytest.raises(ValidationError):
        ReferenceMaterials(items=[item, item])
