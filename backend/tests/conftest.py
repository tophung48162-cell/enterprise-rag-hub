import os
from io import BytesIO

import pytest
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient
from PIL import Image

os.environ["HUB_DATABASE_URL"] = "sqlite://"
os.environ["HUB_ENCRYPTION_KEY"] = Fernet.generate_key().decode("ascii")
os.environ["HUB_ENVIRONMENT"] = "test"

from app.db import Base, SessionLocal, engine  # noqa: E402
from app.db_models import ModelConfig, Provider  # noqa: E402
from app.main import app  # noqa: E402
from app.storage import get_storage  # noqa: E402


class MemoryStorage:
    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}
        self.content_types: dict[str, str] = {}

    def put_bytes(self, key: str, data: bytes, content_type: str) -> None:
        self.objects[key] = data
        self.content_types[key] = content_type

    def get_bytes(self, key: str) -> bytes:
        return self.objects[key]

    def delete_bytes(self, key: str) -> None:
        self.objects.pop(key, None)
        self.content_types.pop(key, None)


@pytest.fixture
def storage():
    return MemoryStorage()


@pytest.fixture
def client(storage):
    Base.metadata.create_all(engine)
    with SessionLocal() as session:
        for table in reversed(Base.metadata.sorted_tables):
            session.execute(table.delete())
        session.commit()
    app.dependency_overrides[get_storage] = lambda: storage
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


@pytest.fixture
def db_session():
    with SessionLocal() as session:
        yield session


@pytest.fixture
def provider(client):
    response = client.post(
        "/api/v1/providers",
        json={
            "kind": "tongyi",
            "name": "通义测试",
            "base_url": "https://dashscope.example.com/compatible-mode/v1",
            "api_key": "test-secret-key",
        },
    )
    assert response.status_code == 201
    return response.json()


@pytest.fixture
def ocr_model(client, provider):
    response = client.post(
        "/api/v1/models",
        json={"provider_id": provider["id"], "remote_model_id": "qwen-vl-ocr", "capability": "LLM"},
    )
    assert response.status_code == 201
    return response.json()


@pytest.fixture
def png_bytes():
    buffer = BytesIO()
    Image.new("RGB", (32, 24), color="white").save(buffer, format="PNG")
    return buffer.getvalue()


def make_provider_model(capability="LLM", kind="tongyi"):
    provider = Provider(
        id="provider-1",
        kind=kind,
        name="测试",
        base_url="https://provider.example.com/v1",
        secret_ciphertext="encrypted",
    )
    model = ModelConfig(
        id="model-1",
        provider_id=provider.id,
        remote_model_id="test-model",
        capability=capability,
        dimensions=1024 if capability == "Embedding" else None,
    )
    return provider, model
