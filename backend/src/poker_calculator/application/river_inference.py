"""Resolve recorded facts, then infer coherent river responses from hand history."""

import hashlib
import math
import time
from collections.abc import Callable
from typing import TYPE_CHECKING

from poker_calculator.application.sensitivity import infer
from poker_calculator.application.services import AnalysisServices
from poker_calculator.domain.history import Decision, ReplayState, replay_state
from poker_calculator.domain.models import (
    ActionAssessment,
    AnalysisRequest,
    AnalysisResult,
    ExactOpponent,
    RandomOpponent,
    RangeOpponent,
    StrategyIdentity,
    StrategyInference,
    WeightedCombo,
)
from poker_calculator.domain.sensitivity import InferenceTrace, SensitivityRequest
from poker_calculator.engines.evaluator import evaluate

if TYPE_CHECKING:
    from poker_calculator.strategies.river_bet import RiverBetConfig

BASELINE = "从当前决策起的净筹码收益（不计此前投入）"
MODEL = "history-river-response-v2"


def prepare_history(
    request: AnalysisRequest,
    config: "RiverBetConfig",
    checkpoint: Callable[[], None] | None = None,
) -> tuple[SensitivityRequest, list[Decision], ReplayState, int]:
    if len(request.board) != 5 or len(request.opponents) != 1 or request.call_amount:
        raise ValueError("自动河牌分析需要河牌单挑、当前无需跟注")
    h = config.history_context
    if h is None or not h.complete:
        raise ValueError("自动推断缺少完整本手历史；请使用逐步记录，或切换手动配置")
    if h.stacks is None:
        raise ValueError("历史缺少开局筹码，无法自动确定有效筹码")
    if len(config.opponent_seats) != 1:
        raise ValueError("缺少唯一在局对手的座位映射")
    # Known opponent cards are facts; history must never reweight them. Replay itself
    # only needs the seat and commitments, so a random placeholder permits validation.
    base = request.model_copy(update={"opponents": [RandomOpponent(kind="random")]})
    history = SensitivityRequest(
        base_analysis=base,
        target_seat=config.opponent_seats[0],
        opponent_seats=config.opponent_seats,
        history_context=h,
        preflop_prior=RangeOpponent(kind="range", text=config.preflop_prior)
        if config.preflop_prior.strip()
        else None,
    )
    decisions, _, state = replay_state(history, checkpoint)
    if state.ended or state.actor != 0 or state.pending != {0}:
        raise ValueError("根据历史，当前不是由你最后行动，或牌局已结束；不能假设过牌直接摊牌")
    if request.pot_context is None or len(set(request.pot_context.contributions)) != 1:
        raise ValueError("自动河牌分析不支持边池或尚未匹配的投入")
    target = history.target_seat
    stack = min(h.stacks[0] - state.total[0], h.stacks[target] - state.total[target])
    if stack <= 0:
        raise ValueError("双方有效剩余筹码为零，没有可比较的下注动作")
    return history, decisions, state, stack


