import json
from pathlib import Path

import pytest

from poker_calculator.application.services import AnalysisServices
from poker_calculator.domain.models import AnalysisRequest, RangeOpponent
from poker_calculator.engines.equity import CalculationCancelled
from poker_calculator.strategies.history_ranges import HistoryRangeStrategy


def request():
    payload = json.loads(
        (Path(__file__).parents[2] / "examples/history-sensitivity.json").read_text(
            encoding="utf-8"
        )
    )
    base = payload["base_analysis"]
    base.update(
        strategy_id="history-ranges",
        strategies=None,
        samples=1000,
        equity_method="monteCarlo",
        strategy_config={
            "history_context": payload["history_context"],
            "opponent_seats": payload["opponent_seats"],
        },
    )
    return AnalysisRequest.model_validate(base)


def test_history_rebuilds_from_prior_and_undo_does_not_accumulate():
    strategy = HistoryRangeStrategy()
    base = request()
    original = base.model_dump_json()
    assert strategy.check_support(base).status == "supported"
    a = strategy.analyze(base, AnalysisServices())
    b = strategy.analyze(base, AnalysisServices())
    assert a.history_ranges == b.history_ranges
    assert a.equity == b.equity
    assert base.model_dump_json() == original
    summary = a.history_ranges[0]
    assert summary.observed_actions > 0
    assert 0 < summary.effective_combos < summary.combos
    assert 0 <= summary.value_share <= 1


def test_manual_range_is_never_reinterpreted_as_a_preflop_prior():
    base = request()
    base.opponents = [RangeOpponent(kind="range", text="QQ+")]
    support = HistoryRangeStrategy().check_support(base)
    assert support.status == "missing-input"
    assert "保持不变" in support.reasons[0]


def test_tampered_history_and_seat_map_are_rejected():
    base = request()
    base.strategy_config["history_context"]["events"][-1]["potBefore"] += 1
    assert HistoryRangeStrategy().check_support(base).status == "missing-input"
    base = request()
    base.strategy_config["opponent_seats"] = [0]
    assert HistoryRangeStrategy().check_support(base).status == "missing-input"


def test_cancel_before_inference():
    with pytest.raises(CalculationCancelled):
        HistoryRangeStrategy().analyze(request(), AnalysisServices(cancelled=lambda: True))


@pytest.mark.parametrize("manual", [False, True])
def test_multiple_random_opponents_are_updated_without_losing_seats(manual):
    base = request().model_dump()
    events = []
    for seq, (seat, action, amount, highest) in enumerate(
        [(1, "smallBlind", 5, 0), (2, "bigBlind", 10, 5)], 1
    ):
        events.append(
            dict(
                kind="action",
                sequence=seq,
                street=0,
                player=seat,
                action=action,
                amount=amount,
                streetTotal=amount,
                totalCommitted=amount,
                toCall=highest,
                highestBefore=highest,
                minRaiseBefore=10,
                potBefore=highest,
                potAfter=highest + amount,
                activePlayersBefore=3,
            )
        )
    base.update(
        board=[],
        opponents=[{"kind": "random"}, {"kind": "random"}],
        pot_before_call=15,
        call_amount=10,
        pot_context=dict(
            contributions=[0, 5, 10], folded_contributions=[], betting_closed_after_call=False
        ),
    )
    h = base["strategy_config"]["history_context"]
    h.update(
        count=3,
        opening_seats=[0, 1, 2],
        dealer=0,
        stacks=[1000] * 3,
        events=events,
        cutoff_sequence=2,
    )
    base["strategy_config"]["opponent_seats"] = [1, 2]
    if manual:
        base["opponents"][1] = {"kind": "range", "text": "QQ+"}
    result = HistoryRangeStrategy().analyze(
        AnalysisRequest.model_validate(base), AnalysisServices()
    )
    assert [s.seat for s in result.history_ranges] == ([1] if manual else [1, 2])
    assert all(s.observed_actions == 0 for s in result.history_ranges)
    assert result.equity is not None
