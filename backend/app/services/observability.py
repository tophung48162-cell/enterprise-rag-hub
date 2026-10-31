import hashlib
import json
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db_models import (
    ContextSnapshot,
    ErrorEvent,
    IndexVersion,
    ModelCall,
    ModelConfig,
    ObservabilitySpan,
    Provider,
    QueryRun,
    utc_now,
)
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
    """Persist real chat or index-build spans without capturing provider secrets."""

    def __init__(self, db: Session, run_id: str | None = None, *, build_id: str | None = None) -> None:
        if bool(run_id) == bool(build_id):
            raise ValueError("A trace requires exactly one chat run or index build")
        self.db = db
        self.run_id = run_id
        self.build_id = build_id
        self.entity_id = run_id or build_id
        self.kind = "chat" if run_id else "build"
        self.root = db.scalar(
            select(ObservabilitySpan)
            .where(self._scope(ObservabilitySpan), ObservabilitySpan.parent_span_id.is_(None))
            .order_by(ObservabilitySpan.sequence)
        )
        if not self.root:
            raise ValueError("Trace root is missing")
        self.trace_id = self.root.trace_id
        self.sequence = max(
            [row.sequence for row in db.scalars(select(ObservabilitySpan).where(self._scope(ObservabilitySpan)))]
            or [0]
        )
        self.started = time.perf_counter()

    def _scope(self, model: type[ObservabilitySpan] | type[ModelCall] | type[ErrorEvent]):
        return model.run_id == self.run_id if self.run_id else model.build_id == self.build_id

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
        attempt: int = 1,
    ) -> SpanHandle:
        self.sequence += 1
        span = ObservabilitySpan(
            run_id=self.run_id,
            build_id=self.build_id,
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
                build_id=self.build_id,
                provider_id=provider.id,
                model_config_id=model.id,
                capability=model.capability,
                attempt=attempt,
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
                build_id=self.build_id,
                span_id=span_id,
                category=category,
                severity=severity,
                code=code,
                safe_message=_bounded(message, 1000),
                fingerprint=f"{self.kind}/{code.lower()}",
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
                .where(self._scope(ObservabilitySpan), ObservabilitySpan.status.in_(["running", "queued"]))
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
                build_id=self.build_id,
                span_id=spans[0].id if spans else self.root.id,
                category=category,
                severity=severity,
                code=code,
                safe_message=_bounded(message, 1000),
                fingerprint=f"{self.kind}/{code.lower()}",
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
        attributes_json={"assistant_id": assistant_id, "assistant_name": name, "capture_policy": "full_context"},
    )
    db.add(root)
    return root


def create_build_trace_root(db: Session, version: IndexVersion, *, knowledge_name: str) -> ObservabilitySpan:
    from app.db_models import uuid_str

    root_id = uuid_str()
    root = ObservabilitySpan(
        id=root_id,
        build_id=version.id,
        trace_id=root_id,
        parent_span_id=None,
        kind="stage",
        name="KnowledgeBuild Run",
        status="queued",
        sequence=0,
        started_at=utc_now(),
        summary="知识库版本化向量索引构建",
        input_text=f"{version.id} · {version.total_chunks} 个分块",
        attributes_json={
            "knowledge_base_id": version.kb_id,
            "knowledge_base": knowledge_name,
            "index_version_id": version.id,
            "total_chunks": version.total_chunks,
            "capture_policy": "summary_only",
        },
    )
    db.add(root)
    return root


def capture_context_snapshot(
    db: Session,
    *,
    run_id: str,
    span_id: str,
    messages: list[Any],
    metadata: dict[str, Any],
) -> ContextSnapshot:
    role_names = {"human": "user", "ai": "assistant", "system": "system"}
    serialized = [
        {
            "role": role_names.get(message.type, message.type),
            "content": (
                message.content
                if isinstance(message.content, str)
                else json.dumps(message.content, ensure_ascii=False)
            ),
        }
        for message in messages
    ]
    canonical = json.dumps(serialized, ensure_ascii=False, separators=(",", ":"))
    snapshot = ContextSnapshot(
        run_id=run_id,
        span_id=span_id,
        messages_json=serialized,
        metadata_json={
            **metadata,
            "message_count": len(serialized),
            "context_hash": f"sha256:{hashlib.sha256(canonical.encode('utf-8')).hexdigest()}",
            "full_snapshot_captured": True,
        },
    )
    db.add(snapshot)
    db.flush()
    return snapshot
