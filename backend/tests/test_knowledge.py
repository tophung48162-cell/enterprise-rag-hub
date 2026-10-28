import pytest

MARKDOWN = """# 员工服务指南

本指南用于验证企业知识库的真实 Markdown 上传与持久化流程。

## 报销申请

报销申请须在出差结束后十五个工作日内提交，并提供合规发票、审批单和行程证明。

## 休假申请

休假申请需要提前提交，由直属负责人审批后归档。
"""


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
            "description": "真实 Markdown 验收",
            "department": "人力行政",
            "embedding_model_id": embedding_model["id"],
        },
    )
    assert response.status_code == 201
    return response.json()


def upload(client, knowledge_base, content=MARKDOWN.encode(), name="员工指南.md"):
    return client.post(
        f"/api/v1/knowledge-bases/{knowledge_base['id']}/documents",
        files={"file": (name, content, "text/markdown")},
    )


def preview(client, document, chunk_size=100, chunk_overlap=20):
    return client.post(
        f"/api/v1/documents/{document['id']}/preview",
        json={"chunk_size": chunk_size, "chunk_overlap": chunk_overlap, "chunk_strategy": "structure"},
    )


def test_knowledge_base_create_list_patch_and_duplicate(knowledge_base, client):
    assert knowledge_base["document_count"] == 0
    assert knowledge_base["chunk_size"] == 800
    listed = client.get("/api/v1/knowledge-bases")
    assert [item["name"] for item in listed.json()] == ["员工服务知识库"]

    patched = client.patch(
        f"/api/v1/knowledge-bases/{knowledge_base['id']}",
        json={"description": "更新后的说明", "published": True, "chunk_size": 600, "chunk_overlap": 80},
    )
    assert patched.status_code == 200
    assert patched.json()["published"] is True
    assert patched.json()["chunk_size"] == 600

    duplicate = client.post(
        "/api/v1/knowledge-bases",
        json={
            "name": "员工服务知识库",
            "department": "人力行政",
            "embedding_model_id": knowledge_base["embedding_model_id"],
        },
    )
    assert duplicate.status_code == 409
    assert duplicate.json()["error"]["code"] == "KNOWLEDGE_BASE_NAME_EXISTS"


def test_knowledge_base_validates_models_and_protects_model_reference(client, knowledge_base, embedding_model):
    mismatch = client.post(
        "/api/v1/knowledge-bases",
        json={
            "name": "错误模型知识库",
            "department": "产品研发",
            "embedding_model_id": embedding_model["id"],
            "rerank_model_id": embedding_model["id"],
        },
    )
    assert mismatch.status_code == 422
    assert mismatch.json()["error"]["code"] == "MODEL_CAPABILITY_MISMATCH"

    deleted = client.delete(f"/api/v1/models/{embedding_model['id']}")
    assert deleted.status_code == 409
    assert deleted.json()["error"]["code"] == "MODEL_IN_USE"


def test_markdown_upload_persists_original_and_rejects_duplicates(client, knowledge_base, storage):
    response = upload(client, knowledge_base)
    assert response.status_code == 201
    document = response.json()
    assert document["status"] == "uploaded"
    assert document["original_name"] == "员工指南.md"
    assert document["size_bytes"] == len(MARKDOWN.encode())
    assert document["chunk_count"] == 0
    assert storage.objects
    assert next(iter(storage.objects.values())) == MARKDOWN.encode()

    documents = client.get(f"/api/v1/knowledge-bases/{knowledge_base['id']}/documents")
    assert documents.status_code == 200
    assert [item["id"] for item in documents.json()] == [document["id"]]

    duplicate = upload(client, knowledge_base)
    assert duplicate.status_code == 409
    assert duplicate.json()["error"]["code"] == "DOCUMENT_ALREADY_EXISTS"


