"""Numerical regressions for terminal river actions and response consistency."""

import pytest
from pydantic import ValidationError

from poker_calculator.application.services import AnalysisServices
from poker_calculator.domain.models import AnalysisRequest, PotContext
from poker_calculator.engines.equity import CalculationCancelled
from poker_calculator.infrastructure.compute import execute_analysis
from poker_calculator.strategies.river_bet import RiverBetConfig, RiverBetStrategy


def request(**updates):
    return AnalysisRequest.model_validate(
        {
            "hero": [48, 49],  # AA beats KK on this board.
            "board": [0, 5, 22, 31, 32],
            "opponents": [{"kind": "exact", "cards": [44, 45]}],
            "pot_before_call": 100,
            "call_amount": 0,
            "strategy_id": "river-bet",
            "strategy_config": {
                "effective_stack": 200,
                "check_closes_action": True,
                "bets": [{"amount": 50}, {"amount": 100, "fold_probability": 0.5}],
            },
            **updates,
        }
    )


def test_value_bets_use_net_payoff_and_shared_baseline():
    result = RiverBetStrategy().analyze(request(), AnalysisServices())
    assert [c.ev for c in result.candidates] == [100, 150, 150]
    assert len({c.ev_baseline for c in result.candidates}) == 1
    assert result.call_ev is None
    assert "下注 50、下注 100" in result.recommendation


def test_pure_bluff_fold_equity_and_free_check():
    result = RiverBetStrategy().analyze(
        request(hero=[44, 45], opponents=[{"kind": "exact", "cards": [48, 49]}]),
        AnalysisServices(),
    )
    assert [c.ev for c in result.candidates] == [0, -50, 0]
    assert "过牌、下注 100" in result.recommendation


def test_board_ties_are_half_equity_not_wins():
    result = RiverBetStrategy().analyze(
        request(
            hero=[0, 1], board=[32, 36, 40, 44, 48], opponents=[{"kind": "exact", "cards": [4, 5]}]
        ),
        AnalysisServices(),
    )
    assert result.equity == 0.5
    assert result.win_probability == 0
    assert [c.ev for c in result.candidates] == [50, 50, 75]


def test_conditional_calling_range_changes_equity_and_payoff():
    scene = request(
        hero=[44, 45],
        opponents=[{"kind": "range", "text": "AsAh, QsQh"}],
        strategy_config={
            "effective_stack": 50,
            "check_closes_action": True,
            "bets": [{"amount": 50, "fold_probability": 0.5, "calling_range": "AsAh"}],
        },
        equity_method="monteCarlo",
    )
    result = RiverBetStrategy().analyze(scene, AnalysisServices())
    assert result.method == "exact"
    assert result.equity == 0.5
    assert result.candidates[0].ev == 50
    assert result.candidates[1].showdown_equity == 0
    assert result.candidates[1].ev == 25
    assert "过牌的 EV 最高" in result.recommendation


def test_all_fold_needs_no_conditional_equity():
    scene = request(
        strategy_config={
            "effective_stack": 50,
            "check_closes_action": True,
            "bets": [{"amount": 50, "fold_probability": 1, "calling_range": "AsAh"}],
        }
    )
    result = RiverBetStrategy().analyze(scene, AnalysisServices())
    assert result.candidates[1].ev == 100
    assert result.candidates[1].showdown_equity is None


@pytest.mark.parametrize(
    "updates, text",
    [
        ({"board": [0, 5, 22, 31]}, "河牌"),
        ({"call_amount": 10}, "需跟注"),
        ({"opponents": [{"kind": "random"}, {"kind": "random"}]}, "一名"),
        ({"pot_before_call": 0}, "底池必须"),
        ({"pot_context": PotContext(contributions=[30, 70])}, "边池"),
    ],
)
def test_unsupported_decisions(updates, text):
    support = RiverBetStrategy().check_support(request(**updates))
    assert support.status == "unsupported"
    assert text in "；".join(support.reasons)


def test_missing_inputs_and_stack_limit():
    for config, text in [
        ({}, "有效筹码"),
        ({"effective_stack": 200}, "过牌"),
        ({"effective_stack": 10, "check_closes_action": True}, "超过有效筹码"),
    ]:
        support = RiverBetStrategy().check_support(request(strategy_config=config))
        assert support.status == "missing-input"
        assert text in "；".join(support.reasons)


@pytest.mark.parametrize(
    "config",
    [
        {"bets": []},
        {"bets": [{"amount": 1}, {"amount": 1}]},
        {"bets": [{"amount": 0}]},
        {"bets": [{"amount": 1.5}]},
        {"bets": [{"amount": 1, "fold_probability": 1.1}]},
        {"bets": [{"amount": 1, "fold_probability": float("nan")}]},
        {"bets": [{"amount": 1, "calling_range": "invalid"}]},
        {"unexpected": True},
    ],
)
def test_reject_invalid_config(config):
    with pytest.raises(ValidationError):
        RiverBetConfig.model_validate(config)


@pytest.mark.parametrize(
    "calling_range, fold, text",
    [
        ("AsAh", 0.1, "不一致"),
        ("JsJh", 0.9, "子集"),
        ("KsKh", 0.9, "阻断"),
    ],
)
def test_incoherent_or_blocked_response_rejected(calling_range, fold, text):
    scene = request(
        hero=[44, 45],
        opponents=[{"kind": "range", "text": "AsAh, QsQh"}],
        strategy_config={
            "effective_stack": 50,
            "check_closes_action": True,
            "bets": [{"amount": 50, "fold_probability": fold, "calling_range": calling_range}],
        },
    )
    support = RiverBetStrategy().check_support(scene)
    assert support.status == "missing-input"
    assert text in "；".join(support.reasons)


def test_cancellation_is_not_swallowed():
    with pytest.raises(CalculationCancelled):
        RiverBetStrategy().analyze(request(), AnalysisServices(cancelled=lambda: True))


def test_safe_integer_pot_limit():
    support = RiverBetStrategy().check_support(request(pot_before_call=9_007_199_254_740_990))
    assert support.status == "missing-input"
    assert "安全整数" in "；".join(support.reasons)


def test_multiple_strategies_preserve_baseline_on_unsupported_river():
    class Flag:
        def is_set(self):
            return False

    data = execute_analysis(
        request(
            call_amount=10,
            strategies=[
                {"id": "pot-odds"},
                {"id": "river-bet"},
            ],
        ).model_dump(),
        {},
        Flag(),
        30,
    )
    assert [o["status"] for o in data["outcomes"]] == ["ok", "unsupported"]
    assert data["completion"] == "partial"
