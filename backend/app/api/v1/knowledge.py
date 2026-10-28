from fastapi import APIRouter, Depends, File, UploadFile
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.db_models import Chunk, Document, KnowledgeBase
from app.errors import ApiError
from app.schemas import (
    ChunkOut,
    ChunkPatch,
    DocumentOut,
    DocumentPreviewOut,
    DocumentPreviewRequest,
    KnowledgeBaseCreate,
    KnowledgeBaseOut,
    KnowledgeBasePatch,
)
from app.services.knowledge import (
    delete_document,
    get_chunk,
    get_document,
    get_knowledge_base,
    preview_markdown,
    upload_markdown,
    validate_chunk_config,
    validate_model_capability,
)
from app.storage import ObjectStorage, get_storage

router = APIRouter(tags=["知识库与文档"])


def chunk_out(chunk: Chunk) -> ChunkOut:
    return ChunkOut(
        id=chunk.id,
        kb_id=chunk.kb_id,
        document_id=chunk.document_id,
        sequence=chunk.sequence,
        title=chunk.title,
        text=chunk.text,
        page_number=chunk.page_number,
        status=chunk.status,
        created_at=chunk.created_at,
        updated_at=chunk.updated_at,
    )


def document_out(document: Document) -> DocumentOut:
    return DocumentOut(
        id=document.id,
        kb_id=document.kb_id,
        original_name=document.original_name,
        mime=document.mime,
        extension=document.extension,
        size_bytes=document.size_bytes,
        sha256=document.sha256,
        status=document.status,
        parser_version=document.parser_version,
        error_code=document.error_code,
        chunk_count=len(document.chunks),
        created_at=document.created_at,
        updated_at=document.updated_at,
    )


def knowledge_base_out(knowledge_base: KnowledgeBase) -> KnowledgeBaseOut:
    return KnowledgeBaseOut(
        id=knowledge_base.id,
        name=knowledge_base.name,
        description=knowledge_base.description,
        department=knowledge_base.department,
        published=knowledge_base.published,
        managed=knowledge_base.managed,
        embedding_model_id=knowledge_base.embedding_model_id,
        rerank_model_id=knowledge_base.rerank_model_id,
        chunk_size=knowledge_base.chunk_size,
        chunk_overlap=knowledge_base.chunk_overlap,
        chunk_strategy=knowledge_base.chunk_strategy,
        document_count=len(knowledge_base.documents),
        chunk_count=sum(len(document.chunks) for document in knowledge_base.documents),
        created_at=knowledge_base.created_at,
        updated_at=knowledge_base.updated_at,
    )


@router.get("/knowledge-bases", response_model=list[KnowledgeBaseOut])
def list_knowledge_bases(db: Session = Depends(get_db)) -> list[KnowledgeBaseOut]:
    items = db.scalars(select(KnowledgeBase).order_by(KnowledgeBase.created_at)).all()
    return [knowledge_base_out(item) for item in items]


@router.post("/knowledge-bases", response_model=KnowledgeBaseOut, status_code=201)
def create_knowledge_base(payload: KnowledgeBaseCreate, db: Session = Depends(get_db)) -> KnowledgeBaseOut:
    validate_chunk_config(payload.chunk_size, payload.chunk_overlap)
    validate_model_capability(db, payload.embedding_model_id, "Embedding")
    if payload.rerank_model_id:
        validate_model_capability(db, payload.rerank_model_id, "Rerank")
    values = payload.model_dump()
    values["name"] = payload.name.strip()
    values["department"] = payload.department.strip()
    knowledge_base = KnowledgeBase(**values)
    db.add(knowledge_base)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise ApiError(409, "KNOWLEDGE_BASE_NAME_EXISTS", "知识库名称已存在") from exc
    return knowledge_base_out(knowledge_base)


@router.get("/knowledge-bases/{knowledge_base_id}", response_model=KnowledgeBaseOut)
def get_knowledge_base_detail(knowledge_base_id: str, db: Session = Depends(get_db)) -> KnowledgeBaseOut:
    return knowledge_base_out(get_knowledge_base(db, knowledge_base_id))


