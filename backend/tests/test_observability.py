import json
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import delete, select

from app.api.v1.deps import get_gateway
from app.db_models import ErrorEvent, ModelCall, ObservabilitySpan
from app.errors import ApiError
from app.main import app
from app.providers.gateway import ChatStreamChunk
from app.services.indexing import process_index_version
from tests.test_chat import (  # noqa: F401
    ChatGateway,
    active_knowledge,
    assistant,
    conversation,
    embedding_model,
    knowledge_base,
    llm_model,
    send,
    sse_events,
)
from tests.test_indexing import FakeGateway, create_version, prepare_chunks


def test_successful_chat_exposes_real_trace_tree_and_usage(client, conversation):  # noqa: F811
    gateway = ChatGateway()
    app.dependency_overrides[get_gateway] = lambda: gateway
    response = send(client, conversation)
    assert response.status_code == 200
    meta = sse_events(response)[0][1]

    listed = client.get("/api/v1/observability/runs", params={"kind": "chat"})
    assert listed.status_code == 200, listed.text
    assert len(listed.json()) == 1
    run = listed.json()[0]
    assert run["id"] == meta["run_id"]
    assert run["trace_id"] == meta["trace_id"]
    assert run["kind"] == "chat"
    assert run["status"] == "succeeded"
    assert run["usage"] == {"input": 18, "output": 6, "total": 24, "source": "provider"}
    assert run["estimated_cost"] is None
    assert run["cost_coverage"] == 0
    build_runs = client.get("/api/v1/observability/runs", params={"kind": "build"}).json()
    assert len(build_runs) == 1
    search_runs = client.get("/api/v1/observability/runs", params={"search": "报销"}).json()
    assert search_runs[0]["id"] == run["id"]
    assert client.get("/api/v1/observability/runs", params={"status": "failed"}).json() == []

    detail_response = client.get(f"/api/v1/observability/runs/{run['id']}")
    assert detail_response.status_code == 200, detail_response.text
    detail = detail_response.json()
    spans = detail["spans"]
    names = {span["name"] for span in spans}
    assert {
        "Chat Run",
        "LoadConfig",
        "Retrieval · 问答验收知识库",
        "QueryEmbedding",
        "VectorSearch",
        "MergeAndRank",
        "BuildContext",
        "LLM · stream_chat",
        "PersistResult",
    }.issubset(names)
    span_ids = {span["id"] for span in spans}
    assert all(span["parent_id"] is None or span["parent_id"] in span_ids for span in spans)
    root = next(span for span in spans if span["parent_id"] is None)
    assert root["id"] == meta["trace_id"]
    llm = next(span for span in spans if span["name"] == "LLM · stream_chat")
    assert llm["usage"] == {"input": 18, "output": 6, "total": 24, "source": "provider"}
    assert llm["provider"] == "通义测试"
    assert llm["model"] == "qwen-plus"
    assert llm["metadata"]["full_input_captured"] is True
    context = next(span for span in spans if span["name"] == "BuildContext")
    assert context["metadata"]["full_snapshot_captured"] is True
    snapshot = context["context_snapshot"]
    assert snapshot["metadata"]["context_hash"].startswith("sha256:")
    assert [message["role"] for message in snapshot["messages"]] == ["system", "user"]
    assert "企业制度助手" in snapshot["messages"][0]["content"]
    assert "报销需要哪些材料" in snapshot["messages"][1]["content"]
    assert [message.content for message in gateway.chat_calls[0]] == [
        message["content"] for message in snapshot["messages"]
    ]

    summary = client.get("/api/v1/observability/summary").json()
    assert summary["run_count"] == 2
    assert summary["success_rate"] == 100
    assert summary["total_tokens"] == 24
    assert summary["unknown_usage_count"] == 1
    assert summary["status_counts"] == {"succeeded": 2}
    assert len(summary["trend"]) == 7
    assert sum(day["runs"] for day in summary["trend"]) == 2
    assert any(span["id"] == llm["id"] for span in summary["slow_spans"])
    errors = client.get("/api/v1/observability/errors").json()
    assert [event for event in errors if event["run_id"] == run["id"]] == []


def test_missing_usage_is_visible_without_failing_run(client, conversation):  # noqa: F811
    gateway = ChatGateway(chunks=[ChatStreamChunk(text="依据不足，请补充资料。")])
    app.dependency_overrides[get_gateway] = lambda: gateway
    assert send(client, conversation).status_code == 200

    run = client.get("/api/v1/observability/runs", params={"kind": "chat"}).json()[0]
    assert run["status"] == "succeeded"
    assert run["usage"] == {"input": None, "output": None, "total": None, "source": "unavailable"}
    detail = client.get(f"/api/v1/observability/runs/{run['id']}").json()
    llm = next(span for span in detail["spans"] if span["name"] == "LLM · stream_chat")
    assert llm["usage"]["total"] is None

    errors = client.get("/api/v1/observability/errors").json()
    run_errors = [event for event in errors if event["run_id"] == run["id"]]
    assert len(run_errors) == 1
    assert run_errors[0]["code"] == "USAGE_UNAVAILABLE"
    assert run_errors[0]["severity"] == "warning"
    assert run_errors[0]["count"] == 1
    assert run_errors[0]["span_id"] == llm["id"]
    summary = client.get("/api/v1/observability/summary").json()
    assert summary["run_count"] == 2
    assert summary["success_rate"] == 100
    assert summary["total_tokens"] == 0
    assert summary["unknown_usage_count"] == 2


