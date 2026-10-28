import asyncio

import pytest

from app.api.v1.deps import get_gateway
from app.main import app
from app.providers.gateway import EmbeddingResult, RerankResult
from app.services.indexing import process_index_version
from tests.test_indexing import create_version, prepare_chunks


def vector_for(text: str) -> list[float]:
    vector = [0.0] * 1024
    if "报销" in text or "发票" in text:
        vector[0] = 1.0
    elif "休假" in text:
        vector[1] = 1.0
    else:
        vector[0] = 0.5
        vector[1] = 0.5
    return vector


class RetrievalGateway:
    def __init__(self, dimensions=1024):
        self.dimensions = dimensions
        self.embedding_calls = []
        self.rerank_calls = []

    async def embed_documents(self, provider, model, api_key, texts):
        self.embedding_calls.append((model.id, list(texts)))
        vectors = [vector_for(text)[: self.dimensions] for text in texts]
        return EmbeddingResult(vectors=vectors, duration_ms=3)

    async def rerank(self, provider, model, api_key, query, documents, top_n):
        self.rerank_calls.append((model.id, list(documents), top_n))
        scores = [
            (index, 0.99 if "休假" in text else 0.2 if "报销" in text else 0.1)
            for index, text in enumerate(documents)
        ]
        scores.sort(key=lambda item: -item[1])
        return RerankResult(scores=scores[:top_n], duration_ms=5)


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
            "name": "员工服务知识库",
            "description": "真实向量检索验收",
            "department": "人力行政",
            "embedding_model_id": embedding_model["id"],
        },
    )
    assert response.status_code == 201
    return response.json()


@pytest.fixture
def rerank_model(client, provider):
    response = client.post(
        "/api/v1/models",
        json={"provider_id": provider["id"], "remote_model_id": "qwen3-rerank", "capability": "Rerank"},
    )
    assert response.status_code == 201
    return response.json()


@pytest.fixture
def active_knowledge(client, knowledge_base, db_session):
    _, chunks = prepare_chunks(client, knowledge_base)
    queued = create_version(client, knowledge_base)
    gateway = RetrievalGateway()
    asyncio.run(process_index_version(db_session, gateway, queued["id"]))
    return knowledge_base, chunks, queued


def retrieval(client, knowledge_base, **overrides):
    payload = {
        "query": "报销需要哪些材料？",
        "top_k": 1,
        "candidate_k": 20,
        "similarity_threshold": 0.1,
        "rerank": False,
    }
    payload.update(overrides)
    return client.post(f"/api/v1/knowledge-bases/{knowledge_base['id']}/retrieval", json=payload)


def test_retrieval_requires_active_index(client, knowledge_base):
    response = retrieval(client, knowledge_base)
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "ACTIVE_INDEX_REQUIRED"


def test_vector_retrieval_uses_active_snapshot_and_cosine_order(client, active_knowledge):
    knowledge_base, _, version = active_knowledge
    gateway = RetrievalGateway()
    app.dependency_overrides[get_gateway] = lambda: gateway

    response = retrieval(client, knowledge_base)
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["index_version_id"] == version["id"]
    assert payload["results"][0]["title"].endswith("报销申请")
    assert "合规发票" in payload["results"][0]["text"]
    assert payload["results"][0]["vector_score"] > 0.99
    assert payload["results"][0]["rerank_score"] is None
    assert payload["embedding_duration_ms"] == 3
    assert gateway.rerank_calls == []


def test_rerank_uses_full_candidate_pool_before_final_top_k(client, active_knowledge, rerank_model):
    knowledge_base, _, _ = active_knowledge
    patched = client.patch(
        f"/api/v1/knowledge-bases/{knowledge_base['id']}", json={"rerank_model_id": rerank_model["id"]}
    )
    assert patched.status_code == 200
    gateway = RetrievalGateway()
    app.dependency_overrides[get_gateway] = lambda: gateway

    response = retrieval(client, knowledge_base, query="申请流程", rerank=True, top_k=1)
    assert response.status_code == 200, response.text
    result = response.json()["results"][0]
    assert result["title"].endswith("休假申请")
    assert result["rerank_score"] == 0.99
    assert response.json()["rerank_duration_ms"] == 5
    assert len(gateway.rerank_calls[0][1]) >= 2


def test_retrieval_reads_immutable_text_after_chunk_edit(client, active_knowledge):
    knowledge_base, chunks, _ = active_knowledge
    expense = next(chunk for chunk in chunks if chunk["title"].endswith("报销申请"))
    changed = client.patch(f"/api/v1/chunks/{expense['id']}", json={"text": "尚未进入活动索引的新文本"})
    assert changed.status_code == 200
    app.dependency_overrides[get_gateway] = lambda: RetrievalGateway()

    response = retrieval(client, knowledge_base)
    assert response.status_code == 200
    assert "合规发票" in response.json()["results"][0]["text"]
    assert "尚未进入活动索引" not in response.json()["results"][0]["text"]


def test_rerank_requires_configuration_and_never_fakes_scores(client, active_knowledge):
    knowledge_base, _, _ = active_knowledge
    app.dependency_overrides[get_gateway] = lambda: RetrievalGateway()
    response = retrieval(client, knowledge_base, rerank=True)
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "RERANK_MODEL_NOT_CONFIGURED"


def test_query_embedding_dimension_must_match_active_version(client, active_knowledge):
    knowledge_base, _, _ = active_knowledge
    app.dependency_overrides[get_gateway] = lambda: RetrievalGateway(dimensions=3)
    response = retrieval(client, knowledge_base)
    assert response.status_code == 502
    assert response.json()["error"]["code"] == "EMBEDDING_DIMENSION_MISMATCH"


def test_retrieval_keeps_active_version_model_after_knowledge_config_change(client, active_knowledge, provider):
    knowledge_base, _, _ = active_knowledge
    created = client.post(
        "/api/v1/models",
        json={
            "provider_id": provider["id"],
            "remote_model_id": "text-embedding-v3",
            "capability": "Embedding",
            "dimensions": 3,
        },
    )
    assert created.status_code == 201
    patched = client.patch(
        f"/api/v1/knowledge-bases/{knowledge_base['id']}",
        json={"embedding_model_id": created.json()["id"]},
    )
    assert patched.status_code == 200
    gateway = RetrievalGateway()
    app.dependency_overrides[get_gateway] = lambda: gateway

    response = retrieval(client, knowledge_base)
    assert response.status_code == 200
    assert gateway.embedding_calls[-1][0] == knowledge_base["embedding_model_id"]
    assert gateway.embedding_calls[-1][0] != created.json()["id"]
