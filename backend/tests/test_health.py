def test_health_and_request_id(client):
    live = client.get("/api/v1/health/live")
    assert live.status_code == 200
    assert live.json() == {"status": "ok"}
    assert live.headers["X-Request-ID"]

    ready = client.get("/api/v1/health/ready", headers={"X-Request-ID": "req-test"})
    assert ready.status_code == 200
    assert ready.json()["database"] == "ok"
    assert ready.headers["X-Request-ID"] == "req-test"
