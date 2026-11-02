import pytest
from pydantic import ValidationError

from poker_calculator.application.services import AnalysisServices
from poker_calculator.domain.models import AnalysisRequest
from poker_calculator.engines.equity import calculate_equity
from poker_calculator.strategies.registry import get_strategy


def request(**changes: object) -> AnalysisRequest:
    data: dict[str, object] = {
        "hero": [44, 45],  # KK loses main to AA, beats QQ for side
        "board": [0, 5, 22, 31, 32],
        "opponents": [{"kind": "exact", "cards": [48, 49]}, {"kind": "exact", "cards": [40, 41]}],
        "pot_before_call": 400,
        "call_amount": 100,
        "settlement_assumption": "showdownAfterCall",
        "pot_context": {"contributions": [100, 100, 200], "betting_closed_after_call": True},
    }
    return AnalysisRequest.model_validate({**data, **changes})


@pytest.mark.parametrize("weighted", [False, True])
@pytest.mark.parametrize("method", ["auto", "monteCarlo"])
def test_lose_main_win_side_on_same_deal(weighted: bool, method: str) -> None:
    req = request(equity_method=method, samples=1000)
    if weighted:
        req = request(
            equity_method=method,
            samples=1000,
            opponents=[
                {"kind": "range", "combos": [{"cards": [48, 49], "weight": 0.5}]},
                {"kind": "exact", "cards": [40, 41]},
            ],
        )
    result = get_strategy("pot-odds").analyze(req, AnalysisServices())
    assert result.lose_probability == 1
    assert [p.amount for p in result.pots] == [300, 200]
    assert [p.eligible for p in result.pots] == [[0, 1, 2], [0, 2]]
    assert [p.equity for p in result.pots] == [0, 1]
    assert result.equity == pytest.approx(0.4)
    assert result.expected_return == 200
    assert result.call_ev == 100
    assert result.break_even_equity == 0.2
    assert result.pot_odds_ratio == "4:1"
    if method == "monteCarlo":
        assert result.equity_standard_error == pytest.approx(0, abs=1e-8)


def test_short_hero_cannot_win_side_and_refunds_are_separate() -> None:
    result = get_strategy("pot-odds").analyze(
        request(
            hero=[48, 49],
            opponents=[{"kind": "exact", "cards": [44, 45]}, {"kind": "exact", "cards": [40, 41]}],
            call_amount=0,
            pot_before_call=650,
            pot_context={"contributions": [100, 200, 350]},
        ),
        AnalysisServices(),
    )
    assert [p.amount for p in result.pots] == [300, 200, 150]
    assert [p.equity for p in result.pots] == [1, 0, 0]
    assert result.pots[-1].is_refund
    assert result.equity == 0.6
    assert result.expected_return == 300
    assert result.call_ev is None


def test_folded_money_counts_without_showdown_eligibility_and_layers_merge() -> None:
    result = calculate_equity(
        request(
            pot_before_call=450,
            call_amount=0,
            pot_context={"contributions": [100, 100, 200], "folded_contributions": [50]},
        )
    )
    assert [p.amount for p in result.pots] == [350, 100]
    assert result.pots[0].eligible == [0, 1, 2]
    assert result.pots[-1].is_refund


def test_ties_split_each_pool_and_hero_refund_is_not_profit() -> None:
    result = get_strategy("pot-odds").analyze(
        request(
            hero=[0, 5],
            board=[32, 36, 40, 44, 48],
            opponents=[{"kind": "exact", "cards": [9, 14]}, {"kind": "exact", "cards": [19, 21]}],
            pot_before_call=650,
            call_amount=0,
            pot_context={"contributions": [350, 100, 200]},
        ),
        AnalysisServices(),
    )
    assert [p.expected_return for p in result.pots] == [100, 100, 150]
    assert result.expected_return == 350
    assert result.equity == pytest.approx(0.4)
    assert result.call_ev is None


@pytest.mark.parametrize(
    "changes",
    [
        {"pot_context": {"contributions": [100, 100]}},
        {"pot_context": {"contributions": [100, 100, 199]}},
        {"pot_context": {"contributions": [100, 100, -1]}},
        {"pot_context": {"contributions": [100, 100, 200], "folded_contributions": [0] * 7}},
    ],
)
def test_reject_inconsistent_commitments(changes: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        request(**changes)


@pytest.mark.parametrize("future,closed", [(True, True), (False, False)])
def test_incomplete_betting_has_no_ev_or_candidates(future: bool, closed: bool) -> None:
    result = get_strategy("pot-odds").analyze(
        request(
            settlement_assumption="futureBettingPossible" if future else "showdownAfterCall",
            pot_context={"contributions": [100, 100, 200], "betting_closed_after_call": closed},
        ),
        AnalysisServices(),
    )
    assert result.expected_return == 200
    assert result.call_ev is None
    assert result.break_even_equity is None
    assert result.candidates == []


def test_rules_reject_multi_pool_equity_threshold() -> None:
    assert get_strategy("equity-rules").check_support(request()).status == "unsupported"


def test_nonuniform_weighted_range_changes_main_pool_only() -> None:
    req = request(
        opponents=[
            {
                "kind": "range",
                "combos": [
                    {"cards": [48, 49], "weight": 0.75},
                    {"cards": [36, 37], "weight": 0.25},
                ],
            },
            {"kind": "exact", "cards": [40, 41]},
        ]
    )
    result = get_strategy("pot-odds").analyze(req, AnalysisServices())
    assert [p.equity for p in result.pots] == [0.25, 1]
    assert result.expected_return == 275
    assert result.equity == 0.55
    assert result.call_ev == 175


def test_multiple_side_pots_and_ineligible_deeper_pool() -> None:
    result = calculate_equity(
        request(
            opponents=[
                {"kind": "exact", "cards": [48, 49]},
                {"kind": "exact", "cards": [40, 41]},
                {"kind": "exact", "cards": [36, 37]},
            ],
            pot_before_call=1000,
            call_amount=0,
            pot_context={"contributions": [200, 100, 300, 400]},
        )
    )
    assert [p.amount for p in result.pots] == [400, 300, 200, 100]
    assert [p.expected_return for p in result.pots] == [0, 300, 0, 0]
    assert result.equity == pytest.approx(1 / 3)


def test_recorded_single_pool_still_supports_margin_rule() -> None:
    req = request(
        pot_before_call=250,
        call_amount=50,
        pot_context={"contributions": [50, 100, 100], "betting_closed_after_call": True},
    )
    assert get_strategy("equity-rules").check_support(req).status == "supported"
    result = get_strategy("equity-rules").analyze(req, AnalysisServices())
    assert result.call_ev == -50
