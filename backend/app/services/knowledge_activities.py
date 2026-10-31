import logging
from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db_models import Document, IndexVersion, KnowledgeActivity, ObservabilitySpan, uuid_str

logger = logging.getLogger(__name__)


def record_knowledge_activity(
    db: Session,
    *,
    knowledge_base_id: str,
    document_id: str | None,
    stage: str,
    name: str,
    status: str,
    started_at: datetime,
    ended_at: datetime,
    duration_ms: int,
    input_text: str = "",
    output_text: str = "",
    attributes: dict[str, Any] | None = None,
    error_code: str | None = None,
) -> None:
    """Persist a real operation without making observability a workflow prerequisite."""
    try:
        db.add(
            KnowledgeActivity(
                kb_id=knowledge_base_id,
                document_id=document_id,
                stage=stage,
                name=name[:500],
                status=status,
                input_text=input_text[:4000],
                output_text=output_text[:4000],
                attributes_json=attributes or {},
                error_code=error_code,
                started_at=started_at,
                ended_at=ended_at,
                duration_ms=max(0, duration_ms),
            )
        )
        db.commit()
    except Exception:
        db.rollback()
        logger.exception("Failed to record knowledge activity for kb_id=%s stage=%s", knowledge_base_id, stage)


def attach_knowledge_activities(
    db: Session,
    *,
    version: IndexVersion,
    root: ObservabilitySpan,
) -> None:
    """Attach each current document's latest successful upload and chunk operation."""
    documents = dict(
        db.execute(
            select(Document.id, Document.original_name).where(Document.kb_id == version.kb_id)
        ).all()
    )
    if not documents:
        return
    activities = list(
        db.scalars(
            select(KnowledgeActivity)
            .where(
                KnowledgeActivity.kb_id == version.kb_id,
                KnowledgeActivity.document_id.in_(documents),
                KnowledgeActivity.stage.in_(["upload", "chunk"]),
                KnowledgeActivity.status == "succeeded",
            )
            .order_by(KnowledgeActivity.started_at, KnowledgeActivity.id)
        )
    )
    latest: dict[tuple[str, str], KnowledgeActivity] = {}
    for activity in activities:
        if activity.document_id is not None:
            latest[(activity.document_id, activity.stage)] = activity

    for sequence, activity in enumerate(
        sorted(latest.values(), key=lambda item: (item.started_at, item.id)),
        start=1,
    ):
        stage_label = "原件上传与对象存储校验" if activity.stage == "upload" else "LangChain 持久化分块"
        db.add(
            ObservabilitySpan(
                id=uuid_str(),
                build_id=version.id,
                trace_id=root.trace_id,
                parent_span_id=root.id,
                kind="stage",
                name=activity.name,
                status=activity.status,
                sequence=sequence,
                started_at=activity.started_at,
                ended_at=activity.ended_at,
                offset_ms=0,
                duration_ms=activity.duration_ms,
                summary=f"{stage_label} · 操作发生时持久化",
                input_text=activity.input_text,
                output_text=activity.output_text,
                attributes_json={
                    **(activity.attributes_json or {}),
                    "knowledge_activity_id": activity.id,
                    "document_id": activity.document_id,
                    "document_name": documents.get(activity.document_id),
                    "recorded_before_index": True,
                },
                error_code=activity.error_code,
            )
        )
    db.flush()
