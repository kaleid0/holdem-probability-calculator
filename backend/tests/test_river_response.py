import pytest

from poker_calculator.application.river_response import (
    PublicRiverStrength,
    call_probability,
    summarize_range,
)
from poker_calculator.domain.models import AnalysisRequest, WeightedCombo
from poker_calculator.engines.equity import CalculationCancelled, calculate_equity


@pytest.mark.parametrize(
    "board,cards",
    [
        ([4, 9, 14, 19, 24], (48, 49)),
        ([4, 9, 14, 19, 24], (0, 1)),
        ([32, 36, 40, 44, 48], (0, 1)),
        ([0, 1, 20, 21, 48], (44, 45)),
    ],
)
def test_blocker_adjusted_strength_matches_independent_enumeration(board, cards):
    model = PublicRiverStrength(board, lambda: None)
    strength = model.strength(cards)
    oracle = calculate_equity(
        AnalysisRequest(
            hero=cards,
            board=board,
            opponents=[{"kind": "random"}],
        )
    )
    assert strength.equity == pytest.approx(oracle.equity)
    assert strength.cannot_lose == (oracle.lose_probability == 0)
    assert strength.cannot_win == (oracle.equity == 0)


def test_board_royal_flush_never_folds_a_guaranteed_split():
    strength = PublicRiverStrength([32, 36, 40, 44, 48], lambda: None).strength((0, 1))
    assert strength.equity == 0.5
    for amount in [1, 100, 10000]:
        for shift in [-0.8, 0, 0.8]:
            assert call_probability(strength, 100, amount, shift) == 1


def test_response_tracks_pressure_and_scenario_without_hidden_cards():
    model = PublicRiverStrength([4, 9, 14, 19, 24], lambda: None)
    strength = model.strength((44, 45))
    assert call_probability(strength, 100, 20) > call_probability(strength, 100, 500)
    values = [call_probability(strength, 100, 50, shift) for shift in [-0.8, 0, 0.8]]
    assert 0 < values[0] < values[1] < values[2] < 1


def test_class_probabilities_and_weight_concentration():
    classes, effective = summarize_range(
        [
            WeightedCombo(cards=(48, 49), weight=1),
            WeightedCombo(cards=(50, 51), weight=1),
            WeightedCombo(cards=(44, 45), weight=0.5),
        ]
    )
    assert [(c.hand, c.probability, c.combos) for c in classes] == [
        ("AA", 0.8, 2),
        ("KK", 0.2, 1),
    ]
    assert effective == pytest.approx(1 / (0.4**2 + 0.4**2 + 0.2**2))


def test_public_strength_obeys_cancellation_while_evaluating():
    def cancelled():
        raise CalculationCancelled

    with pytest.raises(CalculationCancelled):
        PublicRiverStrength([4, 9, 14, 19, 24], cancelled)
