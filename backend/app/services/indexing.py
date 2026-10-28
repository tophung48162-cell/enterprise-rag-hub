import hashlib
import time
from datetime import UTC, datetime

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.db_models import Chunk, ChunkEmbedding, IndexVersion, KnowledgeBase
from app.errors import ApiError
from app.providers.gateway import ModelGateway
from app.security import decrypt_secret
from app.services.configs import get_model, get_provider

EMBEDDING_BATCH_SIZE = 32
RUNNING_INDEX_STATUSES = ("queued", "building")


def knowledge_chunks(db: Session, knowledge_base_id: str) -> list[Chunk]:
    return list(
        db.scalars(
            select(Chunk)
            .where(Chunk.kb_id == knowledge_base_id)
            .order_by(Chunk.document_id, Chunk.sequence)
        ).all()
    )


def chunks_source_hash(chunks: list[Chunk]) -> str:
    digest = hashlib.sha256()
    for chunk in chunks:
        digest.update(chunk.id.encode("utf-8"))
        digest.update(b"\0")
        digest.update(chunk.text.encode("utf-8"))
        digest.update(b"\0")
    return digest.hexdigest()


def ensure_no_running_index(db: Session, knowledge_base_id: str) -> None:
    running = db.scalar(
        select(IndexVersion.id).where(
            IndexVersion.kb_id == knowledge_base_id,
            IndexVersion.status.in_(RUNNING_INDEX_STATUSES),
        )
    )
    if running:
        raise ApiError(409, "INDEX_BUILD_RUNNING", "索引正在构建，完成后才能修改知识内容或参数")


def prepare_index_version(db: Session, knowledge_base: KnowledgeBase) -> IndexVersion:
    ensure_no_running_index(db, knowledge_base.id)
    if not knowledge_base.documents or any(not document.chunks for document in knowledge_base.documents):
        raise ApiError(409, "DOCUMENT_CHUNKS_REQUIRED", "请先为知识库中的全部文档生成分块")
    chunks = knowledge_chunks(db, knowledge_base.id)
    if not chunks:
        raise ApiError(409, "DOCUMENT_CHUNKS_REQUIRED", "知识库中没有可索引的分块")
    model = get_model(db, knowledge_base.embedding_model_id)
    if model.capability != "Embedding" or not model.dimensions:
        raise ApiError(422, "EMBEDDING_MODEL_INVALID", "请选择带向量维度的 Embedding 模型")
    if not model.enabled or not get_provider(db, model.provider_id).enabled:
        raise ApiError(409, "EMBEDDING_MODEL_DISABLED", "Embedding 模型或服务商已停用")
    version = IndexVersion(
        kb_id=knowledge_base.id,
        embedding_model_id=model.id,
        dimensions=model.dimensions,
        chunk_size=knowledge_base.chunk_size,
        chunk_overlap=knowledge_base.chunk_overlap,
        chunk_strategy=knowledge_base.chunk_strategy,
        source_hash=chunks_source_hash(chunks),
        status="queued",
        total_chunks=len(chunks),
    )
    db.add(version)
    db.flush()
    if not knowledge_base.active_index_version_id:
        for document in knowledge_base.documents:
            document.status = "processing"
            document.error_code = None
            for chunk in document.chunks:
                chunk.status = "indexing"
    db.commit()
    return version


def mark_index_failed(db: Session, version_id: str, error_code: str) -> IndexVersion | None:
    version = db.get(IndexVersion, version_id)
    if not version:
        return None
    knowledge_base = db.get(KnowledgeBase, version.kb_id)
    has_previous_active = bool(
        knowledge_base
        and knowledge_base.active_index_version_id
        and knowledge_base.active_index_version_id != version.id
    )
    version.status = "failed"
    version.error_code = error_code
    version.completed_at = datetime.now(UTC)
    if knowledge_base:
        for document in knowledge_base.documents:
            document.status = "ready" if has_previous_active else "failed"
            document.error_code = None if has_previous_active else error_code
            for chunk in document.chunks:
                chunk.status = "ready" if has_previous_active else "failed"
    db.commit()
    return version


def _validate_vectors(vectors: list[list[float]], expected_count: int, dimensions: int) -> None:
    if len(vectors) != expected_count or any(len(vector) != dimensions for vector in vectors):
        raise ApiError(
            502,
            "EMBEDDING_DIMENSION_MISMATCH",
            "服务商返回的向量数量或维度与模型配置不一致",
            retryable=False,
        )


