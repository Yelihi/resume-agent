from enum import StrEnum
from typing import Literal, Self

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, model_validator


class MaterialType(StrEnum):
    COMPANY = "company"
    JOB_POSTING = "jobPosting"


class ReferenceMaterial(BaseModel):
    model_config = ConfigDict(extra="forbid")

    sourceId: str = Field(min_length=1)
    materialType: MaterialType
    inputType: Literal["text", "document", "url"]
    content: str | None = None
    url: HttpUrl | None = None

    @model_validator(mode="after")
    def input_matches_type(self) -> Self:
        if self.inputType == "url":
            if self.url is None or self.content is not None:
                raise ValueError("URL material requires only url")
        elif self.url is not None or self.content is None or not self.content.strip():
            raise ValueError("text and document material require only non-empty content")
        return self


class ReferenceMaterials(BaseModel):
    model_config = ConfigDict(extra="forbid")

    items: list[ReferenceMaterial]

    @model_validator(mode="after")
    def source_ids_are_unique(self) -> Self:
        ids = [item.sourceId for item in self.items]
        if len(ids) != len(set(ids)):
            raise ValueError("source IDs must be unique")
        return self
