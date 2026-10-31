import json

from sqlalchemy import delete, select

from app.api.v1.deps import get_gateway
from app.db_models import ErrorEvent, ModelCall, ObservabilitySpan
from app.main import app
from app.providers.gateway import ChatStreamChunk
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


def test_successful_chat_exposes_real_trace_tree_and_usage(client, conversation):  # noqa: F811
    gateway = ChatGateway()
    app.dependency_overrides[get_gateway] = lambda: gateway
    response = send(client, conversation)
    assert response.status_code == 200
    meta = sse_events(response)[0][1]

    listed = client.get("/api/v1/observability/runs")
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
    assert client.get("/api/v1/observability/runs", params={"kind": "build"}).json() == []
    assert client.get("/api/v1/observability/runs", params={"search": "报销"}).json()[0]["id"] == run["id"]
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
    context = next(span for span in spans if span["name"] == "BuildContext")
    assert context["metadata"]["full_snapshot_captured"] is False

    summary = client.get("/api/v1/observability/summary").json()
    assert summary["run_count"] == 1
    assert summary["success_rate"] == 100
    assert summary["total_tokens"] == 24
    assert summary["unknown_usage_count"] == 0
    assert summary["status_counts"] == {"succeeded": 1}
    assert len(summary["trend"]) == 7
    assert sum(day["runs"] for day in summary["trend"]) == 1
    assert any(span["id"] == llm["id"] for span in summary["slow_spans"])
    assert client.get("/api/v1/observability/errors").json() == []


def test_missing_usage_is_visible_without_failing_run(client, conversation):  # noqa: F811
    gateway = ChatGateway(chunks=[ChatStreamChunk(text="依据不足，请补充资料。")])
    app.dependency_overrides[get_gateway] = lambda: gateway
    assert send(client, conversation).status_code == 200

    run = client.get("/api/v1/observability/runs").json()[0]
    assert run["status"] == "succeeded"
    assert run["usage"] == {"input": None, "output": None, "total": None, "source": "unavailable"}
    detail = client.get(f"/api/v1/observability/runs/{run['id']}").json()
    llm = next(span for span in detail["spans"] if span["name"] == "LLM · stream_chat")
    assert llm["usage"]["total"] is None

    errors = client.get("/api/v1/observability/errors").json()
    assert len(errors) == 1
    assert errors[0]["code"] == "USAGE_UNAVAILABLE"
    assert errors[0]["severity"] == "warning"
    assert errors[0]["count"] == 1
    assert errors[0]["span_id"] == llm["id"]
    summary = client.get("/api/v1/observability/summary").json()
    assert summary["run_count"] == 1
    assert summary["success_rate"] == 100
    assert summary["total_tokens"] == 0
    assert summary["unknown_usage_count"] == 1


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
    error = payloads[2].json()[0]
    assert error["code"] == "CHAT_GENERATION_FAILED"
    assert error["severity"] == "error"
    assert error["message"] == "问答生成失败，请稍后重试"
    assert db_session.scalars(select(ModelCall).where(ModelCall.status == "running")).first() is None
    assert db_session.scalars(select(ObservabilitySpan).where(ObservabilitySpan.status == "running")).first() is None
    assert db_session.scalars(select(ErrorEvent)).one().safe_message == "问答生成失败，请稍后重试"


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
