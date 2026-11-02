import copy
import json
import math
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from poker_calculator.api.main import create_app
from poker_calculator.application.sensitivity import (
    action_probabilities,
    features,
    infer,
    run_sensitivity,
)
from poker_calculator.application.services import AnalysisServices
from poker_calculator.domain.history import replay
from poker_calculator.domain.sensitivity import SensitivityRequest

ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture
def history_payload():
    return json.loads((ROOT / "examples/history-sensitivity.json").read_text(encoding="utf-8"))


def test_replay_fixture(history_payload):
    request = SensitivityRequest.model_validate(history_payload)
    decisions, warnings = replay(request)
    assert not warnings
    assert [d.event.action for d in decisions] == ["call", "check", "bet", "call", "bet"]
    assert decisions[-1].board == (4, 9, 14, 19)


@pytest.mark.parametrize(
    "mutation",
    [
        "sequence",
        "potBefore",
        "toCall",
        "amount",
        "streetTotal",
        "totalCommitted",
        "highestBefore",
        "minRaiseBefore",
        "activePlayersBefore",
        "player",
    ],
)
def test_tampered_history_rejected(history_payload, mutation):
    history_payload["history_context"]["events"][-1][mutation] += 1
    request = SensitivityRequest.model_validate(history_payload)
    with pytest.raises(ValueError):
        replay(request)


def test_missing_board_and_incomplete_are_explicit(history_payload):
    history_payload["history_context"]["events"][4]["board"] = None
    result = run_sensitivity(SensitivityRequest.model_validate(history_payload), AnalysisServices())
    assert all(o.status == "insufficient-data" for o in result.outcomes)
    assert "公共牌" in result.outcomes[0].reasons[0]
    history_payload["history_context"]["complete"] = False
    result = run_sensitivity(SensitivityRequest.model_validate(history_payload), AnalysisServices())
    assert "完整" in result.outcomes[0].reasons[0]


def test_missing_stacks_degrades_without_inventing(history_payload):
    history_payload["history_context"]["stacks"] = None
    decisions, warnings = replay(SensitivityRequest.model_validate(history_payload))
    assert all(d.effective_stack is None for d in decisions)
    assert "筹码" in warnings[0]


def test_future_board_not_used_for_earlier_action(history_payload):
    request = SensitivityRequest.model_validate(history_payload)
    earlier = replay(request)[0][2]
    changed = copy.deepcopy(history_payload)
    changed["history_context"]["events"][-2]["board"][-1] = 23
    changed["base_analysis"]["board"][-1] = 23
    other = replay(SensitivityRequest.model_validate(changed))[0][2]
    assert earlier == other
    assert features((40, 41), earlier.board) == features((40, 41), other.board)


def test_likelihood_update_known_two_combo_answer(history_payload, monkeypatch):
    request = SensitivityRequest.model_validate(history_payload)
    request.preflop_prior = request.preflop_prior.model_validate(
        {
            "kind": "range",
            "combos": [
                {"cards": [40, 41], "weight": 0.5},
                {"cards": [28, 33], "weight": 0.5},
            ],
        }
    )
    decisions = [replay(request)[0][1]]  # target's preflop check
    monkeypatch.setattr(
        "poker_calculator.application.sensitivity.features",
        lambda cards, board: (0.8 if cards[0] == 40 else 0.2, "other"),
    )
    monkeypatch.setattr(
        "poker_calculator.application.sensitivity.action_probabilities",
        lambda decision, strength, group, bias: {"check": strength},
    )
    combos, _, _, clipped = infer(request, decisions, 0, lambda: None)
    assert clipped == 0
    strong = next(c for c in combos if c.cards == (40, 41))
    assert strong.weight / sum(c.weight for c in combos) == pytest.approx(0.8)
    combos, _, _, _ = infer(request, decisions * 2, 0, lambda: None)
    strong = next(c for c in combos if c.cards == (40, 41))
    assert strong.weight / sum(c.weight for c in combos) == pytest.approx(16 / 17)


def test_actions_normalize_and_board_only_hand_not_all_value(history_payload):
    decision = replay(SensitivityRequest.model_validate(history_payload))[0][-1]
    for bias in [-3, 0, 3]:
        probabilities = action_probabilities(decision, 0.2, "other", bias)
        assert sum(probabilities.values()) == pytest.approx(1)
        assert all(0 < p < 1 for p in probabilities.values())
    assert features((0, 5), (32, 36, 40, 44, 48))[1] != "value"


