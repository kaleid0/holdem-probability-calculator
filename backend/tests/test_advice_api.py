"""HTTP boundaries: results stay server-owned and must match the current decision."""

import time
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from poker_calculator.api.main import create_app
from poker_calculator.application.tasks import TaskResultUnavailable, TaskService

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


@pytest.fixture(scope="module")
def task_id(client: TestClient) -> str:
    response = client.post("/api/v1/analyses", json=PAYLOAD)
    assert response.status_code == 202
    task: str = response.json()["task_id"]
    for _ in range(200):
        data = client.get(f"/api/v1/analyses/{task}").json()
        if data["status"] == "succeeded":
            return task
        time.sleep(0.05)
    pytest.fail("analysis did not complete")


def test_advice_reads_real_worker_result(client: TestClient, task_id: str) -> None:
    response = client.post(
        "/api/v1/decision-advice",
        json={
            "base_analysis": PAYLOAD,
            "sources": {"baseline": task_id},
        },
    )
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["advice"]["title"] == "倾向跟注 50"
    assert result["advice"]["actions"] == [
        {"action": "call", "amount": 50, "amount_kind": "additional"},
    ]
    assert result["response_model"] == {"fold": 0.25, "raise": 0.08, "probe": 0.35}
    assert result["model_version"] == "decision-policy-v1"


def test_client_cannot_supply_equity_or_override_results(client: TestClient) -> None:
    for injected in ({"equity": 1}, {"result": {"equity": 1}}, {"actor": 0}):
        response = client.post(
            "/api/v1/decision-advice",
            json={
                "base_analysis": PAYLOAD,
                **injected,
            },
        )
        assert response.status_code == 422


def test_unknown_source_and_stale_analysis_are_rejected(client: TestClient, task_id: str) -> None:
    assert (
        client.post(
            "/api/v1/decision-advice",
            json={
                "base_analysis": PAYLOAD,
                "sources": {"baseline": "missing-task"},
            },
        ).status_code
        == 404
    )
    for update in ({"hero": [40, 41]}, {"call_amount": 60}, {"seed": 7}):
        response = client.post(
            "/api/v1/decision-advice",
            json={
                "base_analysis": {**PAYLOAD, **update},
                "sources": {"baseline": task_id},
            },
        )
        assert response.status_code == 422 and "当前局面不一致" in response.json()["detail"]


def test_wrong_strategy_is_rejected(client: TestClient, task_id: str) -> None:
    response = client.post(
        "/api/v1/decision-advice",
        json={
            "base_analysis": PAYLOAD,
            "sources": {"tree": task_id},
        },
    )
    assert response.status_code == 422 and "策略来源" in response.json()["detail"]


@pytest.mark.parametrize("expired,expected", [(False, 409), (True, 410)])
def test_unavailable_sources_are_explicit(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, expired: bool, expected: int
) -> None:
    def unavailable(self: TaskService, task_id: str) -> None:
        raise TaskResultUnavailable(expired=expired)

    monkeypatch.setattr(TaskService, "completed_analysis", unavailable)
    response = client.post(
        "/api/v1/decision-advice",
        json={
            "base_analysis": PAYLOAD,
            "sources": {"baseline": "unavailable"},
        },
    )
    assert response.status_code == expected


def test_unavailable_recording_and_invalid_response_inputs(client: TestClient) -> None:
    response = client.post(
        "/api/v1/decision-advice",
        json={
            "base_analysis": PAYLOAD,
            "recorded": True,
        },
    )
    assert response.status_code == 200
    assert response.json()["advice"] is None
    assert "recording-unavailable" in response.json()["fallback_reasons"]
    assert not response.json()["comparison"]["rows"]
    for model in ({"fold": 0.8, "raise": 0.3}, {"probe": 2}):
        assert (
            client.post(
                "/api/v1/decision-advice",
                json={
                    "base_analysis": PAYLOAD,
                    "response_model": model,
                },
            ).status_code
            == 422
        )