async def process_index_version(db: Session, gateway: ModelGateway, version_id: str) -> IndexVersion:
    version = db.get(IndexVersion, version_id)
    if not version:
        raise ApiError(404, "INDEX_VERSION_NOT_FOUND", "索引版本不存在")
    if version.status in {"active", "building"}:
        return version
    if version.status not in {"queued", "failed"}:
        raise ApiError(409, "INDEX_VERSION_NOT_PROCESSABLE", "索引版本当前不能构建")
    version.status = "building"
    version.progress = 0
    version.embedded_chunks = 0
    version.error_code = None
    version.started_at = datetime.now(UTC)
    version.completed_at = None
    version.activated_at = None
    db.execute(delete(ChunkEmbedding).where(ChunkEmbedding.index_version_id == version.id))
    db.commit()
    started = time.perf_counter()
    try:
        knowledge_base = db.get(KnowledgeBase, version.kb_id)
        if not knowledge_base:
            raise ApiError(404, "KNOWLEDGE_BASE_NOT_FOUND", "知识库不存在")
        model = get_model(db, version.embedding_model_id)
        provider = get_provider(db, model.provider_id)
        if not model.enabled or not provider.enabled:
            raise ApiError(409, "EMBEDDING_MODEL_DISABLED", "Embedding 模型或服务商已停用")
        chunks = knowledge_chunks(db, knowledge_base.id)
        if not chunks or chunks_source_hash(chunks) != version.source_hash:
            raise ApiError(409, "INDEX_CONTENT_CHANGED", "构建期间知识分块已变化，请创建新版本")
        for offset in range(0, len(chunks), EMBEDDING_BATCH_SIZE):
            batch = chunks[offset : offset + EMBEDDING_BATCH_SIZE]
            result = await gateway.embed_documents(
                provider,
                model,
                decrypt_secret(provider.secret_ciphertext),
                [chunk.text for chunk in batch],
            )
            _validate_vectors(result.vectors, len(batch), version.dimensions)
            for chunk, vector in zip(batch, result.vectors, strict=True):
                db.add(
                    ChunkEmbedding(
                        chunk_id=chunk.id,
                        index_version_id=version.id,
                        source_text=chunk.text,
                        content_hash=hashlib.sha256(chunk.text.encode("utf-8")).hexdigest(),
                        embedding=vector,
                    )
                )
            version.embedded_chunks += len(batch)
            version.progress = min(95, round(version.embedded_chunks / len(chunks) * 95))
            if result.input_tokens is not None:
                version.input_tokens = (version.input_tokens or 0) + result.input_tokens
            version.usage_source = result.usage_source
            db.commit()
        db.expire_all()
        version = db.get(IndexVersion, version_id)
        knowledge_base = db.get(KnowledgeBase, version.kb_id)
        chunks = knowledge_chunks(db, version.kb_id)
        if not knowledge_base or chunks_source_hash(chunks) != version.source_hash:
            raise ApiError(409, "INDEX_CONTENT_CHANGED", "构建期间知识分块已变化，请创建新版本")
        previous_active = (
            db.get(IndexVersion, knowledge_base.active_index_version_id)
            if knowledge_base.active_index_version_id
            else None
        )
        if previous_active and previous_active.id != version.id:
            previous_active.status = "ready"
        completed_at = datetime.now(UTC)
        version.status = "active"
        version.progress = 100
        version.embedded_chunks = len(chunks)
        version.completed_at = completed_at
        version.activated_at = completed_at
        version.duration_ms = round((time.perf_counter() - started) * 1000)
        knowledge_base.active_index_version_id = version.id
        for document in knowledge_base.documents:
            document.status = "ready"
            document.error_code = None
            for chunk in document.chunks:
                chunk.status = "ready"
        db.commit()
        return version
    except ApiError as exc:
        db.rollback()
        mark_index_failed(db, version_id, exc.code)
        raise
    except Exception as exc:
        db.rollback()
        mark_index_failed(db, version_id, "INDEX_BUILD_FAILED")
        raise ApiError(502, "INDEX_BUILD_FAILED", "索引构建失败，请稍后重试", retryable=True) from exc
