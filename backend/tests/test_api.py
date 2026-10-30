import time
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from poker_calculator.api.main import create_app
from poker_calculator.application.tasks import QueueFullError, TaskService
from poker_calculator.domain.models import AnalysisRequest

PAYLOAD = {
    "hero": [48, 49],
    "board": [0, 5, 22, 31, 32],
    "opponents": [{"kind": "exact", "cards": [44, 45]}],
    "pot_before_call": 150,
    "call_amount": 50,
    "settlement_assumption": "showdownAfterCall",
}


@pytest.fixture(scope="module")
def client() -> Iterator[TestClient]:
    with TestClient(create_app()) as test_client:
        yield test_client


def wait_until_done(client: TestClient, task_id: str) -> dict[str, object]:
    for _ in range(200):
        snapshot = client.get(f"/api/v1/analyses/{task_id}")
        assert snapshot.status_code == 200
        data: dict[str, object] = snapshot.json()
        if data["status"] not in ("queued", "running", "cancelling"):
            return data
        time.sleep(0.05)
    pytest.fail("task did not complete in 10 seconds")


def test_task_api_real_spawn(client: TestClient) -> None:
    assert client.get("/health").json()["status"] == "ok"
    assert client.get("/api/v1/strategies").json()["strategies"][0]["id"] == "pot-odds"
    submitted = client.post("/api/v1/analyses", json=PAYLOAD)
    assert submitted.status_code == 202
    snapshot = wait_until_done(client, submitted.json()["task_id"])
    assert snapshot["status"] == "succeeded", snapshot
    assert snapshot["progress"] == 1
    result = snapshot["result"]
    assert isinstance(result, dict)
    assert result["equity"] == 1
    assert result["call_ev"] == 150


def test_bad_requests_and_missing_tasks(client: TestClient) -> None:
    invalid = {**PAYLOAD, "hero": [48, 48]}
    assert client.post("/api/v1/analyses", json=invalid).status_code == 422
    unknown = {**PAYLOAD, "strategy_id": "missing-strategy"}
    assert client.post("/api/v1/analyses", json=unknown).status_code == 422
    config = {**PAYLOAD, "strategy_config": {"unknown": 1}}
    assert client.post("/api/v1/analyses", json=config).status_code == 422
    assert client.get("/api/v1/analyses/missing").status_code == 404
    assert client.post("/api/v1/analyses/missing/cancel").status_code == 404


def test_running_task_can_be_cancelled(client: TestClient) -> None:
    payload = {**PAYLOAD, "board": [], "samples": 200_000}
    task_id = client.post("/api/v1/analyses", json=payload).json()["task_id"]
    assert client.post(f"/api/v1/analyses/{task_id}/cancel").status_code == 200
    snapshot = wait_until_done(client, task_id)
    assert snapshot["status"] == "cancelled"
    assert snapshot["result"] is None


def test_queue_bound_and_result_expiry() -> None:
    service = TaskService(max_workers=1, max_tasks=1, ttl_seconds=0.05)
    try:
        request = AnalysisRequest.model_validate({**PAYLOAD, "board": [], "samples": 200_000})
        task = service.submit(request)
        with pytest.raises(QueueFullError):
            service.submit(request)
        service.cancel(task.id)
        for _ in range(200):
            snapshot = service.get(task.id)
            if snapshot.status == "cancelled":
                break
            time.sleep(0.02)
        assert snapshot.status == "cancelled"
        time.sleep(0.06)
        assert service.get(task.id).status == "expired"
    finally:
        service.close()