def test_history_batch_matches_single_analysis_and_reproducible(history_payload):
    request = SensitivityRequest.model_validate(history_payload)
    result = run_sensitivity(request, AnalysisServices())
    repeated = run_sensitivity(request, AnalysisServices())
    assert all(o.status == "ok" for o in result.outcomes)
    assert [o.result.equity for o in result.outcomes] == [
        o.result.equity for o in repeated.outcomes
    ]
    assert len({tuple(c.weight for c in o.combos) for o in result.outcomes}) > 1
    assert all(o.result.call_ev is None for o in result.outcomes)
    assert result.outcomes[0].equity_delta == 0
    assert all(len(o.traces) == 3 for o in result.outcomes)
    assert all(
        not set(c.cards) & set(request.base_analysis.board)
        for o in result.outcomes
        for c in o.combos
    )
    from poker_calculator.domain.models import AnalysisRequest
    from poker_calculator.strategies.pot_odds import PotOddsStrategy

    first = result.outcomes[0]
    data = request.base_analysis.model_dump()
    data.update(
        opponents=[{"kind": "range", "combos": [c.model_dump() for c in first.combos]}],
        seed=first.result.seed,
    )
    single = PotOddsStrategy().analyze(AnalysisRequest.model_validate(data), AnalysisServices())
    assert single.equity == first.result.equity


def manual_request():
    return SensitivityRequest.model_validate(
        {
            "mode": "manual",
            "target_seat": 1,
            "opponent_seats": [1],
            "base_analysis": {
                "hero": [48, 49],
                "board": [4, 9, 14, 19, 24],
                "opponents": [{"kind": "random"}],
                "samples": 1000,
                "settlement_assumption": "showdownAfterCall",
            },
            "scenarios": [
                {
                    "id": "baseline",
                    "name": "基准",
                    "current_range": {"kind": "range", "text": "KK"},
                },
                {"id": "same", "name": "相同", "current_range": {"kind": "range", "text": "KK"}},
                {"id": "bad", "name": "阻断", "current_range": {"kind": "range", "text": "AsAh"}},
            ],
        }
    )


def test_manual_dedup_partial_and_ev():
    services = AnalysisServices()
    result = run_sensitivity(manual_request(), services)
    assert [o.status for o in result.outcomes] == ["ok", "ok", "error"]
    assert len(services.cache) == 1
    assert result.outcomes[1].equity_delta == 0
    assert result.outcomes[0].result.call_ev is not None
    assert "未完整" in result.summary


@pytest.mark.parametrize("cancel", [True, False])
def test_cancellation_and_budget_cover_entire_batch(cancel):
    services = AnalysisServices(
        cancelled=lambda: cancel, deadline=None if cancel else time.monotonic() - 1
    )
    result = run_sensitivity(manual_request(), services)
    assert all(o.status == ("cancelled" if cancel else "timed-out") for o in result.outcomes)


def test_underflow_and_blinds_do_not_change_prior(history_payload):
    request = SensitivityRequest.model_validate(history_payload)
    request.preflop_prior = request.preflop_prior.model_validate(
        {
            "kind": "range",
            "combos": [
                {"cards": [40, 41], "weight": 1},
                {"cards": [28, 33], "weight": 0.1},
            ],
        }
    )
    combos, traces, _, _ = infer(request, [], 0, lambda: None)
    assert not traces
    by_cards = {c.cards: c.weight for c in combos}
    assert by_cards[(28, 33)] / by_cards[(40, 41)] == pytest.approx(0.1)
    decisions = [replay(request)[0][1]] * 500
    try:
        combos, _, _, _ = infer(request, decisions, 0, lambda: None)
        assert all(math.isfinite(c.weight) for c in combos)
    except ValueError as exc:
        assert "精度" in str(exc)


def test_sensitivity_real_process_api_lifecycle(history_payload):
    with TestClient(create_app()) as client:
        created = client.post("/api/v1/sensitivity-analyses", json=history_payload)
        assert created.status_code == 202
        task_id = created.json()["task_id"]
        assert client.get(f"/api/v1/analyses/{task_id}").status_code == 404
        for _ in range(200):
            response = client.get(f"/api/v1/sensitivity-analyses/{task_id}")
            snapshot = response.json()
            if snapshot["status"] not in ("queued", "running", "cancelling"):
                break
            time.sleep(0.025)
        assert snapshot["status"] == "succeeded", snapshot
        assert snapshot["completion"] == "complete"
        assert len(snapshot["result"]["outcomes"]) == 3
        assert client.post(f"/api/v1/sensitivity-analyses/{task_id}/cancel").status_code == 200
        task_service = client.app.state.tasks
        task_service.tasks[task_id].finished_at = time.monotonic() - task_service.ttl_seconds - 1
        expired = client.get(f"/api/v1/sensitivity-analyses/{task_id}").json()
        assert expired["status"] == "expired"
        assert expired["result"] is None
        assert client.get("/api/v1/sensitivity-analyses/missing").status_code == 404


