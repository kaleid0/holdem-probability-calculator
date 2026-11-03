"""Explicit conservative fallback; never an evaluated future-action EV."""

import math

from poker_calculator.domain.advice import AdviceAction, DecisionAdvice
from poker_calculator.domain.decision import DecisionContext
from poker_calculator.domain.models import AnalysisResult


def continuation_advice(
    context: DecisionContext | None, result: AnalysisResult | None
) -> DecisionAdvice | None:
    if context is None or not context.hero_turn or context.remaining(0) <= 0:
        return None
    base, state = context.base, context.state
    due = base.call_amount
    answer = DecisionAdvice(
        source="continuation-rules",
        model_version="continuation-rules-v1",
        code="recommendation",
        title="倾向过牌（保守参考）",
        reason=(
            "当前可免费继续，默认过牌控制投入；尚未比较价值下注与诈唬收益，不能据此排除下注。"
            "支持的局面会由行动树或河牌比较替换此参考。"
        ),
        stability="后续行动启发式 v1；未计算完整行动 EV，非 GTO",
        actions=[AdviceAction(action="check")],
    )
    if not due:
        return answer
    equity = result.equity if result else None
    if equity is None or not math.isfinite(equity) or not 0 <= equity <= 1:
        return None
    if due == context.remaining(0) or any(
        state.total[i] > state.total[0] + due or context.remaining(i) == 0
        for i in state.active - {0}
    ):
        return answer.model_copy(
            update={
                "code": "review",
                "title": "全下或边池局面，需复核",
                "actions": [],
                "reason": (
                    "本局面不能用整个底池的单一权益门槛决定跟注，"
                    "请查看主池、边池与可争夺权益；未计算完整行动 EV。"
                ),
            }
        )
    threshold = due / (base.pot_before_call + due)
    future = base.settlement_assumption == "futureBettingPossible"
    open_action = any(i != 0 and context.remaining(i) > 0 for i in state.pending)
    reserve = (
        (0.08 if future else 0)
        + (0.05 if open_action else 0)
        + (0.04 if len(state.active) > 2 else 0)
    )
    error = result.equity_standard_error if result else None
    noise = 1.96 * error if error is not None and math.isfinite(error) and error >= 0 else 0.03
    gap = equity - threshold - reserve
    marginal = abs(gap) <= noise
    answer.code = "marginal" if marginal else "recommendation"
    answer.title = (
        "接近启发式门槛，需复核"
        if marginal
        else f"倾向跟注 {due}（启发式）"
        if gap > 0
        else "倾向弃牌（启发式）"
    )
    answer.reason = (
        f"当前范围权益 {equity:.1%}，直接底池赔率门槛 {threshold:.1%}；"
        f"另加 {reserve * 100:.0f} 个百分点的保守余量（后续下注、未闭合行动及多人因素）。"
        "余量是项目规则，并非计算出的未来损失；未比较加注、隐含赔率或未来弃牌收益，可能放弃有利跟注。"
    )
    answer.actions = (
        []
        if marginal
        else [AdviceAction(action="call" if gap > 0 else "fold", amount=due if gap > 0 else 0)]
    )
    answer.threshold, answer.reserve = threshold, reserve
    return answer
