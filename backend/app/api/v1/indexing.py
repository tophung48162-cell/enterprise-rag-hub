from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.db_models import IndexVersion
from app.errors import ApiError
from app.schemas import IndexVersionOut
from app.services.index_queue import IndexDispatcher, get_index_dispatcher
from app.services.indexing import mark_index_failed, prepare_index_version
from app.services.knowledge import get_knowledge_base

router = APIRouter(tags=["向量索引"])


def index_version_out(version: IndexVersion) -> IndexVersionOut:
    return IndexVersionOut(
        id=version.id,
        kb_id=version.kb_id,
        embedding_model_id=version.embedding_model_id,
        dimensions=version.dimensions,
        chunk_size=version.chunk_size,
        chunk_overlap=version.chunk_overlap,
        chunk_strategy=version.chunk_strategy,
        status=version.status,
        progress=version.progress,
        total_chunks=version.total_chunks,
        embedded_chunks=version.embedded_chunks,
        input_tokens=version.input_tokens,
        usage_source=version.usage_source,
        duration_ms=version.duration_ms,
        error_code=version.error_code,
        created_at=version.created_at,
        started_at=version.started_at,
        completed_at=version.completed_at,
        activated_at=version.activated_at,
    )


def get_index_version(db: Session, version_id: str) -> IndexVersion:
    version = db.get(IndexVersion, version_id)
    if not version:
        raise ApiError(404, "INDEX_VERSION_NOT_FOUND", "索引版本不存在")
    return version


@router.post(
    "/knowledge-bases/{knowledge_base_id}/index-versions",
    response_model=IndexVersionOut,
    status_code=202,
)
def create_index_version(
    knowledge_base_id: str,
    db: Session = Depends(get_db),
    dispatcher: IndexDispatcher = Depends(get_index_dispatcher),
) -> IndexVersionOut:
    knowledge_base = get_knowledge_base(db, knowledge_base_id)
    version = prepare_index_version(db, knowledge_base)
    try:
        dispatcher(version.id)
    except Exception as exc:
        mark_index_failed(db, version.id, "INDEX_QUEUE_UNAVAILABLE")
        raise ApiError(
            503,
            "INDEX_QUEUE_UNAVAILABLE",
            "索引任务暂时无法提交，请稍后重试",
            retryable=True,
            details={"index_version_id": version.id},
        ) from exc
    return index_version_out(version)


@router.get("/knowledge-bases/{knowledge_base_id}/index-versions", response_model=list[IndexVersionOut])
def list_index_versions(knowledge_base_id: str, db: Session = Depends(get_db)) -> list[IndexVersionOut]:
    knowledge_base = get_knowledge_base(db, knowledge_base_id)
    versions = db.scalars(
        select(IndexVersion)
        .where(IndexVersion.kb_id == knowledge_base.id)
        .order_by(IndexVersion.created_at.desc(), IndexVersion.id.desc())
    ).all()
    return [index_version_out(version) for version in versions]


@router.get("/index-versions/{version_id}", response_model=IndexVersionOut)
def get_index_version_detail(version_id: str, db: Session = Depends(get_db)) -> IndexVersionOut:
    return index_version_out(get_index_version(db, version_id))
