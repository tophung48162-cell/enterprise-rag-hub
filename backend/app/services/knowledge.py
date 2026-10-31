import hashlib
import time
from datetime import UTC, datetime
from pathlib import Path

from botocore.exceptions import BotoCoreError, ClientError
from langchain_core.documents import Document as LangChainDocument
from langchain_text_splitters import MarkdownHeaderTextSplitter, RecursiveCharacterTextSplitter
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db_models import Chunk, Document, KnowledgeBase
from app.errors import ApiError
from app.services.configs import get_model
from app.services.indexing import ensure_no_running_index
from app.services.knowledge_activities import record_knowledge_activity
from app.storage import ObjectStorage

MARKDOWN_HEADERS = [("#", "h1"), ("##", "h2"), ("###", "h3")]


def get_knowledge_base(db: Session, knowledge_base_id: str) -> KnowledgeBase:
    knowledge_base = db.get(KnowledgeBase, knowledge_base_id)
    if not knowledge_base:
        raise ApiError(404, "KNOWLEDGE_BASE_NOT_FOUND", "知识库不存在")
    return knowledge_base


def get_document(db: Session, document_id: str) -> Document:
    document = db.get(Document, document_id)
    if not document:
        raise ApiError(404, "DOCUMENT_NOT_FOUND", "文档不存在")
    return document


def get_chunk(db: Session, chunk_id: str) -> Chunk:
    chunk = db.get(Chunk, chunk_id)
    if not chunk:
        raise ApiError(404, "CHUNK_NOT_FOUND", "分块不存在")
    return chunk


def validate_chunk_config(chunk_size: int, chunk_overlap: int) -> None:
    if chunk_overlap >= chunk_size:
        raise ApiError(422, "INVALID_CHUNK_OVERLAP", "重叠长度必须小于目标分块长度")


def validate_model_capability(db: Session, model_id: str, capability: str) -> None:
    model = get_model(db, model_id)
    if model.capability != capability:
        raise ApiError(422, "MODEL_CAPABILITY_MISMATCH", f"请选择 {capability} 类型的模型")
    if not model.enabled:
        raise ApiError(409, "MODEL_DISABLED", f"{capability} 模型已停用")


def safe_markdown_name(file_name: str) -> str:
    name = Path(file_name.replace("\\", "/")).name.replace("\x00", "").strip()[:255]
    if not name:
        raise ApiError(422, "INVALID_FILE_NAME", "文件名称不能为空")
    if not name.lower().endswith(".md"):
        raise ApiError(415, "DOCUMENT_FORMAT_UNSUPPORTED", "当前真实上传链路仅支持 Markdown（.md）文件")
    return name


def decode_markdown(data: bytes) -> str:
    if not data:
        raise ApiError(422, "EMPTY_FILE", "不能上传空文件")
    if len(data) > get_settings().document_max_file_bytes:
        raise ApiError(413, "DOCUMENT_FILE_TOO_LARGE", "Markdown 文件超过 50 MB 服务端限制")
    if b"\x00" in data:
        raise ApiError(422, "INVALID_MARKDOWN", "文件包含二进制内容，不是有效的 UTF-8 Markdown")
    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise ApiError(422, "MARKDOWN_ENCODING_UNSUPPORTED", "Markdown 必须使用 UTF-8 编码") from exc
    if not text.strip():
        raise ApiError(422, "EMPTY_DOCUMENT_CONTENT", "Markdown 没有可分块的文本内容")
    return text


