import copy
import json
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from poker_calculator.api.main import create_app
from poker_calculator.application.river_inference import automatic_amounts
from poker_calculator.application.services import AnalysisServices
from poker_calculator.domain.models import AnalysisRequest
from poker_calculator.engines.equity import CalculationCancelled
from poker_calculator.strategies.river_bet import RiverBetStrategy


@pytest.fixture
def payload():
    data = json.loads(
        (Path(__file__).resolve().parents[2] / "examples/river-auto-analysis.json").read_text(
            encoding="utf-8"
        )
    )
    data["strategy_id"] = "river-bet"
    data["strategy_config"] = data.pop("strategies")[0]["config"]
    return data


def test_auto_resolves_stacks_closure_and_coherent_responses(payload):
    scene = AnalysisRequest.model_validate(payload)
    strategy = RiverBetStrategy()
    assert strategy.check_support(scene).status == "supported"
    result = strategy.analyze(scene, AnalysisServices())
    assert result.inference.effective_stack == 910
    assert result.inference.cutoff_sequence == 12
    assert result.inference.observed_actions == 4
    assert result.inference.posterior_combos == 990
    assert [c.amount for c in result.candidates] == [0, 60, 90, 135, 180, 270, 910]
    assert result.model_version == "history-river-response-v2"
    assert result.strategy_config["check_closes_action"] is True
    assert "history_context" not in result.strategy_config
    for c in result.candidates[1:]:
        f, e, b = c.fold_probability, c.showdown_equity, c.amount
        assert 0 < f < 1 and 0 <= e <= 1
        assert c.ev == pytest.approx(f * 180 + (1 - f) * (e * (180 + 2 * b) - b))
    assert len({round(c.fold_probability, 8) for c in result.candidates[1:]}) > 1
    assert len(result.inference.scenarios) == 3
    assert sum(c.probability for c in result.inference.range_classes) == pytest.approx(1)
    assert 1 <= result.inference.effective_combos <= result.inference.posterior_combos
    for c in result.candidates:
        assert c.ev_min <= c.ev <= c.ev_max
        assert c.ev_delta == pytest.approx(c.ev - result.candidates[0].ev)
        if c.action == "bet":
            assert c.ev == pytest.approx(c.fold_return + c.call_return)


def test_missing_history_does_not_fabricate_facts(payload):
    del payload["strategy_config"]["history_context"]
    support = RiverBetStrategy().check_support(AnalysisRequest.model_validate(payload))
    assert support.status == "missing-input"
    assert "完整本手历史" in support.reasons[0]


@pytest.mark.parametrize("mutation", ["stack", "pot", "amount", "prefix", "sequence", "mapping"])
def test_corrupt_history_is_rejected(payload, mutation):
    h = payload["strategy_config"]["history_context"]
    if mutation == "stack":
        h["stacks"] = None
    elif mutation == "pot":
        h["events"][-1]["potBefore"] += 1
    elif mutation == "amount":
        h["events"][9]["amount"] += 1
    elif mutation == "prefix":
        h["events"][-2]["board"][0] = 7
    elif mutation == "sequence":
        h["events"][-1]["sequence"] += 1
    else:
        payload["strategy_config"]["opponent_seats"] = [2]
    support = RiverBetStrategy().check_support(AnalysisRequest.model_validate(payload))
    assert support.status == "missing-input"


def test_not_hero_turn_cannot_claim_check_closes_action(payload):
    h = payload["strategy_config"]["history_context"]
    h["events"] = h["events"][:-1]
    h["cutoff_sequence"] -= 1
    payload["pot_context"]["betting_closed_after_call"] = False
    payload["strategy_config"]["check_closes_action"] = True  # Do not trust client claims.
    support = RiverBetStrategy().check_support(AnalysisRequest.model_validate(payload))
    assert support.status == "missing-input"
    assert "最后行动" in support.reasons[0]


def test_current_range_is_not_double_counted(payload):
    strategy = RiverBetStrategy()
    original = strategy.analyze(AnalysisRequest.model_validate(payload), AnalysisServices())
    payload["opponents"] = [{"kind": "range", "text": "KK"}]
    result = strategy.analyze(AnalysisRequest.model_validate(payload), AnalysisServices())
    assert result.equity == original.equity
    assert [c.ev for c in result.candidates] == [c.ev for c in original.candidates]
    assert any("不叠加当前范围" in w for w in result.inference.warnings)


def test_exact_cards_are_fixed_and_model_cannot_see_hero_cards(payload):
    payload["opponents"] = [{"kind": "exact", "cards": [44, 45]}]
    first = RiverBetStrategy().analyze(AnalysisRequest.model_validate(payload), AnalysisServices())
    payload["hero"] = [40, 41]
    second = RiverBetStrategy().analyze(AnalysisRequest.model_validate(payload), AnalysisServices())
    assert first.inference.posterior_combos == second.inference.posterior_combos == 1
    assert [c.fold_probability for c in first.candidates] == [
        c.fold_probability for c in second.candidates
    ]
    assert first.equity != second.equity