def test_failed_trace_closes_spans_and_never_exposes_provider_secret(client, conversation, db_session):  # noqa: F811
    gateway = ChatGateway(error=RuntimeError("sk-live-secret upstream stack trace"))
    app.dependency_overrides[get_gateway] = lambda: gateway
    response = send(client, conversation)
    run_id = sse_events(response)[0][1]["run_id"]

    payloads = [
        client.get("/api/v1/observability/runs"),
        client.get(f"/api/v1/observability/runs/{run_id}"),
        client.get("/api/v1/observability/errors"),
        client.get("/api/v1/observability/summary"),
    ]
    assert all(item.status_code == 200 for item in payloads)
    serialized = json.dumps([item.json() for item in payloads], ensure_ascii=False)
    assert "sk-live-secret" not in serialized
    assert "stack trace" not in serialized
    detail = payloads[1].json()
    assert detail["run"]["status"] == "failed"
    assert detail["run"]["error_code"] == "CHAT_GENERATION_FAILED"
    assert all(span["status"] != "running" for span in detail["spans"])
    error = next(event for event in payloads[2].json() if event["run_id"] == run_id)
    assert error["code"] == "CHAT_GENERATION_FAILED"
    assert error["severity"] == "error"
    assert error["message"] == "问答生成失败，请稍后重试"
    assert db_session.scalars(select(ModelCall).where(ModelCall.status == "running")).first() is None
    assert db_session.scalars(select(ObservabilitySpan).where(ObservabilitySpan.status == "running")).first() is None
    event = db_session.scalars(select(ErrorEvent).where(ErrorEvent.run_id == run_id)).one()
    assert event.safe_message == "问答生成失败，请稍后重试"


def test_legacy_run_remains_listed_without_fabricated_spans(client, conversation, db_session):  # noqa: F811
    app.dependency_overrides[get_gateway] = lambda: ChatGateway()
    assert send(client, conversation).status_code == 200
    run_id = client.get("/api/v1/query-runs").json()[0]["id"]
    db_session.execute(delete(ModelCall).where(ModelCall.run_id == run_id))
    db_session.execute(delete(ErrorEvent).where(ErrorEvent.run_id == run_id))
    db_session.execute(delete(ObservabilitySpan).where(ObservabilitySpan.run_id == run_id))
    db_session.commit()

    run = client.get("/api/v1/observability/runs").json()[0]
    assert run["trace_id"] == run_id
    detail = client.get(f"/api/v1/observability/runs/{run_id}")
    assert detail.status_code == 200
    assert detail.json()["spans"] == []
    assert client.get("/api/v1/observability/runs/missing").status_code == 404


@pytest.mark.asyncio
async def test_successful_index_build_exposes_real_trace(client, knowledge_base, db_session):  # noqa: F811
    _, chunks = prepare_chunks(client, knowledge_base)
    queued = create_version(client, knowledge_base)
    version = await process_index_version(db_session, FakeGateway(), queued["id"])
    assert version.status == "active"

    listed = client.get("/api/v1/observability/runs", params={"kind": "build"})
    assert listed.status_code == 200, listed.text
    assert len(listed.json()) == 1
    run = listed.json()[0]
    assert run["id"] == queued["id"]
    assert run["kind"] == "build"
    assert run["status"] == "succeeded"
    assert run["progress"] == 100
    assert run["usage"] == {"input": None, "output": None, "total": None, "source": "unavailable"}

    detail = client.get(f"/api/v1/observability/runs/{run['id']}").json()
    spans = detail["spans"]
    assert {
        "KnowledgeBuild Run",
        "ValidateSource",
        "Embedding Stage",
        "Embedding · batch 1",
        "VectorWrite · batch 1",
        "ValidateIndex",
        "ActivateIndex",
    }.issubset({span["name"] for span in spans})
    assert all(span["run_id"] == run["id"] for span in spans)
    root = next(span for span in spans if span["parent_id"] is None)
    assert root["id"] == run["trace_id"]
    assert root["metadata"]["total_chunks"] == len(chunks)
    batch = next(span for span in spans if span["name"] == "Embedding · batch 1")
    assert batch["kind"] == "model"
    assert batch["provider"] == "通义测试"
    assert batch["model"] == "text-embedding-v4"
    assert batch["usage"]["source"] == "unavailable"
    assert batch["attempt"] == 1
    assert all(span["context_snapshot"] is None for span in spans)

    errors = client.get("/api/v1/observability/errors").json()
    assert len(errors) == 1
    assert errors[0]["run_id"] == run["id"]
    assert errors[0]["code"] == "USAGE_UNAVAILABLE"
    summary = client.get("/api/v1/observability/summary").json()
    assert summary["run_count"] == 1
    assert summary["success_rate"] == 100
    assert summary["unknown_usage_count"] == 1
    assert summary["status_counts"] == {"succeeded": 1}