def split_markdown(text: str, chunk_size: int, chunk_overlap: int, strategy: str) -> list[tuple[str, str]]:
    validate_chunk_config(chunk_size, chunk_overlap)
    if strategy == "structure":
        sections = MarkdownHeaderTextSplitter(
            headers_to_split_on=MARKDOWN_HEADERS,
            strip_headers=False,
        ).split_text(text)
    else:
        sections = [LangChainDocument(page_content=text)]
    recursive = RecursiveCharacterTextSplitter(
        chunk_size=chunk_size,
        chunk_overlap=chunk_overlap,
        separators=["\n\n", "\n", "。", "；", " ", ""],
    )
    split_documents = recursive.split_documents(sections)
    results: list[tuple[str, str]] = []
    for document in split_documents:
        content = document.page_content.strip()
        if not content:
            continue
        title = " / ".join(
            str(document.metadata[key]) for key in ("h1", "h2", "h3") if document.metadata.get(key)
        )
        results.append((title or "Markdown 正文", content))
    if not results:
        raise ApiError(422, "EMPTY_DOCUMENT_CONTENT", "Markdown 没有可分块的文本内容")
    return results


def _upload_markdown(
    db: Session,
    storage: ObjectStorage,
    *,
    knowledge_base: KnowledgeBase,
    data: bytes,
    file_name: str,
    mime: str,
) -> Document:
    ensure_no_running_index(db, knowledge_base.id)
    name = safe_markdown_name(file_name)
    decode_markdown(data)
    digest = hashlib.sha256(data).hexdigest()
    duplicate = db.scalar(
        select(Document).where(
            Document.kb_id == knowledge_base.id,
            or_(func.lower(Document.original_name) == name.lower(), Document.sha256 == digest),
        )
    )
    if duplicate:
        raise ApiError(409, "DOCUMENT_ALREADY_EXISTS", "同一知识库中已存在同名或相同内容的文件")
    document = Document(
        kb_id=knowledge_base.id,
        original_name=name,
        mime=mime or "text/markdown",
        extension=".md",
        size_bytes=len(data),
        sha256=digest,
        object_key="pending",
        status="uploaded",
        parser_version="markdown-v1",
    )
    db.add(document)
    db.flush()
    document.object_key = f"knowledge/{knowledge_base.id}/documents/{document.id}/{name}"
    try:
        storage.put_bytes(document.object_key, data, document.mime)
        db.commit()
    except (BotoCoreError, ClientError, OSError) as exc:
        db.rollback()
        raise ApiError(503, "OBJECT_STORAGE_UNAVAILABLE", "原件保存失败，请检查对象存储", retryable=True) from exc
    return document


def upload_markdown(
    db: Session,
    storage: ObjectStorage,
    *,
    knowledge_base: KnowledgeBase,
    data: bytes,
    file_name: str,
    mime: str,
) -> Document:
    started_at = datetime.now(UTC)
    started = time.perf_counter()
    display_name = Path(file_name.replace("\\", "/")).name.replace("\x00", "").strip()[:255] or "未命名文件"
    try:
        document = _upload_markdown(
            db,
            storage,
            knowledge_base=knowledge_base,
            data=data,
            file_name=file_name,
            mime=mime,
        )
    except Exception as exc:
        db.rollback()
        record_knowledge_activity(
            db,
            knowledge_base_id=knowledge_base.id,
            document_id=None,
            stage="upload",
            name=f"Upload · {display_name}",
            status="failed",
            started_at=started_at,
            ended_at=datetime.now(UTC),
            duration_ms=round((time.perf_counter() - started) * 1000),
            input_text=f"{display_name} · {len(data)} 字节",
            output_text=exc.message if isinstance(exc, ApiError) else "文档上传失败",
            error_code=exc.code if isinstance(exc, ApiError) else "DOCUMENT_UPLOAD_FAILED",
        )
        raise
    record_knowledge_activity(
        db,
        knowledge_base_id=knowledge_base.id,
        document_id=document.id,
        stage="upload",
        name=f"Upload · {document.original_name}",
        status="succeeded",
        started_at=started_at,
        ended_at=datetime.now(UTC),
        duration_ms=round((time.perf_counter() - started) * 1000),
        input_text=f"{document.original_name} · {document.size_bytes} 字节 · {document.mime}",
        output_text="UTF-8 与重复内容校验通过，原件已写入私有对象存储",
        attributes={
            "size_bytes": document.size_bytes,
            "sha256": document.sha256,
            "mime": document.mime,
            "parser_version": document.parser_version,
        },
    )
    return document


