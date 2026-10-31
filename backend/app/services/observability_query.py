from collections import Counter
from datetime import UTC, datetime, timedelta

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.db_models import (
    Assistant,
    ContextSnapshot,
    ErrorEvent,
    IndexVersion,
    KnowledgeBase,
    ModelCall,
    ModelConfig,
    ObservabilitySpan,
    Provider,
    QueryRun,
    RunKnowledgeBase,
)
from app.errors import ApiError
from app.schemas import (
    ObservabilityContextMessageOut,
    ObservabilityContextSnapshotOut,
    ObservabilityErrorOut,
    ObservabilityRunDetailOut,
    ObservabilityRunOut,
    ObservabilitySpanOut,
    ObservabilitySummaryOut,
    ObservabilityTrendOut,
    ObservabilityUsageOut,
)


def _usage(
    input_tokens: int | None,
    output_tokens: int | None,
    total_tokens: int | None,
    source: str,
) -> ObservabilityUsageOut:
    return ObservabilityUsageOut(
        input=input_tokens,
        output=output_tokens,
        total=total_tokens,
        source="provider" if source == "provider" else "unavailable",
    )


def _scope(model: type[ObservabilitySpan] | type[ModelCall], entity_id: str):
    return or_(model.run_id == entity_id, model.build_id == entity_id)


def _root_span(db: Session, entity_id: str) -> ObservabilitySpan | None:
    return db.scalar(
        select(ObservabilitySpan)
        .where(_scope(ObservabilitySpan, entity_id), ObservabilitySpan.parent_span_id.is_(None))
        .order_by(ObservabilitySpan.sequence)
        .limit(1)
    )


def run_out(db: Session, run: QueryRun) -> ObservabilityRunOut:
    assistant = db.get(Assistant, run.assistant_id)
    model = db.get(ModelConfig, run.llm_model_id)
    provider = db.get(Provider, model.provider_id) if model else None
    root = _root_span(db, run.id)
    knowledge_names = list(
        db.scalars(
            select(KnowledgeBase.name)
            .join(RunKnowledgeBase, RunKnowledgeBase.kb_id == KnowledgeBase.id)
            .where(RunKnowledgeBase.run_id == run.id)
            .order_by(KnowledgeBase.name)
        )
    )
    return ObservabilityRunOut(
        id=run.id,
        trace_id=root.trace_id if root else run.id,
        kind="chat",
        name=run.query[:80],
        target=assistant.name if assistant else "已删除的问答应用",
        secondary_target=" · ".join(knowledge_names) or "未关联知识库",
        status=run.status,
        started_at=run.created_at,
        duration_ms=run.total_ms if run.total_ms is not None else (root.duration_ms or 0 if root else 0),
        progress=0 if run.status == "queued" else 50 if run.status == "running" else 100,
        provider=provider.name if provider else "未知服务商",
        model=model.remote_model_id if model else "未知模型",
        usage=_usage(run.input_tokens, run.output_tokens, run.total_tokens, run.usage_source),
        error_code=run.error_code,
        query=run.query,
        answer=run.answer,
    )


def build_run_out(db: Session, version: IndexVersion) -> ObservabilityRunOut:
    knowledge_base = db.get(KnowledgeBase, version.kb_id)
    model = db.get(ModelConfig, version.embedding_model_id)
    provider = db.get(Provider, model.provider_id) if model else None
    root = _root_span(db, version.id)
    status = {
        "queued": "queued",
        "building": "running",
        "active": "succeeded",
        "ready": "succeeded",
        "failed": "failed",
    }.get(version.status, "failed")
    knowledge_name = knowledge_base.name if knowledge_base else "已删除的知识库"
    return ObservabilityRunOut(
        id=version.id,
        trace_id=root.trace_id if root else version.id,
        kind="build",
        name=f"索引构建 · {knowledge_name}",
        target=knowledge_name,
        secondary_target=f"{version.id} · {version.embedded_chunks}／{version.total_chunks} 个分块",
        status=status,
        started_at=version.started_at or version.created_at,
        duration_ms=(
            version.duration_ms
            if version.duration_ms is not None
            else (root.duration_ms or 0 if root else 0)
        ),
        progress=version.progress,
        provider=provider.name if provider else "未知服务商",
        model=model.remote_model_id if model else "未知模型",
        usage=_usage(version.input_tokens, None, version.input_tokens, version.usage_source),
        error_code=version.error_code,
        query="",
        answer="",
    )