@pytest.mark.asyncio
async def test_failed_build_closes_trace_and_retry_appends_attempt(client, knowledge_base, db_session):  # noqa: F811
    prepare_chunks(client, knowledge_base)
    queued = create_version(client, knowledge_base)

    with pytest.raises(ApiError) as caught:
        await process_index_version(db_session, FakeGateway(dimensions=3), queued["id"])
    assert caught.value.code == "EMBEDDING_DIMENSION_MISMATCH"
    failed = client.get(f"/api/v1/observability/runs/{queued['id']}").json()
    assert failed["run"]["status"] == "failed"
    assert all(span["status"] not in {"queued", "running"} for span in failed["spans"])
    errors = client.get("/api/v1/observability/errors").json()
    assert any(event["code"] == "EMBEDDING_DIMENSION_MISMATCH" for event in errors)

    version = await process_index_version(db_session, FakeGateway(), queued["id"])
    assert version.status == "active"
    succeeded = client.get(f"/api/v1/observability/runs/{queued['id']}").json()
    assert succeeded["run"]["status"] == "succeeded"
    attempts = [span for span in succeeded["spans"] if span["name"] == "Embedding · batch 1"]
    assert [span["attempt"] for span in attempts] == [1, 2]
    assert [span["status"] for span in attempts] == ["failed", "succeeded"]
    assert succeeded["run"]["trace_id"] == failed["run"]["trace_id"]


def test_error_groups_aggregate_chat_and_build_events(client, conversation, knowledge_base, db_session):  # noqa: F811,E501
    app.dependency_overrides[get_gateway] = lambda: ChatGateway()
    chat_response = send(client, conversation)
    chat_run_id = sse_events(chat_response)[0][1]["run_id"]
    queued = client.get(f"/api/v1/knowledge-bases/{knowledge_base['id']}/index-versions").json()[0]
    db_session.execute(delete(ErrorEvent))
    db_session.commit()

    started = datetime(2026, 10, 31, 12, 0, tzinfo=UTC)
    shared = "shared/provider_timeout"
    db_session.add_all([
        ErrorEvent(
            run_id=chat_run_id,
            category="模型调用",
            severity="warning",
            code="LLM_TIMEOUT",
            safe_message="首次问答超时",
            fingerprint=shared,
            retryable=True,
            created_at=started,
        ),
        ErrorEvent(
            run_id=chat_run_id,
            category="模型调用",
            severity="error",
            code="LLM_TIMEOUT",
            safe_message="第二次问答超时",
            fingerprint=shared,
            retryable=True,
            created_at=started + timedelta(minutes=1),
        ),
        ErrorEvent(
            build_id=queued["id"],
            category="模型调用",
            severity="critical",
            code="LLM_TIMEOUT",
            safe_message="最新构建超时",
            fingerprint=shared,
            retryable=False,
            created_at=started + timedelta(minutes=3),
        ),
        ErrorEvent(
            build_id=queued["id"],
            category="可观测自身",
            severity="warning",
            code="USAGE_UNAVAILABLE",
            safe_message="构建用量缺失",
            fingerprint="build/usage_unavailable",
            retryable=False,
            created_at=started + timedelta(minutes=2),
        ),
    ])
    db_session.commit()

    response = client.get("/api/v1/observability/errors/groups")
    assert response.status_code == 200, response.text
    groups = response.json()
    assert len(groups) == 2
    group = groups[0]
    assert group["fingerprint"] == shared
    assert group["count"] == 3
    assert group["affected_run_count"] == 2
    assert group["severity"] == "critical"
    assert group["message"] == "最新构建超时"
    assert group["run_id"] == queued["id"]
    assert group["retryable"] is False
    assert group["first_occurred_at"].startswith("2026-10-31T12:00:00")
    assert group["last_occurred_at"].startswith("2026-10-31T12:03:00")

    limited = client.get("/api/v1/observability/errors/groups", params={"limit": 1}).json()
    assert [item["fingerprint"] for item in limited] == [shared]
    raw_events = client.get("/api/v1/observability/errors").json()
    assert len(raw_events) == 4
    assert all(event["count"] == 1 for event in raw_events)
