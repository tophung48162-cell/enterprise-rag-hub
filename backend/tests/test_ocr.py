from langchain_core.messages import AIMessage


class FakeChat:
    fail = False
    instances = []

    def __init__(self, **kwargs):
        self.kwargs = kwargs
        self.messages = None
        self.__class__.instances.append(self)

    async def ainvoke(self, messages):
        self.messages = messages
        if self.__class__.fail:
            raise RuntimeError("upstream failed with a secret")
        return AIMessage(
            content="采购审批流程\n部门负责人审批",
            usage_metadata={"input_tokens": 120, "output_tokens": 12, "total_tokens": 132},
        )


def test_real_ocr_contract_and_stored_result(client, provider, ocr_model, storage, png_bytes, monkeypatch):
    FakeChat.fail = False
    FakeChat.instances = []
    monkeypatch.setattr("app.services.ocr.ChatOpenAI", FakeChat)
    response = client.post(
        "/api/v1/ocr/recognize",
        data={"model_config_id": ocr_model["id"]},
        files={"file": ("../../采购流程.png", png_bytes, "image/png")},
    )
    assert response.status_code == 201
    result = response.json()
    assert result["status"] == "ready"
    assert result["text"] == "采购审批流程\n部门负责人审批"
    assert result["input_tokens"] == 120
    assert result["output_tokens"] == 12
    assert result["file_name"] == "采购流程.png"
    assert len(storage.objects) == 1
    assert list(storage.content_types.values()) == ["image/png"]

    chat = FakeChat.instances[-1]
    assert chat.kwargs["model"] == "qwen-vl-ocr"
    assert chat.kwargs["base_url"] == provider["base_url"]
    content = chat.messages[0].content
    assert content[0]["image_url"]["url"].startswith("data:image/png;base64,")
    assert content[1]["type"] == "text"

    fetched = client.get(f"/api/v1/ocr/{result['id']}")
    assert fetched.status_code == 200
    assert fetched.json()["text"] == result["text"]
    assert "object_key" not in fetched.json()


def test_failed_ocr_can_retry_original_object(client, ocr_model, storage, png_bytes, monkeypatch):
    FakeChat.fail = True
    monkeypatch.setattr("app.services.ocr.ChatOpenAI", FakeChat)
    failed = client.post(
        "/api/v1/ocr/recognize",
        data={"model_config_id": ocr_model["id"]},
        files={"file": ("scan.png", png_bytes, "image/png")},
    )
    assert failed.status_code == 502
    error = failed.json()["error"]
    assert error["retryable"] is True
    result_id = error["details"]["ocr_result_id"]
    assert "secret" not in failed.text

    FakeChat.fail = False
    retried = client.post(f"/api/v1/ocr/{result_id}/retry")
    assert retried.status_code == 201
    assert retried.json()["retry_of_id"] == result_id
    assert retried.json()["status"] == "ready"
    assert len(storage.objects) == 2

    repeated = client.post(f"/api/v1/ocr/{result_id}/retry")
    assert repeated.status_code == 201
    successful_retry = client.post(f"/api/v1/ocr/{retried.json()['id']}/retry")
    assert successful_retry.status_code == 409


def test_invalid_image_is_rejected_before_cloud_call(client, ocr_model, storage):
    response = client.post(
        "/api/v1/ocr/recognize",
        data={"model_config_id": ocr_model["id"]},
        files={"file": ("fake.png", b"not-an-image", "image/png")},
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "INVALID_IMAGE"
    assert storage.objects == {}


def test_non_tongyi_model_cannot_be_used_for_ocr(client, png_bytes):
    provider = client.post(
        "/api/v1/providers",
        json={"kind": "openrouter", "name": "OR", "base_url": "https://openrouter.ai/api/v1", "api_key": "secret-key"},
    ).json()
    model = client.post(
        "/api/v1/models",
        json={"provider_id": provider["id"], "remote_model_id": "qwen-vl-ocr", "capability": "LLM"},
    ).json()
    response = client.post(
        "/api/v1/ocr/recognize",
        data={"model_config_id": model["id"]},
        files={"file": ("scan.png", png_bytes, "image/png")},
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "OCR_MODEL_UNSUPPORTED"