def span_out(db: Session, span: ObservabilitySpan, call: ModelCall | None = None) -> ObservabilitySpanOut:
    if call is None:
        call = db.scalar(select(ModelCall).where(ModelCall.span_id == span.id))
    model = db.get(ModelConfig, call.model_config_id) if call else None
    provider = db.get(Provider, call.provider_id) if call else None
    metadata = dict(span.attributes_json or {})
    if call:
        metadata["capability"] = call.capability
        if call.first_token_ms is not None:
            metadata["first_token_ms"] = call.first_token_ms
        if call.provider_request_id:
            metadata["provider_request_id"] = call.provider_request_id
    snapshot = db.scalar(select(ContextSnapshot).where(ContextSnapshot.span_id == span.id))
    entity_id = span.run_id or span.build_id
    assert entity_id is not None
    return ObservabilitySpanOut(
        id=span.id,
        run_id=entity_id,
        parent_id=span.parent_span_id,
        kind=span.kind,
        name=span.name,
        status=span.status,
        offset_ms=span.offset_ms,
        duration_ms=span.duration_ms or 0,
        summary=span.summary,
        input=span.input_text,
        output=span.output_text,
        provider=provider.name if provider else None,
        model=model.remote_model_id if model else None,
        usage=(
            _usage(call.input_tokens, call.output_tokens, call.total_tokens, call.usage_source) if call else None
        ),
        attempt=call.attempt if call else 1,
        error_code=span.error_code,
        metadata=metadata,
        context_snapshot=(
            ObservabilityContextSnapshotOut(
                id=snapshot.id,
                messages=[ObservabilityContextMessageOut(**message) for message in snapshot.messages_json],
                metadata=snapshot.metadata_json,
                created_at=snapshot.created_at,
            )
            if snapshot
            else None
        ),
    )


def list_runs(
    db: Session,
    *,
    kind: str = "all",
    status: str | None = None,
    provider: str | None = None,
    search: str | None = None,
    limit: int = 100,
) -> list[ObservabilityRunOut]:
    output: list[ObservabilityRunOut] = []
    keyword = f"%{search.strip()}%" if search and search.strip() else None
    if kind != "build":
        statement = (
            select(QueryRun)
            .join(Assistant, Assistant.id == QueryRun.assistant_id)
            .join(ModelConfig, ModelConfig.id == QueryRun.llm_model_id)
            .join(Provider, Provider.id == ModelConfig.provider_id)
        )
        if status and status != "all":
            statement = statement.where(QueryRun.status == status)
        if provider and provider != "all":
            statement = statement.where(or_(Provider.name == provider, Provider.kind == provider))
        if keyword:
            knowledge_run = (
                select(RunKnowledgeBase.run_id)
                .join(KnowledgeBase, KnowledgeBase.id == RunKnowledgeBase.kb_id)
                .where(KnowledgeBase.name.like(keyword))
            )
            statement = statement.where(
                or_(
                    QueryRun.id.like(keyword),
                    QueryRun.query.like(keyword),
                    QueryRun.answer.like(keyword),
                    Assistant.name.like(keyword),
                    QueryRun.id.in_(knowledge_run),
                )
            )
        rows = list(db.scalars(statement.order_by(QueryRun.created_at.desc()).limit(limit)))
        output.extend(run_out(db, run) for run in rows)
    if kind != "chat":
        statement = (
            select(IndexVersion)
            .join(KnowledgeBase, KnowledgeBase.id == IndexVersion.kb_id)
            .join(ModelConfig, ModelConfig.id == IndexVersion.embedding_model_id)
            .join(Provider, Provider.id == ModelConfig.provider_id)
        )
        status_mapping = {
            "queued": ["queued"],
            "running": ["building"],
            "succeeded": ["active", "ready"],
            "failed": ["failed"],
            "stopped": [],
            "timed_out": [],
        }
        if status and status != "all":
            mapped = status_mapping.get(status, [status])
            statement = statement.where(IndexVersion.status.in_(mapped)) if mapped else statement.where(False)
        if provider and provider != "all":
            statement = statement.where(or_(Provider.name == provider, Provider.kind == provider))
        if keyword:
            statement = statement.where(or_(IndexVersion.id.like(keyword), KnowledgeBase.name.like(keyword)))
        rows = list(db.scalars(statement.order_by(IndexVersion.created_at.desc()).limit(limit)))
        output.extend(build_run_out(db, version) for version in rows)
    return sorted(output, key=lambda run: run.started_at, reverse=True)[:limit]


