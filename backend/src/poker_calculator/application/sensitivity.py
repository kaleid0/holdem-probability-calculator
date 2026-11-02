"""Explainable heuristic inference; not a fitted opponent behavior model."""

import hashlib
import itertools
import math
import time
from collections import Counter
from collections.abc import Callable

from poker_calculator.application.services import AnalysisServices
from poker_calculator.domain.history import Decision, HistoryInsufficient, replay
from poker_calculator.domain.models import (
    AnalysisRequest,
    ExactOpponent,
    RangeOpponent,
    WeightedCombo,
)
from poker_calculator.domain.ranges import Combo, remove_blocked
from poker_calculator.domain.sensitivity import (
    InferenceTrace,
    SensitivityOutcome,
    SensitivityRequest,
    SensitivityResult,
)
from poker_calculator.engines.equity import CalculationCancelled, CalculationTimeout
from poker_calculator.strategies.pot_odds import PotOddsStrategy

MAX_CLIPPED_MASS = 0.0001
GROUPS = ("value", "draw", "other")


def features(cards: tuple[int, int], board: tuple[int, ...]) -> tuple[float, str]:
    """Versioned coarse strength, candidate draw and hole-card participation features."""
    ranks = [c // 4 for c in cards]
    if not board:
        high, low = max(ranks), min(ranks)
        strength = (high + low) / 30 + (0.35 if high == low else 0)
        strength += 0.08 if cards[0] % 4 == cards[1] % 4 else 0
        strength += 0.05 if high - low == 1 else 0
        strength = min(1.0, strength)
        return strength, "value" if strength >= 0.72 else "other"
    all_cards = (*cards, *board)
    counts = Counter(c // 4 for c in all_cards)
    board_counts = Counter(c // 4 for c in board)
    suits = Counter(c % 4 for c in all_cards)
    rank_set = set(counts)
    if 12 in rank_set:
        rank_set.add(-1)
    windows = [set(range(start, start + 5)) for start in range(-1, 9)]
    board_ranks = set(board_counts)
    if 12 in board_ranks:
        board_ranks.add(-1)
    straight = any(w <= rank_set and not w <= board_ranks for w in windows)
    board_suits = Counter(c % 4 for c in board)
    flush = any(n >= 5 and board_suits[suit] < 5 for suit, n in suits.items())
    participation = any(counts[r] > max(1, board_counts[r]) for r in ranks)
    pairs = sum(n >= 2 for n in counts.values())
    strong = (
        straight
        or flush
        or any(counts[r] >= 3 and counts[r] > board_counts[r] for r in ranks)
        or (pairs >= 2 and participation)
    )
    # Board-only strength does not turn every candidate into a distinct value hand.
    if strong:
        return 0.92, "value"
    if participation:
        paired_rank = max(r for r in ranks if counts[r] > max(1, board_counts[r]))
        top_pair = paired_rank >= max(c // 4 for c in board)
        return (0.78 if top_pair else 0.57), "value" if top_pair else "other"
    draw = len(board) < 5 and (
        any(n == 4 and any(c % 4 == suit for c in cards) for suit, n in suits.items())
        or any(len(w & rank_set) == 4 and any(r in w for r in ranks) for w in windows)
    )
    if draw:
        return 0.43, "draw"
    return 0.12 + max(ranks) / 80, "other"


def action_probabilities(
    decision: Decision, strength: float, group: str, bluff_bias: float
) -> dict[str, float]:
    e = decision.event
    pressure = e.toCall / max(1, e.potBefore)
    depth = (
        0.0
        if decision.effective_stack is None
        else min(1.0, decision.effective_stack / max(1, e.potBefore) / 10)
    )
    scores = {
        "fold": 1.4 - 4 * strength + min(2.0, pressure),
        "check": 0.9 - strength,
        "call": 0.3 + 1.8 * strength - pressure,
        "bet": -1.0 + 3 * strength,
        "raise": -1.6 + 3.6 * strength - pressure,
    }
    for action in ("bet", "raise"):
        scores[action] += (
            (bluff_bias if group != "value" else 0)
            + (0.35 if group == "draw" else 0)
            + (0.15 if decision.late_position else 0)
            + (0.15 * depth if group == "draw" else 0)
            - 0.08 * (e.activePlayersBefore - 2)
            - 0.3 * decision.raises_before * (1 - strength)
        )
    peak = max(scores[a] for a in decision.legal)
    weights = {a: math.exp(scores[a] - peak) + 1e-4 for a in decision.legal}
    total = sum(weights.values())
    return {a: w / total for a, w in weights.items()}


def size_probability(decision: Decision, strength: float, group: str, bias: float) -> float:
    """Probability of observed small/medium/large size conditional on aggression."""
    e = decision.event
    if e.action not in ("bet", "raise"):
        return 1.0
    increment = e.amount if e.action == "bet" else e.streetTotal - e.highestBefore
    ratio = increment / max(1, e.potBefore + (e.toCall if e.action == "raise" else 0))
    bucket = 0 if ratio <= 0.4 else 1 if ratio <= 0.85 else 2
    aggression = strength + (0.25 * bias if group != "value" else 0)
    scores = (0.7 - aggression, 0.4, -0.5 + 1.6 * aggression)
    weights = [math.exp(s) + 1e-4 for s in scores]
    return weights[bucket] / sum(weights)


def distribution(logs: list[float], groups: list[str]) -> dict[str, float]:
    peak = max(logs)
    weights = [math.exp(w - peak) for w in logs]
    total = sum(weights)
    return {
        g: sum(w for w, label in zip(weights, groups, strict=True) if label == g) / total
        for g in GROUPS
    }


def infer(
    request: SensitivityRequest,
    decisions: list[Decision],
    bias: float,
    checkpoint: Callable[[], None],
) -> tuple[list[WeightedCombo], list[InferenceTrace], dict[str, float], float]:
    base = request.base_analysis
    known = set(base.hero) | set(base.board) | set(base.dead_cards)
    for opponent in base.opponents:
        if isinstance(opponent, ExactOpponent):
            known.update(opponent.cards)
    initial = (
        request.preflop_prior.expanded()
        if request.preflop_prior
        else [Combo(pair, 1) for pair in itertools.combinations(range(52), 2)]
    )
    initial = remove_blocked(initial, known)
    if not initial:
        raise ValueError("翻前先验被当前已知牌完全阻断")
    logs = [math.log(c.weight) for c in initial]
    traces = []
    for decision in decisions:
        checkpoint()
        e = decision.event
        if e.player != request.target_seat:
            continue
        observed = [features(c.cards, decision.board) for c in initial]
        groups = [group for _, group in observed]
        before = distribution(logs, groups)
        for i, (strength, group) in enumerate(observed):
            if i % 100 == 0:
                checkpoint()
            probability = action_probabilities(decision, strength, group, bias)[e.action]
            logs[i] += math.log(probability * size_probability(decision, strength, group, bias))
        # Subtract maximum after each step; no early truncation.
        peak = max(logs)
        logs = [w - peak for w in logs]
        stack_label = (
            str(decision.effective_stack) if decision.effective_stack is not None else "未知"
        )
        traces.append(
            InferenceTrace(
                sequence=e.sequence,
                street=e.street,
                action=e.action,
                board=list(decision.board),
                rule_id="action-softmax-size-v1",
                context=(
                    f"面对跟注 {e.toCall}；行动前底池 {e.potBefore}；"
                    f"在局 {e.activePlayersBefore} 人；"
                    f"本街已有 {decision.raises_before} 次主动下注；"
                    f"诈唬偏置 {bias:g}；"
                    f"有效筹码 {stack_label}"
                ),
                before=before,
                after=distribution(logs, groups),
            )
        )
    peak = max(logs)
    weights = [math.exp(w - peak) for w in logs]
    clipped = sum(w for w in weights if w < 1e-6) / sum(weights)
    if clipped > MAX_CLIPPED_MASS:
        raise ValueError("后验裁剪质量超过 0.01%，现有组合协议精度不足，请缩短序列或调整先验")
    combos = [
        WeightedCombo(cards=c.cards, weight=w)
        for c, w in zip(initial, weights, strict=True)
        if w >= 1e-6
    ]
    groups = [features(c.cards, tuple(base.board))[1] for c in combos]
    composition = distribution([math.log(c.weight) for c in combos], groups)
    return combos, traces, composition, clipped


def run_sensitivity(request: SensitivityRequest, services: AnalysisServices) -> SensitivityResult:
    started = time.monotonic()
    warnings = [
        "启发式行为模型尚未由真实牌局校准；其他玩家历史仅用于恢复上下文，其范围保持固定。",
        "权益误差只反映抽样误差；场景结果包络不代表真实对手范围的置信区间。",
        "EV 为适用条件内的点估计，未提供 EV 标准误，不作统计显著性判断。",
    ]
    outcomes: list[SensitivityOutcome] = []
    decisions: list[Decision] = []
    input_error: str | None = None
    stopped: str | None = None
    try:
        if request.mode == "history":
            decisions, extra = replay(request, services.checkpoint)
            warnings.extend(extra)
    except HistoryInsufficient as exc:
        input_error = str(exc)
    except ValueError as exc:
        input_error = str(exc)
    except CalculationCancelled:
        stopped = "cancelled"
    except CalculationTimeout:
        stopped = "timed-out"
    services.phases = len(request.scenarios)
    range_seeds: dict[str, int] = {}
    for index, scenario in enumerate(request.scenarios):
        services.phase = index
        outcome = SensitivityOutcome(
            id=scenario.id, name=scenario.name, bluff_bias=scenario.bluff_bias, status="error"
        )
        if input_error:
            outcome.status = "insufficient-data"
            outcome.reasons = [input_error]
        elif stopped:
            outcome.status = "cancelled" if stopped == "cancelled" else "timed-out"
            outcome.reasons = ["批次已取消" if stopped == "cancelled" else "批次总预算已耗尽"]
        else:
            try:
                services.checkpoint()
                if request.mode == "history":
                    combos, traces, composition, clipped = infer(
                        request, decisions, scenario.bluff_bias, services.checkpoint
                    )
                    outcome.traces = traces
                    outcome.composition = composition
                    outcome.clipped_mass = clipped
                else:
                    assert scenario.current_range is not None
                    combos = [
                        WeightedCombo(cards=c.cards, weight=c.weight)
                        for c in scenario.current_range.expanded()
                    ]
                opponents = list(request.base_analysis.opponents)
                opponents[request.opponent_seats.index(request.target_seat)] = RangeOpponent(
                    kind="range", combos=combos
                )
                range_key = opponents[
                    request.opponent_seats.index(request.target_seat)
                ].model_dump_json()
                seed = range_seeds.setdefault(
                    range_key,
                    int.from_bytes(
                        hashlib.sha256(
                            f"{request.base_analysis.seed}:{scenario.id}".encode()
                        ).digest()[:4],
                        "big",
                    ),
                )
                data = request.base_analysis.model_dump()
                data.update(
                    opponents=[o.model_dump() for o in opponents],
                    seed=seed,
                    strategy_id="pot-odds",
                    strategy_config={},
                    strategies=None,
                )
                analysis = AnalysisRequest.model_validate(data)
                # Revalidation above also catches known-card conflicts in manual ranges.
                known = set(analysis.hero) | set(analysis.board) | set(analysis.dead_cards)
                for o in analysis.opponents:
                    if isinstance(o, ExactOpponent):
                        known.update(o.cards)
                outcome.combos = [c for c in combos if not set(c.cards) & known]
                if not outcome.composition:
                    outcome.composition = distribution(
                        [math.log(c.weight) for c in outcome.combos],
                        [features(c.cards, tuple(analysis.board))[1] for c in outcome.combos],
                    )
                result = PotOddsStrategy().analyze(analysis, services)
                if result.method == "exact":
                    result.equity_standard_error = 0
                # Ordinary analysis retains its existing reference-EV behavior. Here EV
                # is deliberately absent unless the requested settlement supports it.
                if analysis.settlement_assumption != "showdownAfterCall":
                    result.call_ev = None
                    result.candidates = []
                outcome.result = result
                outcome.status = "ok"
            except CalculationCancelled:
                outcome.status = "cancelled"
                outcome.reasons = ["批次已取消"]
                stopped = "cancelled"
            except CalculationTimeout:
                outcome.status = "timed-out"
                outcome.reasons = ["批次总预算已耗尽"]
                stopped = "timed-out"
            except Exception as exc:
                outcome.reasons = [str(exc)]
        outcomes.append(outcome)
        services.report(1, 1)
    baseline = outcomes[0].result
    for outcome in outcomes:
        if baseline and outcome.result:
            if baseline.equity is not None and outcome.result.equity is not None:
                outcome.equity_delta = outcome.result.equity - baseline.equity
            if baseline.call_ev is not None and outcome.result.call_ev is not None:
                outcome.ev_delta = outcome.result.call_ev - baseline.call_ev
    successful = [o for o in outcomes if o.status == "ok"]
    hashes = {o.result.scenario_hash for o in successful if o.result}
    if len(hashes) == 1 and len(successful) > 1:
        warnings.append("所选序列/参数未产生不同的有效范围，已复用重复计算。")
    evs = [o.result.call_ev for o in successful if o.result and o.result.call_ev is not None]
    summary = "当前仅比较范围与权益；跟注 EV 的适用条件未满足。"
    if evs:
        if min(evs) < 0 < max(evs):
            summary = "EV 点估计出现正负两侧，决策依赖范围假设；差异可能受模拟噪声影响。"
        elif any(abs(ev) < 1e-9 for ev in evs):
            summary = "存在盈亏平衡场景；请结合范围假设与模拟误差判断。"
        else:
            summary = "所选场景的 EV 点估计方向一致，尚未检验 EV 的统计稳定性。"
    if len(successful) != len(outcomes):
        summary = "批次未完整完成，不能判断全部场景的稳定性。" + summary
    return SensitivityResult(
        request_hash=hashlib.sha256(request.model_dump_json().encode()).hexdigest(),
        target_seat=request.target_seat,
        prior_source="当前手工范围（不应用历史）"
        if request.mode == "manual"
        else ("用户指定翻前先验" if request.preflop_prior else "全组合等权翻前先验"),
        cutoff_sequence=request.history_context.cutoff_sequence
        if request.history_context
        else None,
        warnings=warnings,
        outcomes=outcomes,
        summary=summary,
        elapsed_ms=(time.monotonic() - started) * 1000,
    )