@router.patch("/knowledge-bases/{knowledge_base_id}", response_model=KnowledgeBaseOut)
def patch_knowledge_base(
    knowledge_base_id: str,
    payload: KnowledgeBasePatch,
    db: Session = Depends(get_db),
) -> KnowledgeBaseOut:
    knowledge_base = get_knowledge_base(db, knowledge_base_id)
    values = payload.model_dump(exclude_unset=True)
    chunk_size = values.get("chunk_size", knowledge_base.chunk_size)
    chunk_overlap = values.get("chunk_overlap", knowledge_base.chunk_overlap)
    validate_chunk_config(chunk_size, chunk_overlap)
    embedding_model_id = values.get("embedding_model_id", knowledge_base.embedding_model_id)
    validate_model_capability(db, embedding_model_id, "Embedding")
    rerank_model_id = values.get("rerank_model_id", knowledge_base.rerank_model_id)
    if rerank_model_id:
        validate_model_capability(db, rerank_model_id, "Rerank")
    for key, value in values.items():
        if key in {"name", "department"} and isinstance(value, str):
            value = value.strip()
        setattr(knowledge_base, key, value)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise ApiError(409, "KNOWLEDGE_BASE_NAME_EXISTS", "知识库名称已存在") from exc
    return knowledge_base_out(knowledge_base)


@router.delete("/knowledge-bases/{knowledge_base_id}", status_code=204)
def remove_knowledge_base(knowledge_base_id: str, db: Session = Depends(get_db)) -> None:
    knowledge_base = get_knowledge_base(db, knowledge_base_id)
    if knowledge_base.documents:
        raise ApiError(409, "KNOWLEDGE_BASE_NOT_EMPTY", "请先删除知识库中的全部文档")
    db.delete(knowledge_base)
    db.commit()


@router.get("/knowledge-bases/{knowledge_base_id}/documents", response_model=list[DocumentOut])
def list_documents(knowledge_base_id: str, db: Session = Depends(get_db)) -> list[DocumentOut]:
    knowledge_base = get_knowledge_base(db, knowledge_base_id)
    documents = db.scalars(
        select(Document).where(Document.kb_id == knowledge_base.id).order_by(Document.created_at)
    ).all()
    return [document_out(item) for item in documents]


@router.post("/knowledge-bases/{knowledge_base_id}/documents", response_model=DocumentOut, status_code=201)
async def upload_document(
    knowledge_base_id: str,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    storage: ObjectStorage = Depends(get_storage),
) -> DocumentOut:
    knowledge_base = get_knowledge_base(db, knowledge_base_id)
    data = await file.read(get_settings().document_max_file_bytes + 1)
    await file.close()
    document = upload_markdown(
        db,
        storage,
        knowledge_base=knowledge_base,
        data=data,
        file_name=file.filename or "",
        mime=file.content_type or "text/markdown",
    )
    return document_out(document)


@router.get("/documents/{document_id}", response_model=DocumentOut)
def get_document_detail(document_id: str, db: Session = Depends(get_db)) -> DocumentOut:
    return document_out(get_document(db, document_id))


@router.delete("/documents/{document_id}", status_code=204)
def remove_document(
    document_id: str,
    db: Session = Depends(get_db),
    storage: ObjectStorage = Depends(get_storage),
) -> None:
    delete_document(db, storage, get_document(db, document_id))


@router.post("/documents/{document_id}/preview", response_model=DocumentPreviewOut)
def preview_document(
    document_id: str,
    payload: DocumentPreviewRequest,
    db: Session = Depends(get_db),
    storage: ObjectStorage = Depends(get_storage),
) -> DocumentPreviewOut:
    document = get_document(db, document_id)
    chunks = preview_markdown(
        db,
        storage,
        document=document,
        chunk_size=payload.chunk_size,
        chunk_overlap=payload.chunk_overlap,
        chunk_strategy=payload.chunk_strategy,
    )
    return DocumentPreviewOut(
        document=document_out(document),
        chunks=[chunk_out(chunk) for chunk in sorted(chunks, key=lambda item: item.sequence)],
    )


@router.get("/documents/{document_id}/chunks", response_model=list[ChunkOut])
def list_chunks(document_id: str, db: Session = Depends(get_db)) -> list[ChunkOut]:
    document = get_document(db, document_id)
    return [chunk_out(chunk) for chunk in sorted(document.chunks, key=lambda item: item.sequence)]


@router.patch("/chunks/{chunk_id}", response_model=ChunkOut)
def patch_chunk(chunk_id: str, payload: ChunkPatch, db: Session = Depends(get_db)) -> ChunkOut:
    chunk = get_chunk(db, chunk_id)
    text = payload.text.strip()
    if not text:
        raise ApiError(422, "EMPTY_CHUNK_CONTENT", "分块内容不能为空")
    chunk.text = text
    chunk.status = "pending_index"
    chunk.document.status = "pending_index"
    db.commit()
    return chunk_out(chunk)
