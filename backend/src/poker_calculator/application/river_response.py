"""Public-information river strength and an explicit fold/call response heuristic."""

import math
from bisect import bisect_left, bisect_right
from collections import defaultdict
from collections.abc import Callable
from dataclasses import dataclass
from itertools import combinations

from poker_calculator.domain.models import InferredHandClass, WeightedCombo
from poker_calculator.domain.ranges import RANKS
from poker_calculator.engines.evaluator import evaluate


@dataclass(frozen=True)
class PublicStrength:
    equity: float
    cannot_lose: bool
    cannot_win: bool


class PublicRiverStrength:
    """Equity against uniform unknown hole cards, excluding both own-card blockers.

    Only the public board is accepted. The user's hidden cards and private dead-card
    knowledge cannot leak into the opponent's willingness to call.
    """

    def __init__(self, board: list[int], checkpoint: Callable[[], None]) -> None:
        if len(board) != 5 or len(set(board)) != 5:
            raise ValueError("公共牌必须是五张不重复的牌")
        known = set(board)
        self.ranks: dict[tuple[int, int], int] = {}
        self.by_card: dict[int, list[int]] = defaultdict(list)
        for index, pair in enumerate(combinations([c for c in range(52) if c not in known], 2)):
            if index % 100 == 0:
                checkpoint()
            rank = evaluate((*pair, *board))
            self.ranks[pair] = rank
            for card in pair:
                self.by_card[card].append(rank)
        self.ordered = sorted(self.ranks.values())
        for values in self.by_card.values():
            values.sort()

    def strength(self, cards: tuple[int, int]) -> PublicStrength:
        a, b = sorted(cards)
        rank = self.ranks[(a, b)]
        pools = (self.ordered, self.by_card[a], self.by_card[b])
        greater = [len(values) - bisect_right(values, rank) for values in pools]
        equal = [bisect_right(values, rank) - bisect_left(values, rank) for values in pools]
        wins = greater[0] - greater[1] - greater[2]
        ties = equal[0] - equal[1] - equal[2] + 1  # The own pair was subtracted twice.
        total = len(pools[0]) - len(pools[1]) - len(pools[2]) + 1
        return PublicStrength(
            equity=(wins + ties / 2) / total,
            cannot_lose=wins + ties == total,
            cannot_win=wins + ties == 0,
        )


def call_probability(strength: PublicStrength, pot: int, amount: int, shift: float = 0) -> float:
    """Compare perceived equity to pot odds; shift models tighter/looser calls.

    The logistic curve is a declared heuristic, not a fitted probability model.
    Guaranteed non-losing calls stay calls in every scenario (including board ties).
    """
    if strength.cannot_lose:
        return 1.0
    if strength.cannot_win:
        return 0.0
    required = amount / (pot + 2 * amount)
    return 1 / (1 + math.exp(-(10 * (strength.equity - required) + shift)))


def summarize_range(combos: list[WeightedCombo]) -> tuple[list[InferredHandClass], float]:
    total = sum(c.weight for c in combos)
    weights: dict[str, float] = defaultdict(float)
    counts: dict[str, int] = defaultdict(int)
    for combo in combos:
        a, b = sorted(combo.cards, reverse=True)
        hand = RANKS[a // 4] + RANKS[b // 4]
        if a // 4 != b // 4:
            hand += "s" if a % 4 == b % 4 else "o"
        weights[hand] += combo.weight / total
        counts[hand] += 1
    classes = [
        InferredHandClass(hand=hand, probability=probability, combos=counts[hand])
        for hand, probability in weights.items()
    ]
    classes.sort(key=lambda c: (-c.probability, c.hand))
    effective = 1 / sum((c.weight / total) ** 2 for c in combos)
    return classes, effective
