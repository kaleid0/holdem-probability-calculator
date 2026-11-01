"""Joint weighted ranges conditioned on disjoint cards; never sequentially renormalize."""

import math
import random
import time
from bisect import bisect_right
from collections.abc import Callable, Iterator

from poker_calculator.domain.models import AnalysisRequest, ExactOpponent, RangeOpponent
from poker_calculator.domain.ranges import Combo, remove_blocked
from poker_calculator.engines.equity import (
    CalculationCancelled,
    CalculationTimeout,
    EquityResult,
    _enumerate,
    state_count,
)
from poker_calculator.engines.evaluator import evaluate


def weighted_equity(
    request: AnalysisRequest,
    *,
    progress: Callable[[int, int], None] | None,
    cancelled: Callable[[], bool] | None,
    time_limit: float,
    exact_limit: int,
) -> EquityResult:
    start = time.monotonic()

    def checkpoint() -> None:
        if cancelled and cancelled():
            raise CalculationCancelled
        if time.monotonic() - start >= time_limit:
            raise CalculationTimeout("范围计算超过预算，请缩小范围或降低精度")

    checkpoint()
    known = set(request.hero) | set(request.board) | set(request.dead_cards)
    for player in request.opponents:
        if isinstance(player, ExactOpponent):
            known.update(player.cards)
    deck = tuple(card for card in range(52) if card not in known)
    hands: list[tuple[int, int] | None] = [
        player.cards if isinstance(player, ExactOpponent) else None for player in request.opponents
    ]
    ranges: list[tuple[int, list[Combo]]] = []
    for index, player in enumerate(request.opponents):
        if isinstance(player, RangeOpponent):
            effective = remove_blocked(player.expanded(), known)
            if not effective:
                raise ValueError(f"对手 {index + 1} 的范围被完全阻断")
            maximum = max(combo.weight for combo in effective)
            ranges.append((index, [Combo(c.cards, c.weight / maximum) for c in effective]))
    ranges.sort(key=lambda item: (len(item[1]), item[0]))
    random_count = sum(player.kind == "random" for player in request.opponents)
    missing = 5 - len(request.board)
    product_size = math.prod(len(combos) for _, combos in ranges)
    visits = 0

    def assignments(
        level: int = 0,
        mask: int = 0,
        selected: tuple[Combo, ...] = (),
        weight: float = 1,
    ) -> Iterator[tuple[tuple[Combo, ...], float]]:
        nonlocal visits
        if level == len(ranges):
            yield selected, weight
            return
        for combo in ranges[level][1]:
            visits += 1
            if visits % 250 == 0:
                checkpoint()
            if combo.mask & mask:
                continue
            yield from assignments(
                level + 1, mask | combo.mask, (*selected, combo), weight * combo.weight
            )

    joint = list(assignments()) if product_size <= 20_000 else None
    if joint is not None and not joint:
        raise ValueError("各对手范围之间没有互不冲突的联合手牌，请修改范围")
    if joint is None:
        # Bounded feasibility search. Stop after the first legal assignment, not its first sample.
        def feasible(level: int = 0, mask: int = 0) -> bool:
            nonlocal visits
            if level == len(ranges):
                return True
            for combo in ranges[level][1]:
                visits += 1
                if visits % 250 == 0:
                    checkpoint()
                if visits > 100_000:
                    raise ValueError("范围冲突检查超过预算，请减少对手或缩小范围")
                if not combo.mask & mask and feasible(level + 1, mask | combo.mask):
                    return True
            return False

        if not feasible():
            raise ValueError("各对手范围之间没有互不冲突的联合手牌，请修改范围")
    remaining_count = len(deck) - 2 * len(ranges)
    per_assignment = state_count(remaining_count, random_count, missing)
    exact_count = (len(joint) if joint is not None else product_size) * per_assignment
    exact = request.equity_method == "auto" and exact_count <= exact_limit
    total = exact_count if exact else request.samples
    rng = random.Random(request.seed)

    def placed(selected: tuple[Combo, ...]) -> tuple[list[tuple[int, int] | None], tuple[int, ...]]:
        concrete = hands.copy()
        used: set[int] = set()
        for (index, _), combo in zip(ranges, selected, strict=True):
            concrete[index] = combo.cards
            used.update(combo.cards)
        return concrete, tuple(card for card in deck if card not in used)

    def exact_outcomes() -> Iterator[tuple[list[tuple[int, int]], tuple[int, ...], float]]:
        for selected, weight in joint if joint is not None else assignments():
            concrete, remaining = placed(selected)
            for opponents, board in _enumerate(remaining, concrete, missing):
                yield opponents, board, weight

    def cumulative(weights: list[float]) -> list[float]:
        result: list[float] = []
        current = 0.0
        for weight in weights:
            current += weight
            result.append(current)
        return result

    joint_cdf = cumulative([weight for _, weight in joint]) if joint is not None else []
    cdfs = [cumulative([combo.weight for combo in combos]) for _, combos in ranges]

    def sampled_outcomes() -> Iterator[tuple[list[tuple[int, int]], tuple[int, ...], float]]:
        attempts = 0
        accepted = 0
        while accepted < total:
            attempts += 1
            if attempts % 250 == 0:
                checkpoint()
                if attempts > max(100_000, request.samples * 100):
                    raise ValueError("范围联合抽样接受率过低，请缩小范围或减少冲突")
            if joint is not None:
                selected = joint[bisect_right(joint_cdf, rng.random() * joint_cdf[-1])][0]
            else:
                selected = tuple(
                    combos[bisect_right(cdf, rng.random() * cdf[-1])]
                    for (_, combos), cdf in zip(ranges, cdfs, strict=True)
                )
                mask = 0
                collision = False
                for combo in selected:
                    if mask & combo.mask:
                        collision = True
                        break
                    mask |= combo.mask
                if collision:
                    continue
            concrete, remaining = placed(selected)
            drawn = rng.sample(remaining, random_count * 2 + missing)
            cursor = 0
            opponents = []
            for hand in concrete:
                if hand is None:
                    opponents.append((drawn[cursor], drawn[cursor + 1]))
                    cursor += 2
                else:
                    opponents.append(hand)
            accepted += 1
            yield opponents, tuple(drawn[cursor:]), 1.0

    wins = ties = losses = shares = squares = mass = 0.0
    completed = 0
    if progress:
        progress(0, total)
    for opponents, runout, weight in exact_outcomes() if exact else sampled_outcomes():
        if completed % 250 == 0:
            checkpoint()
            if progress:
                progress(completed, total)
        board = (*request.board, *runout)
        scores = [
            evaluate((*request.hero, *board)),
            *(evaluate((*hand, *board)) for hand in opponents),
        ]
        best = min(scores)
        share = 0.0
        if scores[0] == best:
            winners = scores.count(best)
            share = 1 / winners
            if winners == 1:
                wins += weight
            else:
                ties += weight
        else:
            losses += weight
        mass += weight
        shares += weight * share
        squares += weight * share * share
        completed += 1
    checkpoint()
    if mass <= 0 or not completed:
        raise ValueError("范围没有有效的联合概率质量")
    equity = shares / mass
    stderr = (
        None
        if exact
        else math.sqrt(max(0, (squares - completed * equity**2) / (completed - 1)) / completed)
    )
    if progress:
        progress(completed, total)
    return EquityResult(
        method="exact" if exact else "monteCarlo",
        win_probability=wins / mass,
        tie_probability=ties / mass,
        lose_probability=losses / mass,
        equity=equity,
        equity_standard_error=stderr,
        sample_count=completed,
        elapsed_ms=(time.monotonic() - start) * 1000,
    )
