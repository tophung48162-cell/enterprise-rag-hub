import time
from dataclasses import dataclass
from math import sqrt

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db_models import Chunk, ChunkEmbedding, Document, IndexVersion, KnowledgeBase, ModelConfig, Provider
from app.errors import ApiError
from app.providers.gateway import ModelGateway
from app.schemas import RetrievalOut, RetrievalRequest, RetrievalResultOut
from app.security import decrypt_secret
from app.services.configs import get_model, get_provider
from app.services.observability import TraceRecorder, safe_error


@dataclass
class VectorCandidate:
    embedding: ChunkEmbedding
    chunk: Chunk
    document: Document
    score: float


def _active_version(db: Session, knowledge_base: KnowledgeBase) -> IndexVersion:
    version = (
        db.get(IndexVersion, knowledge_base.active_index_version_id)
        if knowledge_base.active_index_version_id
        else None
    )
    if not version or version.kb_id != knowledge_base.id or version.status != "active":
        raise ApiError(409, "ACTIVE_INDEX_REQUIRED", "请先完成一个索引版本，再测试真实检索")
    return version


def _enabled_model(db: Session, model_id: str, capability: str) -> tuple[ModelConfig, Provider]:
    model = get_model(db, model_id)
    if model.capability != capability:
        raise ApiError(409, "RETRIEVAL_MODEL_INVALID", f"活动索引或知识库的{capability}模型配置不正确")
    provider = get_provider(db, model.provider_id)
    if not model.enabled or not provider.enabled:
        raise ApiError(409, "RETRIEVAL_MODEL_DISABLED", f"{capability}模型或服务商已停用")
    return model, provider


def _cosine_similarity(left: list[float], right: list[float]) -> float:
    if len(left) != len(right):
        raise ApiError(500, "INDEX_VECTOR_DIMENSION_MISMATCH", "活动索引中的向量维度不一致")
    left_norm = sqrt(sum(value * value for value in left))
    right_norm = sqrt(sum(value * value for value in right))
    if not left_norm or not right_norm:
        return 0.0
    return sum(a * b for a, b in zip(left, right, strict=True)) / (left_norm * right_norm)


def _vector_candidates(
    db: Session,
    version: IndexVersion,
    query_vector: list[float],
    candidate_k: int,
) -> list[VectorCandidate]:
    if db.get_bind().dialect.name == "postgresql":
        distance = ChunkEmbedding.embedding.cosine_distance(query_vector).label("distance")
        rows = db.execute(
            select(ChunkEmbedding, Chunk, Document, distance)
            .join(Chunk, Chunk.id == ChunkEmbedding.chunk_id)
            .join(Document, Document.id == Chunk.document_id)
            .where(ChunkEmbedding.index_version_id == version.id)
            .order_by(distance, ChunkEmbedding.chunk_id)
            .limit(candidate_k)
        ).all()
        return [
            VectorCandidate(embedding, chunk, document, 1.0 - float(vector_distance))
            for embedding, chunk, document, vector_distance in rows
        ]
    rows = db.execute(
        select(ChunkEmbedding, Chunk, Document)
        .join(Chunk, Chunk.id == ChunkEmbedding.chunk_id)
        .join(Document, Document.id == Chunk.document_id)
        .where(ChunkEmbedding.index_version_id == version.id)
    ).all()
    candidates = [
        VectorCandidate(embedding, chunk, document, _cosine_similarity(query_vector, embedding.embedding))
        for embedding, chunk, document in rows
    ]
    candidates.sort(key=lambda item: (-item.score, item.embedding.chunk_id))
    return candidates[:candidate_k]


def _result_out(candidate: VectorCandidate, rerank_score: float | None = None) -> RetrievalResultOut:
    return RetrievalResultOut(
        chunk_id=candidate.chunk.id,
        document_id=candidate.document.id,
        document_name=candidate.document.original_name,
        sequence=candidate.chunk.sequence,
        title=candidate.chunk.title,
        text=candidate.embedding.source_text,
        page_number=candidate.chunk.page_number,
        vector_score=round(candidate.score, 6),
        rerank_score=round(rerank_score, 6) if rerank_score is not None else None,
    )


