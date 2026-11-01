"""Exact enumeration and reproducible, unbiased Monte Carlo equity."""

import math
import random
import time
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from itertools import combinations

from poker_calculator.domain.models import (
    AnalysisRequest,
    ExactOpponent,
    RandomOpponent,
    RangeOpponent,
)
from poker_calculator.engines.evaluator import evaluate

EXACT_LIMIT = 50_000
BATCH_SIZE = 250


class CalculationCancelled(Exception):
    pass


class CalculationTimeout(Exception):
    pass


@dataclass(frozen=True)
class EquityResult:
    method: str
    win_probability: float
    tie_probability: float
    lose_probability: float
    equity: float
    equity_standard_error: float | None
    sample_count: int
    elapsed_ms: float


def state_count(deck_size: int, random_count: int, missing_board: int) -> int:
    total = 1
    for _ in range(random_count):
        total *= math.comb(deck_size, 2)
        deck_size -= 2
    return total * math.comb(deck_size, missing_board)


def _enumerate(
    deck: tuple[int, ...], hands: list[tuple[int, int] | None], missing: int, index: int = 0
) -> Iterator[tuple[list[tuple[int, int]], tuple[int, ...]]]:
    while index < len(hands) and hands[index] is not None:
        index += 1
    if index == len(hands):
        concrete = [hand for hand in hands if hand is not None]
        for board in combinations(deck, missing):
            yield concrete, board
        return
    for pair in combinations(deck, 2):
        remaining = tuple(card for card in deck if card not in pair)
        next_hands = hands.copy()
        next_hands[index] = pair
        yield from _enumerate(remaining, next_hands, missing, index + 1)


def calculate_equity(
    request: AnalysisRequest,
    *,
    progress: Callable[[int, int], None] | None = None,
    cancelled: Callable[[], bool] | None = None,
    time_limit: float = 30.0,
) -> EquityResult:
    if any(isinstance(player, RangeOpponent) for player in request.opponents):
        from poker_calculator.engines.weighted import weighted_equity

        return weighted_equity(
            request,
            progress=progress,
            cancelled=cancelled,
            time_limit=time_limit,
            exact_limit=EXACT_LIMIT,
        )
    start = time.monotonic()
    known = set(request.hero) | set(request.board) | set(request.dead_cards)
    hands: list[tuple[int, int] | None] = []
    for opponent in request.opponents:
        if isinstance(opponent, ExactOpponent):
            known.update(opponent.cards)
            hands.append(opponent.cards)
        else:
            hands.append(None)
    deck = tuple(card for card in range(52) if card not in known)
    random_count = sum(isinstance(p, RandomOpponent) for p in request.opponents)
    missing = 5 - len(request.board)
    exact_count = state_count(len(deck), random_count, missing)
    exact = request.equity_method == "auto" and exact_count <= EXACT_LIMIT
    total = exact_count if exact else request.samples
    rng = random.Random(request.seed)

    def simulated() -> Iterator[tuple[list[tuple[int, int]], tuple[int, ...]]]:
        for _ in range(total):
            drawn = rng.sample(deck, random_count * 2 + missing)
            cursor = 0
            opponents = []
            for hand in hands:
                if hand is None:
                    opponents.append((drawn[cursor], drawn[cursor + 1]))
                    cursor += 2
                else:
                    opponents.append(hand)
            yield opponents, tuple(drawn[cursor:])

    outcomes = _enumerate(deck, hands, missing) if exact else simulated()
    wins = ties = losses = 0
    share_sum = share_squared_sum = 0.0
    completed = 0
    if progress:
        progress(0, total)
    for opponents, runout in outcomes:
        if completed % BATCH_SIZE == 0:
            if cancelled and cancelled():
                raise CalculationCancelled
            if time.monotonic() - start > time_limit:
                raise CalculationTimeout("计算超过时间预算，请降低精度或减少未知对手")
            if progress:
                progress(completed, total)
        board = tuple(request.board) + runout
        scores = [evaluate(tuple(request.hero) + board)]
        scores.extend(evaluate(hand + board) for hand in opponents)
        best = min(scores)
        share = 0.0
        if scores[0] == best:
            winner_count = scores.count(best)
            share = 1.0 / winner_count
            if winner_count == 1:
                wins += 1
            else:
                ties += 1
        else:
            losses += 1
        share_sum += share
        share_squared_sum += share * share
        completed += 1
    if cancelled and cancelled():
        raise CalculationCancelled
    if progress:
        progress(completed, total)
    equity = share_sum / completed
    stderr = None
    if not exact and completed > 1:
        variance = max(0.0, (share_squared_sum - completed * equity**2) / (completed - 1))
        stderr = math.sqrt(variance / completed)
    return EquityResult(
        method="exact" if exact else "monteCarlo",
        win_probability=wins / completed,
        tie_probability=ties / completed,
        lose_probability=losses / completed,
        equity=equity,
        equity_standard_error=stderr,
        sample_count=completed,
        elapsed_ms=(time.monotonic() - start) * 1_000,
    )
