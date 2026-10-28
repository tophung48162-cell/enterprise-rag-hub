from app.db_models import Provider


def test_provider_secret_is_encrypted_and_never_returned(client, db_session, provider):
    listed = client.get("/api/v1/providers")
    assert listed.status_code == 200
    assert listed.json()[0]["configured"] is True
    assert "api_key" not in listed.text
    assert "test-secret-key" not in listed.text

    stored = db_session.get(Provider, provider["id"])
    assert stored.secret_ciphertext != "test-secret-key"
    assert "test-secret-key" not in stored.secret_ciphertext


def test_provider_and_model_validation(client, provider):
    duplicate = client.post(
        "/api/v1/providers",
        json={
            "kind": "tongyi",
            "name": provider["name"],
            "base_url": "https://example.com/v1",
            "api_key": "another-secret",
        },
    )
    assert duplicate.status_code == 409
    assert duplicate.json()["error"]["code"] == "PROVIDER_NAME_EXISTS"

    missing_dimensions = client.post(
        "/api/v1/models",
        json={"provider_id": provider["id"], "remote_model_id": "text-embedding-v4", "capability": "Embedding"},
    )
    assert missing_dimensions.status_code == 422
    assert missing_dimensions.json()["error"]["code"] == "EMBEDDING_DIMENSIONS_REQUIRED"

    invalid_dimensions = client.post(
        "/api/v1/models",
        json={
            "provider_id": provider["id"],
            "remote_model_id": "qwen-plus",
            "capability": "LLM",
            "dimensions": 1024,
        },
    )
    assert invalid_dimensions.status_code == 422


def test_referenced_provider_and_model_cannot_be_deleted(client, provider, ocr_model):
    protected_provider = client.delete(f"/api/v1/providers/{provider['id']}")
    assert protected_provider.status_code == 409
    assert protected_provider.json()["error"]["code"] == "PROVIDER_IN_USE"

    disabled = client.patch(f"/api/v1/models/{ocr_model['id']}", json={"enabled": False})
    assert disabled.status_code == 200
    assert disabled.json()["enabled"] is False
