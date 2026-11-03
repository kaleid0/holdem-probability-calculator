"""Cheap scenario EV over a supplied equity estimate; no conditional-range solving."""

import math
from collections.abc import Callable

from poker_calculator.domain.advice import (
    ActionEvComparison,
    AdviceAction,
    EvRow,
    EvScenario,
    ResponseModel,
)
from poker_calculator.domain.decision import DecisionContext
from poker_calculator.domain.models import AnalysisResult


def clamp(value: float) -> float:
    return max(0, min(1, value))


def action_ev(
    context: DecisionContext | None,
    result: AnalysisResult | None,
    model: ResponseModel,
) -> ActionEvComparison:
    if context is None:
        return ActionEvComparison(reason="需要完整且一致的行动记录与开局筹码，暂不估算行动 EV。")
    if not context.hero_turn:
        return ActionEvComparison(reason="轮到你行动时比较候选 EV。")
    state, base = context.state, context.base
    opponents = sorted(state.active - {0})
    if len(opponents) != 1:
        return ActionEvComparison(reason="当前行动模型仅支持单挑；多人请参考直接摊牌跟注 EV。")
    seat = opponents[0]
    hero, villain = context.remaining(0), context.remaining(seat)
    call, pot = base.call_amount, base.pot_before_call
    if hero <= 0:
        return ActionEvComparison(reason="当前没有可追加筹码。")
    if state.total[0] + call != state.total[seat] or any(
        n > state.total[0] + call for i, n in enumerate(state.total) if i not in state.active
    ):
        return ActionEvComparison(reason="存在边池或未匹配投入，暂不套用单挑行动模型。")
    if result is None or result.equity is None:
        return ActionEvComparison(reason="等待当前牌局权益计算完成。")
    equity = result.equity
    if not math.isfinite(equity) or not 0 <= equity <= 1:
        return ActionEvComparison(reason="当前权益不可用。")
    error = result.equity_standard_error
    se = error if error is not None and math.isfinite(error) and error >= 0 else 0.03
    shift = max(0.08, 1.96 * se)
    scenarios = [
        EvScenario(name="基准", equity=equity, **model.model_dump(by_alias=True)),
        EvScenario.model_validate(
            {
                "name": "不利假设",
                "equity": clamp(equity - shift),
                "fold": model.fold * 0.5,
                "raise": min(1 - model.fold * 0.5, model.raise_ * 1.5),
                "probe": clamp(model.probe + 0.15),
            }
        ),
        EvScenario.model_validate(
            {
                "name": "有利假设",
                "equity": clamp(equity + shift),
                "fold": clamp(model.fold + 0.15),
                "raise": min(1 - clamp(model.fold + 0.15), model.raise_ * 0.5),
                "probe": clamp(model.probe - 0.15),
            }
        ),
    ]
    future = base.settlement_assumption == "futureBettingPossible" and len(base.board) != 5

    def continuation(p: int, h: int, v: int, e: float, probe: float) -> float:
        bet = min((p + 1) // 2, h, v)
        if not future or bet <= 0:
            return e * p
        return (1 - probe) * e * p + probe * max(0, e * (p + 2 * bet) - bet)

    rows: list[EvRow] = []

    def add(
        label: str,
        action: AdviceAction,
        additional: int,
        evaluate: Callable[[EvScenario, float], float],
    ) -> None:
        rows.append(
            EvRow(
                label=label,
                action=action,
                additional=additional,
                values=[evaluate(s, s.equity) for s in scenarios],
                errors=[
                    max(
                        abs(evaluate(s, clamp(s.equity + 1.96 * se)) - evaluate(s, s.equity)),
                        abs(evaluate(s, clamp(s.equity - 1.96 * se)) - evaluate(s, s.equity)),
                    )
                    for s in scenarios
                ],
            )
        )

    if call:
        add("弃牌", AdviceAction(action="fold"), 0, lambda s, e: 0)
    add(
        f"跟注 {call}" if call else "过牌",
        AdviceAction(action="call" if call else "check", amount=call),
        call,
        lambda s, e: continuation(pot + call, hero - call, villain, e, s.probe) - call,
    )
    minimum = state.highest + state.minimum
    maximum = min(state.paid[0] + hero, state.paid[seat] + villain)
    if context.can_raise and villain > 0:
        targets = {
            min(maximum, max(minimum, state.highest + math.ceil((pot + call) * fraction)))
            for fraction in (0.5, 1, 2)
        } | {maximum}
        for target in sorted(targets):
            if target <= state.highest or (target < minimum and target != state.paid[0] + hero):
                continue
            h, v = target - state.paid[0], target - state.paid[seat]
            if h <= call or v < 0 or pot + h + v > 9_007_199_254_740_991:
                continue

            def evaluate(s: EvScenario, e: float, h: int = h, v: int = v) -> float:
                reraises = 0 if hero == h or villain == v else s.raise_
                return (
                    s.fold * pot
                    - reraises * h
                    + (1 - s.fold - reraises)
                    * (continuation(pot + h + v, hero - h, villain - v, e, s.probe) - h)
                )

            add(
                f"{'加注至' if call else '下注至'} {target}",
                AdviceAction(
                    action="raise" if call else "bet", amount=target, amount_kind="street_total"
                ),
                h,
                evaluate,
            )
    best_by_scenario = []
    for index in range(len(scenarios)):
        top = max(rows, key=lambda row: row.values[index])
        best_by_scenario.append(
            [
                row.label
                for row in rows
                if top.values[index] - row.values[index]
                <= top.errors[index] + row.errors[index] + 1e-9
            ]
        )
    return ActionEvComparison(
        rows=rows,
        scenarios=scenarios,
        best=best_by_scenario[0],
        stable=[
            label
            for label in best_by_scenario[0]
            if all(label in best for best in best_by_scenario)
        ],
    )