def _preview_markdown(
    db: Session,
    storage: ObjectStorage,
    *,
    document: Document,
    chunk_size: int,
    chunk_overlap: int,
    chunk_strategy: str,
) -> list[Chunk]:
    ensure_no_running_index(db, document.kb_id)
    validate_chunk_config(chunk_size, chunk_overlap)
    try:
        data = storage.get_bytes(document.object_key)
    except (BotoCoreError, ClientError, OSError, KeyError) as exc:
        raise ApiError(503, "OBJECT_STORAGE_UNAVAILABLE", "无法读取 Markdown 原件", retryable=True) from exc
    sections = split_markdown(decode_markdown(data), chunk_size, chunk_overlap, chunk_strategy)
    document.chunks.clear()
    db.flush()
    for sequence, (title, text) in enumerate(sections):
        document.chunks.append(
            Chunk(
                kb_id=document.kb_id,
                sequence=sequence,
                title=title,
                text=text,
                page_number=sequence + 1,
                status="pending_index",
            )
        )
    document.status = "pending_index"
    document.error_code = None
    document.knowledge_base.chunk_size = chunk_size
    document.knowledge_base.chunk_overlap = chunk_overlap
    document.knowledge_base.chunk_strategy = chunk_strategy
    db.commit()
    return document.chunks


def preview_markdown(
    db: Session,
    storage: ObjectStorage,
    *,
    document: Document,
    chunk_size: int,
    chunk_overlap: int,
    chunk_strategy: str,
) -> list[Chunk]:
    started_at = datetime.now(UTC)
    started = time.perf_counter()
    try:
        chunks = _preview_markdown(
            db,
            storage,
            document=document,
            chunk_size=chunk_size,
            chunk_overlap=chunk_overlap,
            chunk_strategy=chunk_strategy,
        )
    except Exception as exc:
        db.rollback()
        record_knowledge_activity(
            db,
            knowledge_base_id=document.kb_id,
            document_id=document.id,
            stage="chunk",
            name=f"Chunk · {document.original_name}",
            status="failed",
            started_at=started_at,
            ended_at=datetime.now(UTC),
            duration_ms=round((time.perf_counter() - started) * 1000),
            input_text=f"chunk_size={chunk_size} · chunk_overlap={chunk_overlap} · strategy={chunk_strategy}",
            output_text=exc.message if isinstance(exc, ApiError) else "文档分块失败",
            error_code=exc.code if isinstance(exc, ApiError) else "DOCUMENT_CHUNK_FAILED",
        )
        raise
    record_knowledge_activity(
        db,
        knowledge_base_id=document.kb_id,
        document_id=document.id,
        stage="chunk",
        name=f"Chunk · {document.original_name}",
        status="succeeded",
        started_at=started_at,
        ended_at=datetime.now(UTC),
        duration_ms=round((time.perf_counter() - started) * 1000),
        input_text=f"chunk_size={chunk_size} · chunk_overlap={chunk_overlap} · strategy={chunk_strategy}",
        output_text=f"LangChain 生成并持久化 {len(chunks)} 个分块，状态为待索引",
        attributes={
            "chunk_size": chunk_size,
            "chunk_overlap": chunk_overlap,
            "chunk_strategy": chunk_strategy,
            "chunk_count": len(chunks),
            "character_count": sum(len(chunk.text) for chunk in chunks),
        },
    )
    return chunks


def delete_document(db: Session, storage: ObjectStorage, document: Document) -> None:
    ensure_no_running_index(db, document.kb_id)
    if document.status == "processing":
        raise ApiError(409, "DOCUMENT_TASK_RUNNING", "文档正在处理，完成后才能删除")
    object_key = document.object_key
    try:
        storage.delete_bytes(object_key)
    except (BotoCoreError, ClientError, OSError, KeyError) as exc:
        raise ApiError(503, "OBJECT_STORAGE_UNAVAILABLE", "原件删除失败，请稍后重试", retryable=True) from exc
    db.delete(document)
    db.commit()
