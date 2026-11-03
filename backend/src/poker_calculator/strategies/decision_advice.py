"""Decision interpretation of evaluated facts, including sampling boundaries."""

from typing import Literal

from poker_calculator.domain.advice import AdviceAction, DecisionAdvice, DecisionAdviceRequest
from poker_calculator.domain.decision import DecisionContext
from poker_calculator.domain.models import AnalysisResult


def waiting_advice() -> DecisionAdvice:
    return DecisionAdvice(
        source="waiting",
        model_version="decision-policy-v1",
        code="waiting",
        title="等待你的行动",
        reason="当前展示牌局权益；轮到你时再给行动建议。",
        stability="尚未评估",
    )


def baseline_advice(
    request: DecisionAdviceRequest, result: AnalysisResult | None, context: DecisionContext | None
) -> DecisionAdvice | None:
    if result is None:
        return None
    if request.recorded and (context is None or not context.hero_turn):
        return waiting_advice()
    base = request.base_analysis
    answer = DecisionAdvice(
        source="pot-odds",
        model_version="pot-odds-decision-v1",
        code="no-call",
        title="当前无需跟注",
        reason="权益不能单独决定是否下注。",
        stability="尚未比较下注动作",
    )
    if base.call_amount == 0:
        return answer
    future = base.settlement_assumption == "futureBettingPossible"
    if result.call_ev is None or result.equity is None or result.break_even_equity is None:
        reasons = []
        if request.recorded and base.pot_context is None:
            reasons.append("当前底池与累计投入记录不一致或记录不可用，无法可靠拆分主池和边池。")
        if base.pot_context and not base.pot_context.betting_closed_after_call:
            reasons.append("本次跟注尚不能闭合当前街，其他玩家仍可行动，可能改变跟注成本和底池。")
        if future:
            reasons.append("当前允许后续下注，尚未计算未来投入与弃牌的影响。")
        if any(p.is_refund and 0 in p.eligible for p in result.pots):
            reasons.append("存在退回给你的未跟注筹码，当前模型尚不支持此情形的跟注 EV。")
        answer.code, answer.title, answer.stability = (
            "unavailable",
            "暂不给跟注结论",
            "跟注 EV 暂不可用",
        )
        answer.reason = (
            "".join(reasons) or "当前未返回完整的跟注 EV 与权益门槛，请检查分析结果及底池设置。"
        ) + "当前权益仅供参考，不代表应该跟注或弃牌。"
        return answer
    gap = result.equity - result.break_even_equity
    error = result.equity_standard_error
    marginal = abs(result.call_ev) < 1e-9 or (error is not None and abs(gap) <= 1.96 * error)
    action: Literal["call", "fold"] = "call" if result.call_ev > 0 else "fold"
    answer.code = "marginal" if marginal else "recommendation"
    label = f"跟注 {base.call_amount}" if action == "call" else "弃牌"
    answer.title = (
        "接近临界，暂不下结论" if marginal else f"{'摊牌参考：' if future else '倾向'}{label}"
    )
    answer.reason = f"权益 {result.equity:.1%}，跟注门槛 {result.break_even_equity:.1%}。" + (
        "后续仍可下注，尚未计入未来投入。" if future else "按跟注后无后续投入计算。"
    )
    answer.stability = (
        "差距接近抽样误差，可用精细分析复核" if marginal else "仅基于当前范围，未检验范围稳定性"
    )
    answer.threshold = result.break_even_equity
    answer.actions = (
        []
        if marginal
        else [AdviceAction(action=action, amount=base.call_amount if action == "call" else 0)]
    )
    return answer


def river_advice(result: AnalysisResult | None) -> DecisionAdvice | None:
    if result is None or result.inference is None:
        return None
    inference = result.inference
    scenarios = inference.scenarios
    complete = len(scenarios) == 3 and all(s.status == "ok" for s in scenarios)
    stable = inference.stable_amounts if complete else []
    baseline = next((s for s in scenarios if s.id == "baseline"), None)
    if baseline is None and scenarios:
        baseline = scenarios[0]
    amounts = stable or (baseline.best_amounts if baseline else [])
    return DecisionAdvice(
        source="river-bet",
        model_version=result.model_version,
        code="recommendation",
        title=" / ".join("过牌" if n == 0 else f"下注 {n}" for n in amounts) or "查看河牌比较",
        reason=result.recommendation or "根据本手行动历史与响应模型比较候选金额。",
        stability=(
            "情景不足，暂不能判断稳定性"
            if not complete
            else "三种假设下均为最优候选"
            if stable
            else "对对手假设敏感"
        ),
        actions=[AdviceAction(action="check" if n == 0 else "bet", amount=n) for n in amounts],
    )


def tree_advice(result: AnalysisResult | None) -> DecisionAdvice | None:
    if result is None or result.limited_tree is None:
        return None
    tree = result.limited_tree
    baseline = next((s for s in tree.scenarios if s.id == "baseline"), None)
    labels = baseline.best_actions if baseline else []
    return DecisionAdvice(
        source="postflop-tree",
        model_version=result.model_version,
        code="marginal" if tree.marginal else "recommendation",
        title=(
            "当前仅评估过牌，未比较下注"
            if len(result.candidates) == 1
            else "候选收益接近，暂不下结论"
            if tree.marginal
            else "有限树倾向" + (" / ".join(labels) or "查看动作比较")
        ),
        reason="比较当前行动与下一街固定应对，后续其余街无下注；不含当前加注或对手再加注。",
        stability="三种模型假设下最优候选一致" if tree.stable_actions else "建议对对手假设敏感",
        actions=[]
        if tree.marginal
        else [
            AdviceAction(action=c.action, amount=c.amount or 0)
            for c in result.candidates
            if (
                "弃牌"
                if c.action == "fold"
                else "过牌"
                if c.action == "check"
                else f"{'跟注' if c.action == 'call' else '下注'} {c.amount}"
            )
            in labels
        ],
    )
