import pytest
from sqlalchemy import func, select

from app.db import SessionLocal
from app.db_models import Chunk, ChunkEmbedding, Document, IndexVersion, KnowledgeBase
from app.errors import ApiError
from app.main import app
from app.providers.gateway import EmbeddingResult
from app.services.index_queue import get_index_dispatcher
from app.services.indexing import process_index_version
from tests.test_knowledge import preview, upload


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
            "description": "版本化向量索引验收",
            "department": "人力行政",
            "embedding_model_id": embedding_model["id"],
        },
    )
    assert response.status_code == 201
    return response.json()


class FakeGateway:
    def __init__(self, dimensions=1024, on_embed=None):
        self.dimensions = dimensions
        self.on_embed = on_embed
        self.calls = []

    async def embed_documents(self, provider, model, api_key, texts):
        self.calls.append(list(texts))
        if self.on_embed:
            self.on_embed()
        return EmbeddingResult(
            vectors=[[float(index)] * self.dimensions for index, _ in enumerate(texts)],
            duration_ms=1,
        )


def prepare_chunks(client, knowledge_base):
    document = upload(client, knowledge_base).json()
    response = preview(client, document)
    assert response.status_code == 200
    return document, response.json()["chunks"]


def create_version(client, knowledge_base, dispatched=None):
    dispatched = dispatched if dispatched is not None else []
    app.dependency_overrides[get_index_dispatcher] = lambda: lambda version_id: dispatched.append(version_id)
    response = client.post(f"/api/v1/knowledge-bases/{knowledge_base['id']}/index-versions")
    assert response.status_code == 202, response.text
    assert dispatched == [response.json()["id"]]
    return response.json()


def test_index_version_create_list_and_duplicate_protection(client, knowledge_base):
    prepare_chunks(client, knowledge_base)
    version = create_version(client, knowledge_base)
    assert version["status"] == "queued"
    assert version["progress"] == 0
    assert version["total_chunks"] > 0
    assert version["usage_source"] == "unavailable"

    listed = client.get(f"/api/v1/knowledge-bases/{knowledge_base['id']}/index-versions")
    assert [item["id"] for item in listed.json()] == [version["id"]]
    assert client.get(f"/api/v1/index-versions/{version['id']}").json()["status"] == "queued"

    duplicate = client.post(f"/api/v1/knowledge-bases/{knowledge_base['id']}/index-versions")
    assert duplicate.status_code == 409
    assert duplicate.json()["error"]["code"] == "INDEX_BUILD_RUNNING"


def test_index_version_requires_chunks_for_every_document(client, knowledge_base):
    empty = client.post(f"/api/v1/knowledge-bases/{knowledge_base['id']}/index-versions")
    assert empty.status_code == 409
    assert empty.json()["error"]["code"] == "DOCUMENT_CHUNKS_REQUIRED"

    upload(client, knowledge_base)
    missing_chunks = client.post(f"/api/v1/knowledge-bases/{knowledge_base['id']}/index-versions")
    assert missing_chunks.status_code == 409
    assert missing_chunks.json()["error"]["code"] == "DOCUMENT_CHUNKS_REQUIRED"


@pytest.mark.asyncio
async def test_successful_build_activates_snapshot_and_duplicate_message_is_free(
    client, knowledge_base, db_session
):
    _, chunks = prepare_chunks(client, knowledge_base)
    queued = create_version(client, knowledge_base)
    gateway = FakeGateway()

    version = await process_index_version(db_session, gateway, queued["id"])
    assert version.status == "active"
    assert version.progress == 100
    assert version.embedded_chunks == len(chunks)
    assert version.input_tokens is None
    assert version.usage_source == "unavailable"
    assert version.duration_ms is not None
    assert len(gateway.calls) == 1

    db_session.expire_all()
    knowledge = db_session.get(KnowledgeBase, knowledge_base["id"])
    assert knowledge.active_index_version_id == queued["id"]
    embeddings = db_session.scalars(
        select(ChunkEmbedding).where(ChunkEmbedding.index_version_id == queued["id"])
    ).all()
    assert len(embeddings) == len(chunks)
    assert {item.chunk_id for item in embeddings} == {item["id"] for item in chunks}
    assert all(item.source_text and item.content_hash for item in embeddings)
    documents = client.get(f"/api/v1/knowledge-bases/{knowledge_base['id']}/documents").json()
    assert [item["status"] for item in documents] == ["ready"]

    duplicate = await process_index_version(db_session, gateway, queued["id"])
    assert duplicate.status == "active"
    assert len(gateway.calls) == 1


@pytest.mark.asyncio
async def test_dimension_mismatch_fails_without_activation(client, knowledge_base, db_session):
    prepare_chunks(client, knowledge_base)
    queued = create_version(client, knowledge_base)

    with pytest.raises(ApiError) as caught:
        await process_index_version(db_session, FakeGateway(dimensions=3), queued["id"])
    assert caught.value.code == "EMBEDDING_DIMENSION_MISMATCH"

    db_session.expire_all()
    version = db_session.get(IndexVersion, queued["id"])
    knowledge = db_session.get(KnowledgeBase, knowledge_base["id"])
    assert version.status == "failed"
    assert version.error_code == "EMBEDDING_DIMENSION_MISMATCH"
    assert knowledge.active_index_version_id is None
    assert db_session.scalar(select(func.count()).select_from(ChunkEmbedding)) == 0


