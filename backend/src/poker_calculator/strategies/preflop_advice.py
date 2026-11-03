"""Project-authored training rules; not a solver output or a sourced chart."""

import math

from poker_calculator.domain.advice import AdviceAction, DecisionAdvice
from poker_calculator.domain.decision import DecisionContext
from poker_calculator.domain.ranges import parse_range

PREFLOP_RULES = {
    "early": "66+,ATs+,KJs+,QJs,AQo+",
    "middle": "55+,A9s+,KTs+,QTs+,JTs,AJo+,KQo",
    "late": "22+,A2s+,K9s+,Q9s+,J9s+,T9s,98s,ATo+,KJo+,QJo",
    "premium": "QQ+,AKs,AKo",
    "defend": "88+,AJs+,KQs,AQo+",
}
HANDS = {
    key: {tuple(sorted(combo.cards)) for combo in parse_range(text)}
    for key, text in PREFLOP_RULES.items()
}
RANKS = "23456789TJQKA"


def preflop_advice(context: DecisionContext | None) -> DecisionAdvice | None:
    if context is None or context.base.board or not context.hero_turn:
        return None
    base, history, state = context.base, context.history, context.state
    seats = sorted(history.opening_seats, key=lambda s: (s - history.dealer) % history.count)
    sb = history.dealer if len(seats) == 2 else seats[1]
    bb = seats[1] if len(seats) == 2 else seats[2]
    cutoff = seats[-1] if len(seats) >= 4 else None
    position = (
        "庄位 BTN"
        if history.dealer == 0
        else "小盲 SB"
        if sb == 0
        else "大盲 BB"
        if bb == 0
        else "关煞位 CO"
        if cutoff == 0
        else "前中位"
    )
    opponents = [context.remaining(i) for i in state.active if i != 0]
    if not opponents:
        return None
    effective = min(context.remaining(0), max(opponents))
    depth = effective / history.big_blind
    a, b = sorted(base.hero, reverse=True)
    hand = RANKS[a // 4] + RANKS[b // 4]
    if a // 4 != b // 4:
        hand += "s" if a % 4 == b % 4 else "o"
    events = [d.event for d in context.decisions]
    raises = sum(e.action in ("raise", "bet") for e in events)
    limpers = sum(e.action == "call" for e in events)
    band = (
        "late"
        if history.dealer == 0 or cutoff == 0 or len(seats) == 2
        else "middle"
        if len(seats) <= 5
        else "early"
    )
    prefix = f"{position}，{hand}，有效剩余筹码 {depth:.1f} BB（按最大可争夺对手计算）。"

    def answer(title: str, reason: str, action: AdviceAction | None = None) -> DecisionAdvice:
        return DecisionAdvice(
            source="preflop-rules",
            model_version="preflop-training-v1",
            code="recommendation" if action else "review",
            title=title,
            reason=prefix + reason,
            stability="项目启发式规则 v1；未计算加注 EV，非 GTO 表",
            actions=[action] if action else [],
        )

    if depth < 20 or raises > 1 or any(e.player == 0 for e in events) or 0 in opponents:
        return answer(
            "翻前复杂局面，需复核", "短筹码、全下或再次行动超出当前规则覆盖；请结合范围权益复核。"
        )
    due = base.call_amount
    playable = tuple(sorted(base.hero)) in HANDS["defend" if raises else band]
    passive = AdviceAction(action="call" if due else "check", amount=due)
    if not playable:
        coverage = "面对单次加注" if raises else "后位" if band == "late" else "前中位"
        return answer(
            "倾向弃牌" if due else "倾向过牌",
            f"手牌未进入{coverage}规则范围。",
            AdviceAction(action="fold" if due else "check"),
        )
    if raises and tuple(sorted(base.hero)) not in HANDS["premium"]:
        if state.highest > 4 * history.big_blind or due > effective * 0.1:
            return answer("面对较大加注，需复核", "当前规则不自动推荐高成本跟注。")
        return answer(
            f"倾向跟注 {due}" if due else "倾向过牌",
            "手牌进入单次小额加注防守范围；后续仍可下注。",
            passive,
        )
    if not context.can_raise:
        return answer(
            f"跟注参考 {due}" if due else "倾向过牌",
            "当前加注权未开放，不建议非法再加注。",
            passive,
        )
    target = math.ceil(
        state.highest * 3
        if raises
        else history.big_blind * ((2.5 if depth >= 40 else 2.2) + limpers)
    )
    raise_to = max(state.highest + state.minimum, target)
    if raise_to > 9_007_199_254_740_991 or raise_to - state.paid[0] > effective * 0.3:
        return answer("加注投入较大，需复核", "建议尺度会占用过多有效筹码，暂不自动给金额。")
    return answer(
        f"倾向加注至 {raise_to}",
        f"本街总额 {raise_to}，本次追加 {raise_to - state.paid[0]}；"
        f"{'优质牌单次再加注' if raises else '位置开池规则'}。",
        AdviceAction(action="raise", amount=raise_to, amount_kind="street_total"),
    )