def automatic_amounts(pot: int, stack: int, minimum: int) -> list[int]:
    """Round half-up, cap to stacks, deduplicate, and include a legal short all-in."""
    sizes = {
        min(stack, max(minimum, (pot * n + d // 2) // d))
        for n, d in ((1, 3), (1, 2), (3, 4), (1, 1), (3, 2))
    }
    sizes.add(stack)
    return sorted(b for b in sizes if pot + 2 * b <= 9_007_199_254_740_991)


def analyze_automatic(
    request: AnalysisRequest, config: "RiverBetConfig", services: AnalysisServices
) -> AnalysisResult:
    from poker_calculator.application.river_response import (
        PublicRiverStrength,
        call_probability,
        summarize_range,
    )
    from poker_calculator.domain.models import RiverScenarioSummary

    start = time.monotonic()
    services.checkpoint()
    history, decisions, state, stack = prepare_history(request, config, services.checkpoint)
    h = history.history_context
    assert h is not None and h.stacks is not None
    target = history.target_seat
    pot = request.pot_before_call
    amounts = automatic_amounts(pot, stack, state.minimum)
    if not amounts:
        raise ValueError("候选下注后的底池超出安全整数范围")
    public = PublicRiverStrength(request.board, services.checkpoint)
    hero_rank = evaluate((*request.hero, *request.board))
    opponent = request.opponents[0]
    warnings = [
        "范围和响应来自未用真实对局数据校准的规则模型，不是已测得的对手弃牌率或 GTO。",
        "仅使用本手截止当前的行动；尚未建立跨手、按对手身份学习的长期画像。",
        "响应模型只允许弃牌或跟注，不建模对手加注；改变该假设可能改变建议。",
        "三情景 EV 范围表示指定模型假设的结果包络，不是置信区间或盈利保证。",
    ]
    if isinstance(opponent, RangeOpponent):
        warnings.append(
            "自动模式从翻前先验重新推断，不叠加当前范围编辑器的范围，避免重复使用历史证据。"
        )
    source = (
        "已知对手手牌；历史仅恢复环境"
        if isinstance(opponent, ExactOpponent)
        else "本手行动历史 + " + ("指定翻前先验" if history.preflop_prior else "全组合等权先验")
    )
    variants = (
        ("baseline", "基准", 0.0, 0.0),
        ("tight", "偏紧", -1.2, -0.8),
        ("loose", "偏松", 1.2, 0.8),
    )
    scenario_candidates: list[list[ActionAssessment]] = []
    summaries: list[RiverScenarioSummary] = []
    baseline_combos: list[WeightedCombo] = []
    traces: list[InferenceTrace] = []
    clipped = wins = ties = losses = baseline_equity = 0.0
    total_states = 0
    for index, (scenario_id, name, bias, shift) in enumerate(variants):
        services.checkpoint()
        if isinstance(opponent, ExactOpponent):
            combos = [WeightedCombo(cards=opponent.cards, weight=1)]
            current_traces: list[InferenceTrace] = []
            current_clipped = 0.0
        else:
            try:
                combos, current_traces, _, current_clipped = infer(
                    history, decisions, bias, services.checkpoint
                )
            except ValueError as exc:
                if index == 0:
                    raise
                summaries.append(
                    RiverScenarioSummary(
                        id=scenario_id, name=name, status="insufficient-data", reasons=[str(exc)]
                    )
                )
                warnings.append(f"{name}情景未完成：{exc}")
                services.report(index + 1, len(variants))
                continue
        total_states += len(combos)
        total = math.fsum(c.weight for c in combos)
        shares: list[float] = []
        for i, combo in enumerate(combos):
            if i % 100 == 0:
                services.checkpoint()
            pair = (min(combo.cards), max(combo.cards))
            rank = public.ranks[pair]
            share = 1.0 if hero_rank < rank else 0.5 if hero_rank == rank else 0.0
            shares.append(share)
        current_wins, current_ties, current_losses = (
            math.fsum(c.weight for c, share in zip(combos, shares, strict=True) if share == outcome)
            / total
            for outcome in (1, 0.5, 0)
        )
        equity = current_wins + current_ties / 2
        check_ev = equity * pot
        candidates = [
            ActionAssessment(
                action="check",
                amount=0,
                ev=check_ev,
                ev_delta=0,
                ev_baseline=BASELINE,
                method=MODEL,
                showdown_equity=equity,
                explanation="完整历史确认对手已过牌，由你最后行动；EV = 后验权益 × 当前底池。",
            )
        ]
        for amount in amounts:
            services.checkpoint()
            call_weights: list[float] = []
            for i, combo in enumerate(combos):
                if i % 100 == 0:
                    services.checkpoint()
                call = call_probability(public.strength(combo.cards), pot, amount, shift)
                call_weights.append(combo.weight * call)
            call_mass = math.fsum(call_weights) / total
            call_share = (
                math.fsum(w * share for w, share in zip(call_weights, shares, strict=True)) / total
            )
            call_mass = max(0.0, min(1.0, call_mass))
            fold = 1 - call_mass
            called_equity = max(0.0, min(1.0, call_share / call_mass)) if call_mass else None
            fold_return = fold * pot
            # This equivalent payoff form avoids subtracting two huge bets on ties.
            call_return = (
                math.fsum(
                    w * (share * pot + amount * (2 * share - 1))
                    for w, share in zip(call_weights, shares, strict=True)
                )
                / total
            )
            value = fold_return + call_return
            candidates.append(
                ActionAssessment(
                    action="bet",
                    amount=amount,
                    ev=value,
                    ev_delta=value - check_ev,
                    ev_baseline=BASELINE,
                    method=MODEL,
                    fold_probability=fold,
                    showdown_equity=called_equity,
                    fold_return=fold_return,
                    call_return=call_return,
                    explanation=(
                        f"下注 {amount}（{amount / pot:.0%} 底池）；"
                        "比较对手完整河牌牌力与所需跟注权益，"
                        f"估计弃牌率 {fold:.2%}。"
                        "对手牌力参照仅使用公共牌及其自身阻断，不读取你的底牌。"
                        f"弃牌分支贡献 {fold_return:.2f}，跟注分支贡献 {call_return:.2f} 筹码。"
                    ),
                )
            )
        best = max(c.ev for c in candidates if c.ev is not None)
        best_amounts = [
            c.amount
            for c in candidates
            if c.amount is not None
            and c.ev is not None
            and math.isclose(c.ev, best, rel_tol=1e-12, abs_tol=1e-8)
        ]
        summaries.append(
            RiverScenarioSummary(
                id=scenario_id,
                name=name,
                equity=equity,
                check_ev=check_ev,
                best_ev=best,
                best_amounts=best_amounts,
            )
        )
        scenario_candidates.append(candidates)
        if index == 0:
            baseline_combos, traces, clipped = combos, current_traces, current_clipped
            wins, ties, losses, baseline_equity = current_wins, current_ties, current_losses, equity
        services.report(index + 1, len(variants))
    candidates = scenario_candidates[0]
    for i, candidate in enumerate(candidates):
        evs = [c.ev for scene in scenario_candidates for c in [scene[i]] if c.ev is not None]
        candidate.ev_min = min(evs)
        candidate.ev_max = max(evs)
    complete = all(s.status == "ok" for s in summaries)
    stable = sorted(set.intersection(*(set(s.best_amounts) for s in summaries))) if complete else []

    def label(amount: int) -> str:
        return "过牌" if amount == 0 else f"下注 {amount}"

    stability = (
        f"在三种假设下，{'、'.join(map(label, stable))}均为最高候选 EV。"
        if stable
        else "建议随范围或跟注意愿假设改变，请结合三情景对照判断。"
    )
    if not complete:
        stability = "部分情景未完成，不能判断三情景一致性；EV 范围仅覆盖已完成情景。"
    baseline_best = "、".join(map(label, summaries[0].best_amounts))
    baseline_best_ev = summaries[0].best_ev
    assert baseline_best_ev is not None
    classes, effective = summarize_range(baseline_combos)
    evidence = [
        f"历史重放至 #{h.cutoff_sequence}；在局对手座位 {target}，最后行动者为你。",
        f"有效筹码 = min({h.stacks[0]}−{state.total[0]}, "
        f"{h.stacks[target]}−{state.total[target]}) = {stack}。",
        f"底池 {pot}；自动生成常见底池比例及全下，按筹码与最小下注约束去重。",
        "响应牌力以对手对均匀未知手牌的河牌权益为参照，计入自身阻断；响应模型不读取你的底牌。",
        "偏紧/偏松情景分别改变历史中的诈唬权重（±1.2）与跟注意愿（logit ±0.8）。",
        *[f"#{t.sequence} · {t.street} 张公共牌 · {t.action}：{t.context}" for t in traces],
    ]
    return AnalysisResult(
        method="exact",
        win_probability=wins,
        tie_probability=ties,
        lose_probability=losses,
        equity=baseline_equity,
        equity_standard_error=None,
        sample_count=total_states,
        elapsed_ms=(time.monotonic() - start) * 1000,
        pot_odds_ratio=None,
        break_even_equity=None,
        call_ev=None,
        recommendation=(
            f"按基准模型，{baseline_best}的候选 EV 最高（{baseline_best_ev:.2f} 筹码）。{stability}"
        ),
        assumptions=[
            "河牌单挑，无抽水、无 ICM，平局等分；已投入筹码为沉没成本。",
            "过牌直接摊牌；面对下注对手只弃牌或跟注。",
            "对手参照均匀未知手牌判断跟注；真实对手可能对你的范围有其他判断。",
            "对每种假设的后验精确计算，不代表行为预测无误差或候选金额全局最优。",
            *warnings,
        ],
        strategy=StrategyIdentity(id="river-bet", name="河牌下注 EV", version="0.3.0"),
        scenario_hash=hashlib.sha256(request.model_dump_json().encode()).hexdigest(),
        seed=request.seed,
        engine_version="0.3.0",
        model_version=MODEL,
        candidates=candidates,
        signals=[
            "上方权益基于基准历史后验；快速分析仍使用当前范围编辑器，两者模型可能不同。",
            "EV 同时显示相对过牌的差值和三情景范围；跨假设的范围不是统计置信区间。",
        ],
        strategy_config={
            "mode": "auto",
            "effective_stack": stack,
            "check_closes_action": True,
            "preflop_prior": config.preflop_prior,
        },
        inference=StrategyInference(
            source=source,
            model_version=MODEL,
            hand_id=h.hand_id,
            cutoff_sequence=h.cutoff_sequence,
            opponent_seat=target,
            effective_stack=stack,
            posterior_combos=len(baseline_combos),
            observed_actions=sum(d.event.player == target for d in decisions),
            evidence=evidence,
            warnings=warnings,
            range_classes=classes,
            effective_combos=effective,
            clipped_mass=clipped,
            scenarios=summaries,
            stable_amounts=stable,
            sensitivity_summary=stability,
        ),
    )