def test_cutoff_does_not_read_later_actions(history_payload):
    events = history_payload["history_context"]["events"]
    extra = copy.deepcopy(events[-1])
    extra.update(sequence=10, action="fold", player=0)
    events.append(extra)  # Beyond the requested prefix; not evidence for this snapshot.
    decisions, _ = replay(SensitivityRequest.model_validate(history_payload))
    assert decisions[-1].event.sequence == 9


def test_inference_cancellation_preserves_completed_scene(monkeypatch):
    from poker_calculator.strategies.pot_odds import PotOddsStrategy

    original = PotOddsStrategy.analyze
    cancelled = False

    def analyze(self, request, services):
        nonlocal cancelled
        result = original(self, request, services)
        cancelled = True
        return result

    monkeypatch.setattr(PotOddsStrategy, "analyze", analyze)
    result = run_sensitivity(manual_request(), AnalysisServices(cancelled=lambda: cancelled))
    assert [o.status for o in result.outcomes] == ["ok", "cancelled", "cancelled"]
    assert result.outcomes[0].result is not None


def test_blinds_only_deduplicates_all_scenes(history_payload):
    history_payload["history_context"]["cutoff_sequence"] = 2
    base = history_payload["base_analysis"]
    base.update(
        board=[],
        pot_before_call=15,
        call_amount=5,
        pot_context={"contributions": [5, 10], "folded_contributions": []},
        equity_method="monteCarlo",
    )
    services = AnalysisServices()
    result = run_sensitivity(SensitivityRequest.model_validate(history_payload), services)
    assert all(o.status == "ok" and not o.traces for o in result.outcomes)
    assert len(services.cache) == 1
    assert all(o.equity_delta == 0 for o in result.outcomes)


def test_different_street_prefix_and_mapping_rejected(history_payload):
    history_payload["history_context"]["events"][-2]["board"][0] = 5
    with pytest.raises(ValueError, match="前缀"):
        replay(SensitivityRequest.model_validate(history_payload))


def test_history_current_range_cannot_double_apply_evidence(history_payload):
    history_payload["scenarios"] = [
        {
            "id": "baseline",
            "name": "基准",
            "current_range": {"kind": "range", "text": "KK"},
        }
    ]
    with pytest.raises(ValueError, match="重复"):
        SensitivityRequest.model_validate(history_payload)


def test_folded_seat_is_not_an_opponent_index(history_payload):
    payload = copy.deepcopy(history_payload)
    payload.update(target_seat=2, opponent_seats=[2])
    payload["base_analysis"].update(
        board=[],
        call_amount=0,
        pot_before_call=25,
        pot_context={"contributions": [10, 10], "folded_contributions": [5]},
    )
    h = payload["history_context"]
    h.update(count=3, opening_seats=[0, 1, 2], stacks=[1000] * 3, cutoff_sequence=5)
    h["events"] = [
        {**h["events"][0], "player": 1, "activePlayersBefore": 3},
        {**h["events"][1], "player": 2, "activePlayersBefore": 3},
        {**h["events"][2], "amount": 10, "toCall": 10, "potAfter": 25, "activePlayersBefore": 3},
        {
            **h["events"][3],
            "player": 1,
            "action": "fold",
            "streetTotal": 5,
            "totalCommitted": 5,
            "toCall": 5,
            "potBefore": 25,
            "potAfter": 25,
            "activePlayersBefore": 3,
        },
        {**h["events"][3], "sequence": 5, "player": 2, "potBefore": 25, "potAfter": 25},
    ]
    decisions, _ = replay(SensitivityRequest.model_validate(payload))
    assert decisions[-1].event.player == 2
    assert decisions[-1].event.activePlayersBefore == 2


def test_short_big_blind_all_in_is_not_a_raise(history_payload):
    payload = copy.deepcopy(history_payload)
    payload["base_analysis"].update(
        board=[],
        call_amount=0,
        pot_before_call=9,
        pot_context={"contributions": [5, 4], "folded_contributions": []},
    )
    h = payload["history_context"]
    h.update(stacks=[1000, 4], cutoff_sequence=2, events=h["events"][:2])
    h["events"][1].update(amount=4, streetTotal=4, totalCommitted=4, potAfter=9)
    decisions, _ = replay(SensitivityRequest.model_validate(payload))
    assert decisions == []
