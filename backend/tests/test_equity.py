import math

import pytest
from pydantic import ValidationError

from poker_calculator.application.services import AnalysisServices
from poker_calculator.domain.models import AnalysisRequest
from poker_calculator.engines.equity import (
    CalculationCancelled,
    CalculationTimeout,
    calculate_equity,
)
from poker_calculator.engines.evaluator import evaluate
from poker_calculator.strategies.registry import get_strategy


def cards(text: str) -> list[int]:
    ranks, suits = "23456789TJQKA", "shcd"
    return [ranks.index(token[0]) * 4 + suits.index(token[1]) for token in text.split()]


def scenario(**changes: object) -> AnalysisRequest:
    data: dict[str, object] = {
        "hero": cards("As Ah"),
        "board": cards("2s 3h 7c 9d Ts"),
        "opponents": [{"kind": "exact", "cards": cards("Ks Kh")}],
        "pot_before_call": 150,
        "call_amount": 50,
        "settlement_assumption": "showdownAfterCall",
    }
    data.update(changes)
    return AnalysisRequest.model_validate(data)


def test_evaluator_rank_encoding_and_wheel() -> None:
    wheel = evaluate(cards("As 2h 3c 4d 5s 9h Tc"))
    six_high = evaluate(cards("2s 3h 4c 5d 6s 9c Th"))
    trips = evaluate(cards("As Ah Ac 2d 3s 9c Th"))
    assert six_high < wheel < trips
    assert evaluate(cards("As Ah 9c 8d 7s 2c 3h")) < evaluate(cards("Ks Kh 9c 8d 7s 2c 3h"))


def test_exact_river_win_and_pot_ev() -> None:
    request = scenario()
    equity = calculate_equity(request)
    assert equity.method == "exact"
    assert equity.win_probability == equity.equity == 1
    assert equity.tie_probability == equity.lose_probability == 0
    assert equity.sample_count == 1
    result = get_strategy("pot-odds").analyze(request, AnalysisServices())
    assert result.pot_odds_ratio == "3:1"
    assert result.break_even_equity == 0.25
    assert result.call_ev == 150


def test_royal_flush_board_three_way_split() -> None:
    request = scenario(
        hero=cards("2s 3h"),
        board=cards("Ts Js Qs Ks As"),
        opponents=[
            {"kind": "exact", "cards": cards("4h 5c")},
            {"kind": "exact", "cards": cards("6d 7h")},
        ],
    )
    result = calculate_equity(request)
    assert result.tie_probability == 1
    assert result.equity == pytest.approx(1 / 3)
    assert result.win_probability == result.lose_probability == 0


def test_exact_turn_and_dead_cards_change_state_count() -> None:
    request = scenario(board=cards("2s 3h 7c 9d"), dead_cards=cards("Ts"))
    result = calculate_equity(request)
    assert result.sample_count == 43
    assert math.isclose(
        result.win_probability + result.tie_probability + result.lose_probability, 1
    )


def test_monte_carlo_reproducible_and_agrees_with_exact() -> None:
    # Preflop is too large to enumerate. Independent exact river test above provides an oracle.
    request = scenario(board=[], samples=5_000)
    first = calculate_equity(request)
    second = calculate_equity(request)
    assert first.method == "monteCarlo"
    assert first.equity == second.equity
    assert 0.78 < first.equity < 0.86
    assert first.sample_count == 5_000
    assert first.equity_standard_error is not None


def test_zero_call_and_future_betting_assumption() -> None:
    request = scenario(call_amount=0)
    result = get_strategy("pot-odds").analyze(request, AnalysisServices())
    assert result.pot_odds_ratio is result.break_even_equity is result.call_ev is None
    future = scenario(settlement_assumption="futureBettingPossible")
    result = get_strategy("pot-odds").analyze(future, AnalysisServices())
    assert result.call_ev == 150
    assert result.recommendation is None
    assert any("参考值" in item for item in result.assumptions)


def test_monte_carlo_matches_exact_on_same_turn(monkeypatch: pytest.MonkeyPatch) -> None:
    request = scenario(board=cards("2s 3h 7c 9d"), samples=10_000)
    exact = calculate_equity(request)
    monkeypatch.setattr("poker_calculator.engines.equity.EXACT_LIMIT", 0)
    sampled = calculate_equity(request)
    assert sampled.equity_standard_error is not None
    assert abs(sampled.equity - exact.equity) <= 4 * sampled.equity_standard_error


@pytest.mark.parametrize(
    "changes",
    [
        {"hero": cards("As As")},
        {"board": cards("As 2h 3c")},
        {"board": cards("2s")},
        {"dead_cards": cards("Kh")},
        {"opponents": []},
        {"hero": [True, 1]},
        {"hero": [52, 1]},
        {"call_amount": -1},
        {"call_amount": 1.5},
        {"samples": 1_000_000_000},
        {"pot_before_call": 9_007_199_254_740_991, "call_amount": 1},
        {"call_amount": 151},
        {"unknown_property": 1},
    ],
)
def test_invalid_scenarios_rejected(changes: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        scenario(**changes)


def test_insufficient_deck_rejected() -> None:
    with pytest.raises(ValidationError, match="剩余牌不足"):
        scenario(
            board=[],
            opponents=[{"kind": "random"} for _ in range(8)],
            dead_cards=[card for card in range(40) if card not in cards("As Ah")],
        )


def test_cancellation_and_deadline() -> None:
    with pytest.raises(CalculationCancelled):
        calculate_equity(scenario(), cancelled=lambda: True)
    with pytest.raises(CalculationTimeout):
        calculate_equity(scenario(), time_limit=-1)