async def retrieve_knowledge(
    db: Session,
    gateway: ModelGateway,
    knowledge_base: KnowledgeBase,
    payload: RetrievalRequest,
    *,
    trace: TraceRecorder | None = None,
    parent_span_id: str | None = None,
) -> RetrievalOut:
    started = time.perf_counter()
    query = payload.query.strip()
    if not query:
        raise ApiError(422, "EMPTY_RETRIEVAL_QUERY", "检索问题不能为空")
    version = _active_version(db, knowledge_base)
    model, provider = _enabled_model(db, version.embedding_model_id, "Embedding")
    embedding_span = trace.start(
        "QueryEmbedding",
        kind="model",
        parent_id=parent_span_id,
        summary="查询向量生成",
        input_text="当前用户问题 · 原文采集未开启",
        attributes={"index_version_id": version.id, "dimensions": version.dimensions},
        provider=provider,
        model=model,
    ) if trace else None
    try:
        embedded = await gateway.embed_documents(
            provider,
            model,
            decrypt_secret(provider.secret_ciphertext),
            [query],
        )
        if len(embedded.vectors) != 1 or len(embedded.vectors[0]) != version.dimensions:
            raise ApiError(502, "EMBEDDING_DIMENSION_MISMATCH", "查询向量维度与活动索引不一致")
    except Exception as exc:
        code, message, _ = safe_error(exc, "EMBEDDING_PROVIDER_FAILED", "Embedding 调用失败")
        if trace and embedding_span:
            trace.finish(embedding_span, "failed", output=message, error_code=code)
        raise
    if trace and embedding_span:
        trace.finish(
            embedding_span,
            "succeeded",
            output=f"vector[{version.dimensions}] · 向量内容未采集",
            embedding=embedded,
        )

    vector_span = trace.start(
        "VectorSearch",
        parent_id=parent_span_id,
        summary="pgvector 活动版本召回",
        input_text=f"candidate_k={max(payload.candidate_k, payload.top_k)} · threshold={payload.similarity_threshold}",
        attributes={"index_version_id": version.id},
    ) if trace else None
    try:
        candidates = _vector_candidates(
            db,
            version,
            embedded.vectors[0],
            max(payload.candidate_k, payload.top_k),
        )
        candidates = [item for item in candidates if item.score >= payload.similarity_threshold]
    except Exception as exc:
        code, message, _ = safe_error(exc, "VECTOR_SEARCH_FAILED", "向量检索失败")
        if trace and vector_span:
            trace.finish(vector_span, "failed", output=message, error_code=code)
        raise
    candidate_count = len(candidates)
    if trace and vector_span:
        trace.finish(
            vector_span,
            "succeeded",
            output=f"达到阈值的候选 {candidate_count} 个",
            attributes={"candidate_count": candidate_count},
        )

    rerank_duration = None
    if payload.rerank and candidates:
        if not knowledge_base.rerank_model_id:
            raise ApiError(409, "RERANK_MODEL_NOT_CONFIGURED", "知识库未配置 Rerank 模型")
        rerank_model, rerank_provider = _enabled_model(db, knowledge_base.rerank_model_id, "Rerank")
        rerank_span = trace.start(
            "Rerank",
            kind="model",
            parent_id=parent_span_id,
            summary="候选池内独立重排",
            input_text=f"query + {candidate_count} 个候选分块 · 原文采集未开启",
            provider=rerank_provider,
            model=rerank_model,
        ) if trace else None
        try:
            reranked = await gateway.rerank(
                rerank_provider,
                rerank_model,
                decrypt_secret(rerank_provider.secret_ciphertext),
                query,
                [item.embedding.source_text for item in candidates],
                payload.top_k,
            )
        except Exception as exc:
            code, message, _ = safe_error(exc, "RERANK_PROVIDER_FAILED", "Rerank 调用失败")
            if trace and rerank_span:
                trace.finish(rerank_span, "failed", output=message, error_code=code)
            raise
        rerank_duration = reranked.duration_ms
        results = [
            _result_out(candidates[index], score)
            for index, score in sorted(reranked.scores, key=lambda item: -item[1])[: payload.top_k]
        ]
        if trace and rerank_span:
            trace.finish(
                rerank_span,
                "succeeded",
                output=f"返回 {len(results)} 个重排结果",
                attributes={"top_n": payload.top_k},
            )
    else:
        results = [_result_out(candidate) for candidate in candidates[: payload.top_k]]
    return RetrievalOut(
        index_version_id=version.id,
        results=results,
        candidate_count=candidate_count,
        duration_ms=round((time.perf_counter() - started) * 1000),
        embedding_duration_ms=embedded.duration_ms,
        rerank_duration_ms=rerank_duration,
    )