@pytest.mark.parametrize(
    ("name", "content", "expected_code"),
    [
        ("说明.txt", b"plain text", "DOCUMENT_FORMAT_UNSUPPORTED"),
        ("空文件.md", b"", "EMPTY_FILE"),
        ("编码.md", b"\xff\xfe\x00", "INVALID_MARKDOWN"),
        ("无效编码.md", b"\xff\xfe\x01", "MARKDOWN_ENCODING_UNSUPPORTED"),
        ("空白.md", b" \n\t", "EMPTY_DOCUMENT_CONTENT"),
    ],
)
def test_markdown_upload_rejects_invalid_content(client, knowledge_base, name, content, expected_code):
    response = upload(client, knowledge_base, content=content, name=name)
    assert response.status_code in {415, 422}
    assert response.json()["error"]["code"] == expected_code


def test_markdown_preview_uses_structure_and_is_idempotent(client, knowledge_base):
    document = upload(client, knowledge_base).json()
    first = preview(client, document)
    assert first.status_code == 200
    payload = first.json()
    assert payload["document"]["status"] == "pending_index"
    assert payload["document"]["chunk_count"] == len(payload["chunks"])
    assert any("报销申请" in chunk["title"] for chunk in payload["chunks"])
    assert any("报销申请须" in chunk["text"] for chunk in payload["chunks"])
    assert all(chunk["status"] == "pending_index" for chunk in payload["chunks"])
    assert [chunk["page_number"] for chunk in payload["chunks"]] == list(range(1, len(payload["chunks"]) + 1))
    first_ids = [chunk["id"] for chunk in payload["chunks"]]

    listed = client.get(f"/api/v1/documents/{document['id']}/chunks")
    assert [chunk["id"] for chunk in listed.json()] == first_ids

    second = preview(client, document)
    assert second.status_code == 200
    assert [chunk["text"] for chunk in second.json()["chunks"]] == [
        chunk["text"] for chunk in payload["chunks"]
    ]
    assert len(second.json()["chunks"]) == len(payload["chunks"])


def test_preview_rejects_invalid_overlap(client, knowledge_base):
    document = upload(client, knowledge_base).json()
    response = preview(client, document, chunk_size=100, chunk_overlap=100)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "INVALID_CHUNK_OVERLAP"


def test_chunk_edit_persists_and_marks_pending_index(client, knowledge_base):
    document = upload(client, knowledge_base).json()
    chunk = preview(client, document).json()["chunks"][0]
    response = client.patch(f"/api/v1/chunks/{chunk['id']}", json={"text": "  人工修订后的制度正文。  "})
    assert response.status_code == 200
    assert response.json()["text"] == "人工修订后的制度正文。"
    assert response.json()["status"] == "pending_index"

    persisted = client.get(f"/api/v1/documents/{document['id']}/chunks").json()
    assert persisted[0]["text"] == "人工修订后的制度正文。"
    empty = client.patch(f"/api/v1/chunks/{chunk['id']}", json={"text": "   "})
    assert empty.status_code == 422
    assert empty.json()["error"]["code"] == "EMPTY_CHUNK_CONTENT"


def test_document_and_knowledge_base_delete_cleanup(client, knowledge_base, storage):
    document = upload(client, knowledge_base).json()
    preview(client, document)
    blocked = client.delete(f"/api/v1/knowledge-bases/{knowledge_base['id']}")
    assert blocked.status_code == 409
    assert blocked.json()["error"]["code"] == "KNOWLEDGE_BASE_NOT_EMPTY"

    removed = client.delete(f"/api/v1/documents/{document['id']}")
    assert removed.status_code == 204
    assert storage.objects == {}
    assert client.get(f"/api/v1/documents/{document['id']}/chunks").status_code == 404

    deleted = client.delete(f"/api/v1/knowledge-bases/{knowledge_base['id']}")
    assert deleted.status_code == 204
    assert client.get(f"/api/v1/knowledge-bases/{knowledge_base['id']}").status_code == 404
