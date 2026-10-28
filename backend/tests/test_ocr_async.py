from app.main import app
from app.services.ocr_queue import get_ocr_dispatcher
from tests.test_ocr import FakeChat
from workers.tasks import recognize_ocr


def test_async_ocr_is_durable_and_worker_processes_original(
    client, ocr_model, storage, png_bytes, monkeypatch
):
    dispatched = []
    app.dependency_overrides[get_ocr_dispatcher] = lambda: dispatched.append
    response = client.post(
        "/api/v1/ocr/recognize/async",
        data={"model_config_id": ocr_model["id"]},
        files={"file": ("queued.png", png_bytes, "image/png")},
    )
    assert response.status_code == 202
    result = response.json()
    assert result["status"] == "queued"
    assert result["text"] == ""
    assert dispatched == [result["id"]]
    assert client.get(f"/api/v1/ocr/{result['id']}").json()["status"] == "queued"

    FakeChat.fail = False
    monkeypatch.setattr("app.services.ocr.ChatOpenAI", FakeChat)
    monkeypatch.setattr("workers.tasks.S3Storage", lambda: storage)
    assert recognize_ocr.run(result["id"]) == {"result_id": result["id"], "status": "ready"}

    completed = client.get(f"/api/v1/ocr/{result['id']}")
    assert completed.status_code == 200
    assert completed.json()["status"] == "ready"
    assert completed.json()["text"] == "采购审批流程\n部门负责人审批"
    assert completed.json()["input_tokens"] == 120
    assert len(storage.objects) == 1

    # A redelivered queue message does not call the paid model a second time.
    calls = len(FakeChat.instances)
    assert recognize_ocr.run(result["id"])["status"] == "ready"
    assert len(FakeChat.instances) == calls


def test_queue_failure_is_persisted_and_returns_retryable_error(client, ocr_model, storage, png_bytes):
    def unavailable(_result_id):
        raise ConnectionError("redis unavailable")

    app.dependency_overrides[get_ocr_dispatcher] = lambda: unavailable
    response = client.post(
        "/api/v1/ocr/recognize/async",
        data={"model_config_id": ocr_model["id"]},
        files={"file": ("queued.png", png_bytes, "image/png")},
    )
    assert response.status_code == 503
    error = response.json()["error"]
    assert error["code"] == "OCR_QUEUE_UNAVAILABLE"
    assert error["retryable"] is True
    assert "redis unavailable" not in response.text

    result_id = error["details"]["ocr_result_id"]
    stored = client.get(f"/api/v1/ocr/{result_id}").json()
    assert stored["status"] == "failed"
    assert stored["error_code"] == "OCR_QUEUE_UNAVAILABLE"
    assert len(storage.objects) == 1