def get_run_detail(db: Session, run_id: str) -> ObservabilityRunDetailOut:
    chat_run = db.get(QueryRun, run_id)
    build_run = db.get(IndexVersion, run_id) if not chat_run else None
    if not chat_run and not build_run:
        raise ApiError(404, "OBSERVABILITY_RUN_NOT_FOUND", "运行记录不存在")
    spans = list(
        db.scalars(
            select(ObservabilitySpan).where(_scope(ObservabilitySpan, run_id)).order_by(ObservabilitySpan.sequence)
        )
    )
    calls = {
        call.span_id: call
        for call in db.scalars(select(ModelCall).where(_scope(ModelCall, run_id)))
    }
    return ObservabilityRunDetailOut(
        run=run_out(db, chat_run) if chat_run else build_run_out(db, build_run),
        spans=[span_out(db, span, calls.get(span.id)) for span in spans],
    )


def list_errors(db: Session, *, limit: int = 200) -> list[ObservabilityErrorOut]:
    events = list(db.scalars(select(ErrorEvent).order_by(ErrorEvent.created_at.desc()).limit(limit)))
    return [
        ObservabilityErrorOut(
            id=event.id,
            run_id=event.run_id or event.build_id,
            span_id=event.span_id,
            category=event.category,
            severity=event.severity,
            code=event.code,
            message=event.safe_message,
            fingerprint=event.fingerprint,
            count=1,
            first_occurred_at=event.created_at,
            last_occurred_at=event.created_at,
            retryable=event.retryable,
        )
        for event in events
    ]


def get_summary(db: Session) -> ObservabilitySummaryOut:
    runs = [run_out(db, run) for run in db.scalars(select(QueryRun))]
    runs.extend(build_run_out(db, version) for version in db.scalars(select(IndexVersion)))
    runs.sort(key=lambda run: run.started_at, reverse=True)
    finished = [run for run in runs if run.status not in {"queued", "running"}]
    succeeded = sum(run.status == "succeeded" for run in finished)
    status_counts = dict(Counter(run.status for run in runs))

    today = datetime.now(UTC).date()
    first_day = today - timedelta(days=6)
    recent = [run for run in runs if run.started_at.date() >= first_day]
    by_day: dict[str, list[ObservabilityRunOut]] = {}
    for run in recent:
        by_day.setdefault(run.started_at.date().isoformat(), []).append(run)
    trend = []
    for offset in range(7):
        day = first_day + timedelta(days=offset)
        day_runs = by_day.get(day.isoformat(), [])
        trend.append(
            ObservabilityTrendOut(
                day=day.strftime("%m/%d"),
                runs=len(day_runs),
                failed=sum(run.status == "failed" for run in day_runs),
                tokens=sum(run.usage.total or 0 for run in day_runs),
            )
        )

    slow_rows = list(
        db.scalars(
            select(ObservabilitySpan)
            .join(ModelCall, ModelCall.span_id == ObservabilitySpan.id)
            .where(ModelCall.duration_ms.is_not(None))
            .order_by(ModelCall.duration_ms.desc(), ObservabilitySpan.started_at.desc())
            .limit(5)
        )
    )
    return ObservabilitySummaryOut(
        run_count=len(runs),
        success_rate=round(succeeded / len(finished) * 100, 1) if finished else 0,
        total_tokens=sum(run.usage.total or 0 for run in runs),
        unknown_usage_count=sum(run.usage.source != "provider" for run in runs),
        status_counts=status_counts,
        trend=trend,
        slow_spans=[span_out(db, span) for span in slow_rows],
    )