def test_prior_and_observed_actions_affect_inference(payload):
    strategy = RiverBetStrategy()
    first = strategy.analyze(AnalysisRequest.model_validate(payload), AnalysisServices())
    payload["strategy_config"]["preflop_prior"] = "KK"
    second = strategy.analyze(AnalysisRequest.model_validate(payload), AnalysisServices())
    assert first.equity != second.equity
    assert second.inference.posterior_combos == 6
    assert any("#12" in e for e in first.inference.evidence)


def test_future_events_are_not_used(payload):
    original = RiverBetStrategy().analyze(
        AnalysisRequest.model_validate(payload), AnalysisServices()
    )
    h = payload["strategy_config"]["history_context"]
    future = copy.deepcopy(h["events"][-1])
    future.update(sequence=13, player=0, action="bet", amount=900)
    h["events"].append(future)  # Beyond the declared cutoff; never behavioral evidence.
    result = RiverBetStrategy().analyze(AnalysisRequest.model_validate(payload), AnalysisServices())
    assert [c.ev for c in result.candidates] == [c.ev for c in original.candidates]


def test_automatic_sizes_respect_minimum_short_allin_and_uniqueness():
    assert automatic_amounts(180, 40, 10) == [40]
    assert automatic_amounts(20, 3, 10) == [3]
    assert automatic_amounts(1, 100, 10) == [10, 100]
    assert automatic_amounts(180, 910, 10) == [60, 90, 135, 180, 270, 910]


def test_auto_obeys_cancellation(payload):
    with pytest.raises(CalculationCancelled):
        RiverBetStrategy().analyze(
            AnalysisRequest.model_validate(payload), AnalysisServices(cancelled=lambda: True)
        )


@pytest.mark.parametrize("opponent", [{"kind": "exact", "cards": [4, 5]}, {"kind": "random"}])
def test_board_split_has_no_false_bluff_profit(payload, opponent):
    board = [32, 36, 40, 44, 48]
    payload.update(hero=[0, 1], board=board, opponents=[opponent])
    payload["strategy_config"]["history_context"]["stacks"] = [1_000_000_000] * 2
    for e in payload["strategy_config"]["history_context"]["events"]:
        if e["kind"] == "street":
            e["board"] = board[: e["street"]]
    result = RiverBetStrategy().analyze(AnalysisRequest.model_validate(payload), AnalysisServices())
    assert result.equity == 0.5
    assert all(c.ev == pytest.approx(90, abs=1e-8) for c in result.candidates)
    assert all(c.fold_probability == 0 for c in result.candidates[1:])
    assert result.inference.stable_amounts == [c.amount for c in result.candidates]


def test_sensitive_advice_is_not_reported_as_stable(payload, monkeypatch):
    from poker_calculator.application.river_response import PublicRiverStrength

    public = PublicRiverStrength(payload["board"], lambda: None)
    split = (public.strength((48, 49)).equity + public.strength((40, 41)).equity) / 2

    def response(strength, pot, amount, shift=0):
        if shift == 0:
            return 0.5
        return float(strength.equity > split if shift < 0 else strength.equity < split)

    monkeypatch.setattr("poker_calculator.application.river_response.call_probability", response)
    payload["hero"] = [44, 45]
    payload["strategy_config"]["preflop_prior"] = "AsAh, QsQh"
    result = RiverBetStrategy().analyze(AnalysisRequest.model_validate(payload), AnalysisServices())
    assert result.inference.stable_amounts == []
    assert "建议随" in result.inference.sensitivity_summary
    assert result.inference.scenarios[1].best_amounts == [0]
    assert result.inference.scenarios[2].best_amounts == [910]


def test_failed_alternative_keeps_baseline_without_claiming_stability(payload, monkeypatch):
    from poker_calculator.application.river_inference import infer

    def inference(request, decisions, bias, checkpoint):
        if bias < 0:
            raise ValueError("后验精度不足")
        return infer(request, decisions, bias, checkpoint)

    monkeypatch.setattr("poker_calculator.application.river_inference.infer", inference)
    result = RiverBetStrategy().analyze(AnalysisRequest.model_validate(payload), AnalysisServices())
    assert [s.status for s in result.inference.scenarios] == ["ok", "insufficient-data", "ok"]
    assert len(result.candidates) == 7
    assert result.inference.stable_amounts == []
    assert "部分情景未完成" in result.inference.sensitivity_summary
    assert result.inference.scenarios[1].best_ev is None


def test_real_process_api_returns_inference_metadata(payload):
    with TestClient(create_app()) as client:
        response = client.post("/api/v1/analyses", json=payload)
        assert response.status_code == 202
        task_id = response.json()["task_id"]
        for _ in range(200):
            snapshot = client.get(f"/api/v1/analyses/{task_id}").json()
            if snapshot["status"] not in ("queued", "running", "cancelling"):
                break
            time.sleep(0.05)
        assert snapshot["status"] == "succeeded", snapshot
        assert snapshot["result"]["inference"]["effective_stack"] == 910
