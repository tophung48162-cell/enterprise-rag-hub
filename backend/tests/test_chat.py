import asyncio
import json

import pytest

from app.api.v1.deps import get_gateway
from app.errors import ApiError
from app.main import app
from app.providers.gateway import ChatStreamChunk
from app.services.indexing import process_index_version
from tests.test_indexing import create_version, prepare_chunks
from tests.test_retrieval import RetrievalGateway


class ChatGateway(RetrievalGateway):
    def __init__(self, chunks=None, error: Exception | None = None):
        super().__init__()
        self.chunks = chunks
        self.error = error
        self.chat_calls = []

    async def stream_chat(self, provider, model, api_key, messages):
        self.chat_calls.append(messages)
        if self.error:
            raise self.error
        chunks = self.chunks
        if chunks is None:
            chunks = [
                ChatStreamChunk(text="报销需要"),
                ChatStreamChunk(text="合规发票。", input_tokens=18, output_tokens=6, total_tokens=24),
            ]
        for chunk in chunks:
            yield chunk


@pytest.fixture
def llm_model(client, provider):
    response = client.post(
        "/api/v1/models",
        json={"provider_id": provider["id"], "remote_model_id": "qwen-plus", "capability": "LLM"},
    )
    assert response.status_code == 201
    return response.json()


@pytest.fixture
def embedding_model(client, provider):
    response = client.post(
        "/api/v1/models",
        json={
            "provider_id": provider["id"],
            "remote_model_id": "text-embedding-v4",
            "capability": "Embedding",
            "dimensions": 1024,
        },
    )
    assert response.status_code == 201
    return response.json()


@pytest.fixture
def knowledge_base(client, embedding_model):
    response = client.post(
        "/api/v1/knowledge-bases",
        json={
            "name": "问答验收知识库",
            "description": "真实检索增强问答",
            "department": "人力行政",
            "embedding_model_id": embedding_model["id"],
        },
    )
    assert response.status_code == 201
    return response.json()


@pytest.fixture
def active_knowledge(client, knowledge_base, db_session):
    prepare_chunks(client, knowledge_base)
    queued = create_version(client, knowledge_base)
    asyncio.run(process_index_version(db_session, RetrievalGateway(), queued["id"]))
    published = client.patch(f"/api/v1/knowledge-bases/{knowledge_base['id']}", json={"published": True})
    assert published.status_code == 200
    return published.json()


def assistant_payload(knowledge_base, llm_model, **overrides):
    payload = {
        "name": "员工问答助手",
        "description": "依据企业制度回答",
        "llm_model_id": llm_model["id"],
        "kb_ids": [knowledge_base["id"]],
        "system_prompt": "你是企业制度助手，仅根据资料作答。",
        "top_k": 3,
        "candidate_k": 20,
        "similarity_threshold": 0.1,
        "rerank_enabled": False,
        "published": True,
    }
    payload.update(overrides)
    return payload


@pytest.fixture
def assistant(client, active_knowledge, llm_model):
    response = client.post("/api/v1/assistants", json=assistant_payload(active_knowledge, llm_model))
    assert response.status_code == 201, response.text
    return response.json()


@pytest.fixture
def conversation(client, assistant):
    response = client.post(f"/api/v1/assistants/{assistant['id']}/conversations")
    assert response.status_code == 201
    return response.json()


def sse_events(response):
    events = []
    for block in response.text.strip().split("\n\n"):
        lines = block.splitlines()
        events.append((lines[0].removeprefix("event: "), json.loads(lines[1].removeprefix("data: "))))
    return events


def send(client, conversation, query="报销需要哪些材料？"):
    return client.post(
        f"/api/v1/conversations/{conversation['id']}/messages/stream",
        json={"query": query, "role_context": "user"},
    )


def test_assistant_validates_model_knowledge_and_publication(client, knowledge_base, llm_model, embedding_model):
    mismatch = client.post(
        "/api/v1/assistants",
        json=assistant_payload(knowledge_base, llm_model, llm_model_id=embedding_model["id"], published=False),
    )
    assert mismatch.status_code == 422
    assert mismatch.json()["error"]["code"] == "MODEL_CAPABILITY_MISMATCH"

    not_ready = client.post("/api/v1/assistants", json=assistant_payload(knowledge_base, llm_model))
    assert not_ready.status_code == 409
    assert not_ready.json()["error"]["code"] == "ASSISTANT_KB_NOT_PUBLISHED"

    duplicated = client.post(
        "/api/v1/assistants",
        json=assistant_payload(
            knowledge_base,
            llm_model,
            kb_ids=[knowledge_base["id"], knowledge_base["id"]],
            published=False,
        ),
    )
    assert duplicated.status_code == 422
    assert duplicated.json()["error"]["code"] == "ASSISTANT_KB_DUPLICATED"


def test_published_app_protects_knowledge_availability(client, active_knowledge, assistant):
    response = client.patch(f"/api/v1/knowledge-bases/{active_knowledge['id']}", json={"published": False})
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "KNOWLEDGE_BASE_IN_PUBLISHED_APP"
    unchanged = client.get(f"/api/v1/knowledge-bases/{active_knowledge['id']}")
    assert unchanged.json()["published"] is True


