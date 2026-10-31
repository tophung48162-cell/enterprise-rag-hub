import time
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db_models import ErrorEvent, ModelCall, ModelConfig, ObservabilitySpan, Provider, QueryRun, utc_now
from app.errors import ApiError
from app.providers.gateway import EmbeddingResult


def _bounded(value: str, limit: int = 4000) -> str:
    return value[:limit]


def _duration_from(started_at: datetime, ended_at: datetime) -> int:
    if started_at.tzinfo is None:
        started_at = started_at.replace(tzinfo=UTC)
    return max(0, round((ended_at - started_at).total_seconds() * 1000))


def safe_error(exc: Exception, fallback_code: str, fallback_message: str) -> tuple[str, str, bool]:
    if isinstance(exc, ApiError):
        return exc.code, exc.message, exc.retryable
    return fallback_code, fallback_message, False


@dataclass
class SpanHandle:
    span: ObservabilitySpan
    model_call: ModelCall | None
    started: float


class TraceRecorder:
    """Persists concise trace metadata without capturing secrets or full prompts."""

    def __init__(self, db: Session, run_id: str) -> None:
        self.db = db
        self.run_id = run_id
        self.root = db.scalar(
            select(ObservabilitySpan)
            .where(ObservabilitySpan.run_id == run_id, ObservabilitySpan.parent_span_id.is_(None))
            .order_by(ObservabilitySpan.sequence)
        )
        if not self.root:
            raise ValueError("Trace root is missing")
        self.trace_id = self.root.trace_id
        self.sequence = max(
            [row.sequence for row in db.scalars(select(ObservabilitySpan).where(ObservabilitySpan.run_id == run_id))]
            or [0]
        )
        self.started = time.perf_counter()

    def start(
        self,
        name: str,
        *,
        kind: str = "stage",
        parent_id: str | None = None,
        summary: str = "",
        input_text: str = "",
        attributes: dict[str, Any] | None = None,
        provider: Provider | None = None,
        model: ModelConfig | None = None,
    ) -> SpanHandle:
        self.sequence += 1
        span = ObservabilitySpan(
            run_id=self.run_id,
            trace_id=self.trace_id,
            parent_span_id=parent_id or self.root.id,
            kind=kind,
            name=name,
            status="running",
            sequence=self.sequence,
            started_at=utc_now(),
            offset_ms=max(0, round((time.perf_counter() - self.started) * 1000)),
            summary=_bounded(summary, 1000),
            input_text=_bounded(input_text),
            attributes_json=attributes or {},
        )
        self.db.add(span)
        self.db.flush()
        model_call = None
        if provider is not None or model is not None:
            if provider is None or model is None:
                raise ValueError("Model calls require both provider and model")
            model_call = ModelCall(
                span_id=span.id,
                run_id=self.run_id,
                provider_id=provider.id,
                model_config_id=model.id,
                capability=model.capability,
            )
            self.db.add(model_call)
        self.db.commit()
        return SpanHandle(span=span, model_call=model_call, started=time.perf_counter())

    def finish(
        self,
        handle: SpanHandle,
        status: str,
        *,
        output: str = "",
        attributes: dict[str, Any] | None = None,
        error_code: str | None = None,
        embedding: EmbeddingResult | None = None,
        input_tokens: int | None = None,
        output_tokens: int | None = None,
        total_tokens: int | None = None,
        first_token_ms: int | None = None,
    ) -> None:
        span = handle.span
        span.status = status
        span.ended_at = utc_now()
        span.duration_ms = max(0, round((time.perf_counter() - handle.started) * 1000))
        span.output_text = _bounded(output)
        span.error_code = error_code
        if attributes:
            span.attributes_json = {**(span.attributes_json or {}), **attributes}
        call = handle.model_call
        if call:
            call.status = status
            call.duration_ms = span.duration_ms
            call.error_code = error_code
            call.first_token_ms = first_token_ms
            if embedding is not None:
                call.input_tokens = embedding.input_tokens
                call.total_tokens = embedding.input_tokens
                call.usage_source = embedding.usage_source
            else:
                call.input_tokens = input_tokens
                call.output_tokens = output_tokens
                call.total_tokens = total_tokens
                call.usage_source = (
                    "provider"
                    if any(value is not None for value in (input_tokens, output_tokens, total_tokens))
                    else "unavailable"
                )
        self.db.commit()

    def finish_root(self, status: str, *, output: str, duration_ms: int, error_code: str | None = None) -> None:
        self.root.status = status
        self.root.ended_at = utc_now()
        self.root.duration_ms = duration_ms
        self.root.output_text = _bounded(output)
        self.root.error_code = error_code
        self.db.commit()

    def record_event(
        self,
        *,
        code: str,
        message: str,
        category: str,
        severity: str,
        retryable: bool,
        span_id: str | None,
    ) -> None:
        self.db.add(
            ErrorEvent(
                run_id=self.run_id,
                span_id=span_id,
                category=category,
                severity=severity,
                code=code,
                safe_message=_bounded(message, 1000),
                fingerprint=f"chat/{code.lower()}",
                retryable=retryable,
            )
        )
        self.db.commit()

    def close_open(
        self,
        status: str,
        *,
        code: str,
        message: str,
        category: str,
        severity: str,
        retryable: bool,
        input_tokens: int | None = None,
        output_tokens: int | None = None,
        total_tokens: int | None = None,
        first_token_ms: int | None = None,
    ) -> None:
        now = utc_now()
        spans = list(
            self.db.scalars(
                select(ObservabilitySpan)
                .where(ObservabilitySpan.run_id == self.run_id, ObservabilitySpan.status == "running")
                .order_by(ObservabilitySpan.sequence.desc())
            )
        )
        span_ids = [span.id for span in spans]
        for span in spans:
            span.status = status
            span.ended_at = now
            span.duration_ms = _duration_from(span.started_at, now)
            span.output_text = _bounded(message)
            span.error_code = code
        if span_ids:
            calls = list(self.db.scalars(select(ModelCall).where(ModelCall.span_id.in_(span_ids))))
            for call in calls:
                if call.status != "running":
                    continue
                call.status = status
                call.duration_ms = next(
                    (span.duration_ms for span in spans if span.id == call.span_id), None
                )
                call.error_code = code
                call.input_tokens = input_tokens
                call.output_tokens = output_tokens
                call.total_tokens = total_tokens
                call.first_token_ms = first_token_ms
                call.usage_source = (
                    "provider"
                    if any(value is not None for value in (input_tokens, output_tokens, total_tokens))
                    else "unavailable"
                )
        self.db.add(
            ErrorEvent(
                run_id=self.run_id,
                span_id=spans[0].id if spans else self.root.id,
                category=category,
                severity=severity,
                code=code,
                safe_message=_bounded(message, 1000),
                fingerprint=f"chat/{code.lower()}",
                retryable=retryable,
            )
        )
        self.db.commit()


def create_trace_root(db: Session, run: QueryRun, *, name: str, assistant_id: str) -> ObservabilitySpan:
    from app.db_models import uuid_str

    root_id = uuid_str()
    root = ObservabilitySpan(
        id=root_id,
        run_id=run.id,
        trace_id=root_id,
        parent_span_id=None,
        kind="stage",
        name="Chat Run",
        status="running",
        sequence=0,
        started_at=utc_now(),
        summary="端到端检索增强问答",
        input_text=_bounded(run.query),
        attributes_json={"assistant_id": assistant_id, "assistant_name": name, "capture_policy": "summary_only"},
    )
    db.add(root)
    return root
