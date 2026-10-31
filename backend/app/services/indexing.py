import hashlib
import time
from datetime import UTC, datetime

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.db_models import Chunk, ChunkEmbedding, IndexVersion, KnowledgeBase, ObservabilitySpan
from app.errors import ApiError
from app.providers.gateway import ModelGateway
from app.security import decrypt_secret
from app.services.configs import get_model, get_provider
from app.services.observability import TraceRecorder, create_build_trace_root

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
    create_build_trace_root(db, version, knowledge_name=knowledge_base.name)
    if not knowledge_base.active_index_version_id:
        for document in knowledge_base.documents:
            document.status = "processing"
            document.error_code = None
            for chunk in document.chunks:
                chunk.status = "indexing"
    db.commit()
    return version


def mark_index_failed(
    db: Session,
    version_id: str,
    error_code: str,
    *,
    safe_message: str = "索引构建失败，请查看错误码与调用节点",
    retryable: bool = False,
) -> IndexVersion | None:
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
    has_trace = db.scalar(
        select(ObservabilitySpan.id).where(
            ObservabilitySpan.build_id == version_id,
            ObservabilitySpan.parent_span_id.is_(None),
        )
    )
    if has_trace:
        recorder = TraceRecorder(db, build_id=version_id)
        recorder.close_open(
            "failed",
            code=error_code,
            message=safe_message,
            category="模型调用" if "EMBEDDING" in error_code else "Harness",
            severity="error",
            retryable=retryable,
        )
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
    version.input_tokens = None
    version.usage_source = "unavailable"
    version.error_code = None
    version.started_at = datetime.now(UTC)
    version.completed_at = None
    version.activated_at = None
    db.execute(delete(ChunkEmbedding).where(ChunkEmbedding.index_version_id == version.id))
    db.commit()
    recorder = TraceRecorder(db, build_id=version_id)
    recorder.root.status = "running"
    recorder.root.started_at = version.started_at
    recorder.root.ended_at = None
    recorder.root.duration_ms = None
    recorder.root.error_code = None
    recorder.root.output_text = ""
    db.commit()
    started = time.perf_counter()
    try:
        validate_span = recorder.start(
            "ValidateSource",
            summary="校验知识分块、源哈希和 Embedding 配置",
            input_text=f"source_hash={version.source_hash}",
        )
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
        recorder.finish(
            validate_span,
            "succeeded",
            output=f"{len(chunks)} 个分块 · {version.dimensions} 维 · 源哈希一致",
            attributes={
                "total_chunks": len(chunks),
                "dimensions": version.dimensions,
                "batch_size": EMBEDDING_BATCH_SIZE,
            },
        )

        total_batches = (len(chunks) + EMBEDDING_BATCH_SIZE - 1) // EMBEDDING_BATCH_SIZE
        embedding_stage = recorder.start(
            "Embedding Stage",
            summary="分批调用 Embedding 并写入不可变向量快照",
            input_text=f"{total_batches} 个批次 · 每批最多 {EMBEDDING_BATCH_SIZE} 个分块",
            attributes={"total_batches": total_batches, "completed_batches": 0},
        )
        for offset in range(0, len(chunks), EMBEDDING_BATCH_SIZE):
            batch = chunks[offset : offset + EMBEDDING_BATCH_SIZE]
            batch_number = offset // EMBEDDING_BATCH_SIZE + 1
            batch_name = f"Embedding · batch {batch_number}"
            attempt = 1 + (
                db.scalar(
                    select(func.count(ObservabilitySpan.id)).where(
                        ObservabilitySpan.build_id == version.id,
                        ObservabilitySpan.name == batch_name,
                    )
                )
                or 0
            )
            batch_span = recorder.start(
                batch_name,
                kind="model",
                parent_id=embedding_stage.span.id,
                summary=f"Embedding 批次 {batch_number}／{total_batches}",
                input_text=(
                    f"{len(batch)} 个分块 · {sum(len(chunk.text) for chunk in batch)} 字符 · 不保存批次全文"
                ),
                attributes={
                    "batch_number": batch_number,
                    "chunk_start": offset + 1,
                    "chunk_end": offset + len(batch),
                    "chunk_count": len(batch),
                },
                provider=provider,
                model=model,
                attempt=attempt,
            )
            result = await gateway.embed_documents(
                provider,
                model,
                decrypt_secret(provider.secret_ciphertext),
                [chunk.text for chunk in batch],
            )
            _validate_vectors(result.vectors, len(batch), version.dimensions)
            recorder.finish(
                batch_span,
                "succeeded",
                output=f"返回 {len(result.vectors)} 个 {version.dimensions} 维向量",
                embedding=result,
                attributes={"dimensions": version.dimensions},
            )

            write_span = recorder.start(
                f"VectorWrite · batch {batch_number}",
                parent_id=embedding_stage.span.id,
                summary="写入当前索引版本的向量快照",
                input_text=f"batch={batch_number} · {len(batch)} 个向量",
            )
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
            recorder.finish(write_span, "succeeded", output=f"已保存 {len(batch)} 条向量快照")
            embedding_stage.span.attributes_json = {
                **(embedding_stage.span.attributes_json or {}),
                "completed_batches": batch_number,
                "embedded_chunks": version.embedded_chunks,
            }
            embedding_stage.span.output_text = f"已完成 {batch_number}／{total_batches} 批"
            db.commit()

        recorder.finish(
            embedding_stage,
            "succeeded",
            output=f"{total_batches} 批全部完成 · {version.embedded_chunks} 个向量",
        )
        if version.usage_source != "provider":
            recorder.record_event(
                code="USAGE_UNAVAILABLE",
                message="Embedding 服务商未返回完整 Token；构建保持成功，用量与成本标记未知。",
                category="可观测自身",
                severity="warning",
                retryable=False,
                span_id=embedding_stage.span.id,
            )

        validate_index_span = recorder.start(
            "ValidateIndex",
            summary="激活前复核源分块和向量快照完整性",
            input_text=f"index_version_id={version.id}",
        )
        db.expire_all()
        version = db.get(IndexVersion, version_id)
        knowledge_base = db.get(KnowledgeBase, version.kb_id)
        chunks = knowledge_chunks(db, version.kb_id)
        if not knowledge_base or chunks_source_hash(chunks) != version.source_hash:
            raise ApiError(409, "INDEX_CONTENT_CHANGED", "构建期间知识分块已变化，请创建新版本")
        vector_count = db.scalar(
            select(func.count(ChunkEmbedding.chunk_id)).where(ChunkEmbedding.index_version_id == version.id)
        )
        if vector_count != len(chunks):
            raise ApiError(500, "INDEX_SNAPSHOT_INCOMPLETE", "向量快照数量与源分块不一致", retryable=True)
        recorder.finish(
            validate_index_span,
            "succeeded",
            output=f"{vector_count} 条向量快照校验通过",
            attributes={"vector_count": vector_count, "source_hash": version.source_hash},
        )

        activate_span = recorder.start(
            "ActivateIndex",
            summary="事务内切换活动索引并保留旧版本快照",
            input_text=f"index_version_id={version.id}",
        )
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
        recorder.finish(
            activate_span,
            "succeeded",
            output=f"active_index_version={version.id}",
            attributes={
                "previous_index_version_id": previous_active.id if previous_active else None,
                "active_index_version_id": version.id,
            },
        )
        recorder.finish_root(
            "succeeded",
            output=f"索引已激活 · {len(chunks)} 个分块",
            duration_ms=version.duration_ms,
        )
        return version
    except ApiError as exc:
        db.rollback()
        mark_index_failed(
            db,
            version_id,
            exc.code,
            safe_message=exc.message,
            retryable=exc.retryable,
        )
        raise
    except Exception as exc:
        db.rollback()
        mark_index_failed(
            db,
            version_id,
            "INDEX_BUILD_FAILED",
            safe_message="索引构建失败，请稍后重试",
            retryable=True,
        )
        raise ApiError(502, "INDEX_BUILD_FAILED", "索引构建失败，请稍后重试", retryable=True) from exc