def test_conversation_crud_and_publication_constraint(client, active_knowledge, llm_model, assistant):
    listed = client.get("/api/v1/assistants")
    assert listed.status_code == 200
    assert listed.json()[0]["kb_ids"] == [active_knowledge["id"]]

    created = client.post(f"/api/v1/assistants/{assistant['id']}/conversations")
    assert created.status_code == 201
    detail = client.get(f"/api/v1/conversations/{created.json()['id']}")
    assert detail.status_code == 200
    assert detail.json()["messages"] == []

    unpublished = client.patch(f"/api/v1/assistants/{assistant['id']}", json={"published": False})
    assert unpublished.status_code == 200
    blocked = client.post(f"/api/v1/assistants/{assistant['id']}/conversations")
    assert blocked.status_code == 409
    assert blocked.json()["error"]["code"] == "ASSISTANT_NOT_PUBLISHED"

    removed = client.delete(f"/api/v1/conversations/{created.json()['id']}")
    assert removed.status_code == 204
    assert client.get(f"/api/v1/conversations/{created.json()['id']}").status_code == 404


def test_sse_chat_persists_grounded_answer_citations_usage_and_logs(client, assistant, conversation):
    gateway = ChatGateway()
    app.dependency_overrides[get_gateway] = lambda: gateway

    response = send(client, conversation)
    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("text/event-stream")
    events = sse_events(response)
    assert [event for event, _ in events] == ["meta", "citations", "token", "token", "done"]
    citations = events[1][1]["items"]
    assert citations
    assert "合规发票" in citations[0]["snapshot_text"]
    assert citations[0]["ordinal"] == 1
    assert events[2][1]["text"] + events[3][1]["text"] == "报销需要合规发票。"
    done = events[-1][1]
    assert done["input_tokens"] == 18
    assert done["output_tokens"] == 6
    assert done["total_tokens"] == 24
    assert done["usage_source"] == "provider"
    assert done["first_token_ms"] is not None

    detail = client.get(f"/api/v1/conversations/{conversation['id']}").json()
    assert detail["title"].startswith("报销需要")
    assert [message["role"] for message in detail["messages"]] == ["user", "assistant"]
    assert detail["messages"][1]["status"] == "ready"
    assert detail["messages"][1]["citations"][0]["snapshot_text"] == citations[0]["snapshot_text"]

    logs = client.get("/api/v1/query-runs", params={"kb_id": assistant["kb_ids"][0]})
    assert logs.status_code == 200
    assert len(logs.json()) == 1
    assert logs.json()[0]["answer"] == "报销需要合规发票。"
    assert logs.json()[0]["total_tokens"] == 24
    assert client.get("/api/v1/query-runs", params={"kb_id": "missing"}).json() == []


def test_chat_history_is_sent_to_langchain_on_following_turn(client, conversation):
    gateway = ChatGateway()
    app.dependency_overrides[get_gateway] = lambda: gateway
    assert send(client, conversation).status_code == 200
    assert send(client, conversation, "还需要出差审批单吗？").status_code == 200

    assert len(gateway.chat_calls) == 2
    second_call = gateway.chat_calls[1]
    history_text = [message.content for message in second_call]
    assert "报销需要哪些材料？" in history_text
    assert "报销需要合规发票。" in history_text
    assert "还需要出差审批单吗？" in second_call[-1].content


def test_missing_provider_usage_stays_unavailable_instead_of_estimated(client, conversation):
    gateway = ChatGateway(chunks=[ChatStreamChunk(text="依据不足，请补充资料。")])
    app.dependency_overrides[get_gateway] = lambda: gateway
    response = send(client, conversation)
    done = sse_events(response)[-1][1]
    assert done["input_tokens"] is None
    assert done["output_tokens"] is None
    assert done["total_tokens"] is None
    assert done["usage_source"] == "unavailable"
    run = client.get("/api/v1/query-runs").json()[0]
    assert run["total_tokens"] is None
    assert run["usage_source"] == "unavailable"


def test_stream_failure_is_sanitized_and_recorded(client, conversation):
    gateway = ChatGateway(error=RuntimeError("sk-live-secret upstream stack trace"))
    app.dependency_overrides[get_gateway] = lambda: gateway
    response = send(client, conversation)
    events = sse_events(response)
    assert events[-1][0] == "error"
    assert events[-1][1]["code"] == "CHAT_GENERATION_FAILED"
    assert "sk-live-secret" not in response.text
    assert "stack trace" not in response.text
    run = client.get("/api/v1/query-runs").json()[0]
    assert run["status"] == "failed"
    assert run["error_code"] == "CHAT_GENERATION_FAILED"
    assert run["total_tokens"] is None


def test_api_error_keeps_safe_public_message(client, conversation):
    gateway = ChatGateway(error=ApiError(502, "LLM_PROVIDER_FAILED", "LLM 服务商调用失败，请检查模型配置后重试"))
    app.dependency_overrides[get_gateway] = lambda: gateway
    response = send(client, conversation)
    assert sse_events(response)[-1] == (
        "error",
        {
            "code": "LLM_PROVIDER_FAILED",
            "message": "LLM 服务商调用失败，请检查模型配置后重试",
            "run_id": sse_events(response)[0][1]["run_id"],
        },
    )
