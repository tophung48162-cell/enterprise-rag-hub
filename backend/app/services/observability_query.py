from datetime import UTC, datetime, time, timedelta

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.db_models import (
    Assistant,
    ErrorEvent,
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


def _root_span(db: Session, run_id: str) -> ObservabilitySpan | None:
    return db.scalar(
        select(ObservabilitySpan)
        .where(ObservabilitySpan.run_id == run_id, ObservabilitySpan.parent_span_id.is_(None))
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
    return ObservabilitySpanOut(
        id=span.id,
        run_id=span.run_id,
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
    if kind == "build":
        return []
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
    if search and search.strip():
        keyword = f"%{search.strip()}%"
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
    return [run_out(db, run) for run in rows]


def get_run_detail(db: Session, run_id: str) -> ObservabilityRunDetailOut:
    run = db.get(QueryRun, run_id)
    if not run:
        raise ApiError(404, "OBSERVABILITY_RUN_NOT_FOUND", "运行记录不存在")
    spans = list(
        db.scalars(
            select(ObservabilitySpan).where(ObservabilitySpan.run_id == run_id).order_by(ObservabilitySpan.sequence)
        )
    )
    calls = {
        call.span_id: call
        for call in db.scalars(select(ModelCall).where(ModelCall.run_id == run_id))
    }
    return ObservabilityRunDetailOut(
        run=run_out(db, run),
        spans=[span_out(db, span, calls.get(span.id)) for span in spans],
    )


def list_errors(db: Session, *, limit: int = 200) -> list[ObservabilityErrorOut]:
    events = list(db.scalars(select(ErrorEvent).order_by(ErrorEvent.created_at.desc()).limit(limit)))
    return [
        ObservabilityErrorOut(
            id=event.id,
            run_id=event.run_id,
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
    runs = list(db.scalars(select(QueryRun).order_by(QueryRun.created_at.desc())))
    finished = [run for run in runs if run.status not in {"queued", "running"}]
    succeeded = sum(run.status == "succeeded" for run in finished)
    status_counts = {
        status: count
        for status, count in db.execute(select(QueryRun.status, func.count(QueryRun.id)).group_by(QueryRun.status))
    }

    today = datetime.now(UTC).date()
    first_day = today - timedelta(days=6)
    recent = list(
        db.scalars(
            select(QueryRun).where(QueryRun.created_at >= datetime.combine(first_day, time.min, tzinfo=UTC))
        )
    )
    by_day: dict[str, list[QueryRun]] = {}
    for run in recent:
        by_day.setdefault(run.created_at.date().isoformat(), []).append(run)
    trend = []
    for offset in range(7):
        day = first_day + timedelta(days=offset)
        day_runs = by_day.get(day.isoformat(), [])
        trend.append(
            ObservabilityTrendOut(
                day=day.strftime("%m/%d"),
                runs=len(day_runs),
                failed=sum(run.status == "failed" for run in day_runs),
                tokens=sum(run.total_tokens or 0 for run in day_runs),
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
        total_tokens=sum(run.total_tokens or 0 for run in runs),
        unknown_usage_count=sum(run.usage_source != "provider" for run in runs),
        status_counts=status_counts,
        trend=trend,
        slow_spans=[span_out(db, span) for span in slow_rows],
    )