@pytest.mark.asyncio
async def test_new_active_version_retires_previous_version(client, knowledge_base, db_session):
    prepare_chunks(client, knowledge_base)
    first = create_version(client, knowledge_base)
    await process_index_version(db_session, FakeGateway(), first["id"])

    second = create_version(client, knowledge_base)
    await process_index_version(db_session, FakeGateway(), second["id"])
    db_session.expire_all()
    assert db_session.get(IndexVersion, first["id"]).status == "ready"
    assert db_session.get(IndexVersion, second["id"]).status == "active"
    assert db_session.get(KnowledgeBase, knowledge_base["id"]).active_index_version_id == second["id"]
    for version_id in (first["id"], second["id"]):
        count = db_session.scalar(
            select(func.count()).select_from(ChunkEmbedding).where(ChunkEmbedding.index_version_id == version_id)
        )
        assert count == second["total_chunks"]


@pytest.mark.asyncio
async def test_source_change_during_build_preserves_previous_active_version(
    client, knowledge_base, db_session
):
    _, chunks = prepare_chunks(client, knowledge_base)
    first = create_version(client, knowledge_base)
    await process_index_version(db_session, FakeGateway(), first["id"])

    changed = client.patch(f"/api/v1/chunks/{chunks[0]['id']}", json={"text": "构建前的人工修订内容。"})
    assert changed.status_code == 200
    second = create_version(client, knowledge_base)

    def mutate_source():
        with SessionLocal() as session:
            chunk = session.get(Chunk, chunks[0]["id"])
            chunk.text = "构建期间由其他事务写入的内容。"
            session.commit()

    with pytest.raises(ApiError) as caught:
        await process_index_version(db_session, FakeGateway(on_embed=mutate_source), second["id"])
    assert caught.value.code == "INDEX_CONTENT_CHANGED"
    db_session.expire_all()
    assert db_session.get(IndexVersion, second["id"]).status == "failed"
    assert db_session.get(IndexVersion, first["id"]).status == "active"
    assert db_session.get(KnowledgeBase, knowledge_base["id"]).active_index_version_id == first["id"]


def test_running_build_blocks_knowledge_mutations(client, knowledge_base):
    document, chunks = prepare_chunks(client, knowledge_base)
    create_version(client, knowledge_base)

    responses = [
        upload(client, knowledge_base, content=b"# another\n\ncontent", name="其他.md"),
        preview(client, document),
        client.patch(f"/api/v1/chunks/{chunks[0]['id']}", json={"text": "不允许的修改"}),
        client.patch(f"/api/v1/knowledge-bases/{knowledge_base['id']}", json={"chunk_size": 600}),
        client.delete(f"/api/v1/documents/{document['id']}"),
    ]
    assert [response.status_code for response in responses] == [409] * len(responses)
    assert all(response.json()["error"]["code"] == "INDEX_BUILD_RUNNING" for response in responses)


def test_index_config_change_marks_existing_chunks_pending(client, knowledge_base, db_session):
    prepare_chunks(client, knowledge_base)
    queued = create_version(client, knowledge_base)
    gateway = FakeGateway()
    with db_session:
        import asyncio

        asyncio.run(process_index_version(db_session, gateway, queued["id"]))

    response = client.patch(f"/api/v1/knowledge-bases/{knowledge_base['id']}", json={"chunk_size": 600})
    assert response.status_code == 200
    documents = client.get(f"/api/v1/knowledge-bases/{knowledge_base['id']}/documents").json()
    assert documents[0]["status"] == "pending_index"
    chunks = client.get(f"/api/v1/documents/{documents[0]['id']}/chunks").json()
    assert all(chunk["status"] == "pending_index" for chunk in chunks)


def test_queue_failure_is_persisted_without_leaking_exception(client, knowledge_base):
    prepare_chunks(client, knowledge_base)

    def unavailable(_version_id):
        raise RuntimeError("secret queue credentials")

    app.dependency_overrides[get_index_dispatcher] = lambda: unavailable
    response = client.post(f"/api/v1/knowledge-bases/{knowledge_base['id']}/index-versions")
    assert response.status_code == 503
    payload = response.json()
    assert payload["error"]["code"] == "INDEX_QUEUE_UNAVAILABLE"
    assert "secret queue credentials" not in response.text
    version_id = payload["error"]["details"]["index_version_id"]
    failed = client.get(f"/api/v1/index-versions/{version_id}").json()
    assert failed["status"] == "failed"
    assert failed["error_code"] == "INDEX_QUEUE_UNAVAILABLE"
    document = client.get(f"/api/v1/knowledge-bases/{knowledge_base['id']}/documents").json()[0]
    assert document["status"] == "failed"
    assert db_document_has_no_orphan(document)


def db_document_has_no_orphan(document):
    with SessionLocal() as session:
        return session.get(Document, document["id"]) is not None
