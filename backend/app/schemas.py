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


class KnowledgeBaseCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    description: str = Field(default="", max_length=200)
    department: str = Field(min_length=1, max_length=100)
    embedding_model_id: str
    rerank_model_id: str | None = None
    published: bool = False
    chunk_size: int = Field(default=800, ge=100, le=4000)
    chunk_overlap: int = Field(default=120, ge=0, le=3999)
    chunk_strategy: Literal["structure", "recursive"] = "structure"


class KnowledgeBasePatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    description: str | None = Field(default=None, max_length=200)
    department: str | None = Field(default=None, min_length=1, max_length=100)
    embedding_model_id: str | None = None
    rerank_model_id: str | None = None
    published: bool | None = None
    chunk_size: int | None = Field(default=None, ge=100, le=4000)
    chunk_overlap: int | None = Field(default=None, ge=0, le=3999)
    chunk_strategy: Literal["structure", "recursive"] | None = None


class KnowledgeBaseOut(BaseModel):
    id: str
    name: str
    description: str
    department: str
    published: bool
    managed: bool
    embedding_model_id: str
    rerank_model_id: str | None
    chunk_size: int
    chunk_overlap: int
    chunk_strategy: str
    active_index_version_id: str | None
    document_count: int
    chunk_count: int
    created_at: datetime
    updated_at: datetime


class IndexVersionOut(BaseModel):
    id: str
    kb_id: str
    embedding_model_id: str
    dimensions: int
    chunk_size: int
    chunk_overlap: int
    chunk_strategy: str
    status: str
    progress: int
    total_chunks: int
    embedded_chunks: int
    input_tokens: int | None
    usage_source: str
    duration_ms: int | None
    error_code: str | None
    created_at: datetime
    started_at: datetime | None
    completed_at: datetime | None
    activated_at: datetime | None


class RetrievalRequest(BaseModel):
    query: str = Field(min_length=1, max_length=4000)
    top_k: int = Field(default=5, ge=1, le=20)
    candidate_k: int = Field(default=20, ge=1, le=100)
    similarity_threshold: float = Field(default=0.35, ge=0, le=1)
    rerank: bool = True


class RetrievalResultOut(BaseModel):
    chunk_id: str
    document_id: str
    document_name: str
    sequence: int
    title: str
    text: str
    page_number: int
    vector_score: float
    rerank_score: float | None


class RetrievalOut(BaseModel):
    index_version_id: str
    results: list[RetrievalResultOut]
    candidate_count: int
    duration_ms: int
    embedding_duration_ms: int
    rerank_duration_ms: int | None


class DocumentOut(BaseModel):
    id: str
    kb_id: str
    original_name: str
    mime: str
    extension: str
    size_bytes: int
    sha256: str
    status: str
    parser_version: str
    error_code: str | None
    chunk_count: int
    created_at: datetime
    updated_at: datetime


class ChunkOut(BaseModel):
    id: str
    kb_id: str
    document_id: str
    sequence: int
    title: str
    text: str
    page_number: int
    status: str
    created_at: datetime
    updated_at: datetime


class AssistantInput(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    description: str = Field(default="", max_length=500)
    llm_model_id: str
    kb_ids: list[str] = Field(min_length=1, max_length=20)
    system_prompt: str = Field(min_length=1, max_length=10000)
    top_k: int = Field(default=5, ge=1, le=20)
    candidate_k: int = Field(default=20, ge=1, le=100)
    similarity_threshold: float = Field(default=0.35, ge=0, le=1)
    rerank_enabled: bool = True
    published: bool = False


class AssistantPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    description: str | None = Field(default=None, max_length=500)
    llm_model_id: str | None = None
    kb_ids: list[str] | None = Field(default=None, min_length=1, max_length=20)
    system_prompt: str | None = Field(default=None, min_length=1, max_length=10000)
    top_k: int | None = Field(default=None, ge=1, le=20)
    candidate_k: int | None = Field(default=None, ge=1, le=100)
    similarity_threshold: float | None = Field(default=None, ge=0, le=1)
    rerank_enabled: bool | None = None
    published: bool | None = None


class AssistantOut(BaseModel):
    id: str
    name: str
    description: str
    llm_model_id: str
    kb_ids: list[str]
    system_prompt: str
    top_k: int
    candidate_k: int
    similarity_threshold: float
    rerank_enabled: bool
    published: bool
    managed: bool
    created_at: datetime
    updated_at: datetime


class ConversationOut(BaseModel):
    id: str
    assistant_id: str
    title: str
    created_at: datetime
    updated_at: datetime


class CitationOut(BaseModel):
    id: str
    chunk_id: str
    ordinal: int
    document_name: str
    title: str
    snapshot_text: str
    page_number: int
    vector_score: float
    rerank_score: float | None


class MessageOut(BaseModel):
    id: str
    role: str
    content: str
    status: str
    citations: list[CitationOut]
    created_at: datetime


class ConversationDetailOut(ConversationOut):
    messages: list[MessageOut]


class ChatRequest(BaseModel):
    query: str = Field(min_length=1, max_length=4000)
    role_context: Literal["admin", "manager", "user"] = "user"


class QueryRunOut(BaseModel):
    id: str
    conversation_id: str
    assistant_id: str
    assistant_name: str
    kb_ids: list[str]
    query: str
    answer: str
    role_context: str
    status: str
    llm_model: str
    input_tokens: int | None
    output_tokens: int | None
    total_tokens: int | None
    usage_source: str
    first_token_ms: int | None
    total_ms: int | None
    citation_count: int
    error_code: str | None
    created_at: datetime


class DocumentPreviewRequest(BaseModel):
    chunk_size: int = Field(ge=100, le=4000)
    chunk_overlap: int = Field(ge=0, le=3999)
    chunk_strategy: Literal["structure", "recursive"] = "structure"


class DocumentPreviewOut(BaseModel):
    document: DocumentOut
    chunks: list[ChunkOut]


class ChunkPatch(BaseModel):
    text: str = Field(min_length=1, max_length=20000)
