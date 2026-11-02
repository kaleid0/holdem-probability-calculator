import copy
import json
from pathlib import Path

import pytest

from poker_calculator.application.services import AnalysisServices
from poker_calculator.domain.models import AnalysisRequest
from poker_calculator.engines.equity import CalculationCancelled
from poker_calculator.strategies.postflop_tree import PostflopTreeStrategy


def payload(flop=False):
    source = json.loads(
        (Path(__file__).parents[2] / "examples/history-sensitivity.json").read_text(
            encoding="utf-8"
        )
    )
    base, h = source["base_analysis"], source["history_context"]
    if flop:
        event = copy.deepcopy(h["events"][3])
        event.update(
            sequence=6,
            street=3,
            streetTotal=0,
            totalCommitted=10,
            highestBefore=0,
            potBefore=20,
            potAfter=20,
        )
        h.update(events=h["events"][:5] + [event], cutoff_sequence=6)
        base.update(
            board=base["board"][:3],
            pot_before_call=20,
            call_amount=0,
            pot_context={
                "contributions": [10, 10],
                "folded_contributions": [],
                "betting_closed_after_call": True,
            },
        )
    base.update(
        strategy_id="postflop-tree",
        samples=1000,
        equity_method="monteCarlo",
        strategy_config={"history_context": h, "opponent_seats": [1]},
    )
    return base


@pytest.mark.parametrize("flop", [False, True])
def test_actions_shared_budget_reproducibility_and_bounds(flop):
    request = AnalysisRequest.model_validate(payload(flop))
    strategy = PostflopTreeStrategy()
    assert strategy.check_support(request).status == "supported"
    a = strategy.analyze(request, AnalysisServices())
    b = strategy.analyze(request, AnalysisServices())
    assert a.candidates == b.candidates
    assert a.sample_count == 3000
    assert len(a.limited_tree.scenarios) == 3
    assert [c.action for c in a.candidates] == (
        ["check", "bet", "bet", "bet"] if flop else ["fold", "call"]
    )
    assert a.candidates[0].ev_delta == 0
    assert a.candidates[0].delta_standard_error == 0
    for c in a.candidates:
        assert c.ev_min <= c.ev <= c.ev_max
        assert c.ev_standard_error >= 0
    assert a.call_ev is None  # Never confuse a rollout with the direct-showdown reference.


def test_exact_manual_ranges_and_stack_caps():
    data = payload(True)
    data["opponents"] = [{"kind": "exact", "cards": [40, 41]}]
    data["strategy_config"]["history_context"]["stacks"] = [18, 18]
    result = PostflopTreeStrategy().analyze(
        AnalysisRequest.model_validate(data), AnalysisServices()
    )
    assert all(c.amount <= 8 for c in result.candidates)
    data["opponents"] = [{"kind": "range", "text": "QQ"}]
    result = PostflopTreeStrategy().analyze(
        AnalysisRequest.model_validate(data), AnalysisServices()
    )
    assert result.limited_tree is not None


def test_payoff_accounting_with_deterministic_win_and_response(monkeypatch):
    data = payload(True)
    data["opponents"] = [{"kind": "exact", "cards": [40, 41]}]
    monkeypatch.setattr(
        "poker_calculator.strategies.postflop_tree.features", lambda cards, board: (1.0, "value")
    )
    monkeypatch.setattr("poker_calculator.strategies.postflop_tree.sigmoid", lambda _: 1.0)
    monkeypatch.setattr(
        "poker_calculator.strategies.postflop_tree.evaluate",
        lambda cards: 1 if cards[0] == 48 else 2,
    )
    result = PostflopTreeStrategy().analyze(
        AnalysisRequest.model_validate(data), AnalysisServices()
    )
    # Check -> pot 20 -> villain bets 10 -> hero calls and wins: 40 - 10 = 30.
    assert result.candidates[0].ev == 30
    for c in result.candidates[1:]:
        b = c.amount
        # Current bet b called, next bet half of 20+2b also called.
        assert c.ev == 20 + b + (20 + 2 * b + 1) // 2
        assert c.ev_standard_error == 0


@pytest.mark.parametrize("mutation", ["position", "history", "pending", "mapping"])
def test_unsupported_or_tampered_context_is_rejected(mutation):
    data = payload()
    h = data["strategy_config"]["history_context"]
    if mutation == "position":
        h["dealer"] = 1
    elif mutation == "history":
        h["events"][-1]["potBefore"] += 1
    elif mutation == "pending":
        h["cutoff_sequence"] -= 1
    else:
        data["strategy_config"]["opponent_seats"] = [0]
    assert (
        PostflopTreeStrategy().check_support(AnalysisRequest.model_validate(data)).status
        != "supported"
    )


def test_cooperative_cancel():
    with pytest.raises(CalculationCancelled):
        PostflopTreeStrategy().analyze(
            AnalysisRequest.model_validate(payload()), AnalysisServices(cancelled=lambda: True)
        )


def test_no_illegal_under_minimum_bet_to_cover_a_short_opponent():
    data = payload(True)
    data["strategy_config"]["history_context"]["stacks"] = [1000, 18]
    result = PostflopTreeStrategy().analyze(
        AnalysisRequest.model_validate(data), AnalysisServices()
    )
    assert [c.action for c in result.candidates] == ["check"]
