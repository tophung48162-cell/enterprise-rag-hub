from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, HttpUrl, field_validator

ProviderKind = Literal["tongyi", "openrouter", "aihubmix"]
ModelCapability = Literal["LLM", "Embedding", "Rerank"]


class ProviderCreate(BaseModel):
    kind: ProviderKind
    name: str = Field(min_length=1, max_length=100)
    base_url: HttpUrl
    api_key: str = Field(min_length=8, max_length=500)

    @field_validator("name")
    @classmethod
    def strip_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("名称不能为空")
        return value


class ProviderPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    base_url: HttpUrl | None = None
    api_key: str | None = Field(default=None, min_length=8, max_length=500)
    enabled: bool | None = None


class ProviderOut(BaseModel):
    id: str
    kind: str
    name: str
    base_url: str
    configured: bool
    enabled: bool


class ModelCreate(BaseModel):
    provider_id: str
    remote_model_id: str = Field(min_length=1, max_length=255)
    capability: ModelCapability
    dimensions: int | None = Field(default=None, ge=1, le=16384)
    enabled: bool = True


class ModelPatch(BaseModel):
    enabled: bool | None = None


class ModelOut(BaseModel):
    id: str
    provider_id: str
    remote_model_id: str
    capability: str
    dimensions: int | None
    enabled: bool


class TestResult(BaseModel):
    success: bool
    duration_ms: int
    input_tokens: int | None = None
    output_tokens: int | None = None
    usage_source: str = "provider"


class OcrOut(BaseModel):
    id: str
    retry_of_id: str | None
    file_name: str
    sha256: str
    status: str
    text: str
    input_tokens: int | None
    output_tokens: int | None
    usage_source: str
    duration_ms: int | None
    error_code: str | None
    created_at: datetime
    completed_at: datetime | None
