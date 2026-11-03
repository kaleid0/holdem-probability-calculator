"""Replay structured events before using them as behavioral evidence."""

from collections.abc import Callable
from dataclasses import dataclass

from poker_calculator.domain.sensitivity import ActionEvent, SensitivityRequest


class HistoryInsufficient(ValueError):
    pass


@dataclass(frozen=True)
class Decision:
    event: ActionEvent
    board: tuple[int, ...]
    legal: tuple[str, ...]
    effective_stack: int | None
    late_position: bool
    raises_before: int = 0


@dataclass(frozen=True)
class ReplayState:
    actor: int
    pending: frozenset[int]
    active: frozenset[int]
    total: tuple[int, ...]
    ended: bool
    minimum: int
    paid: tuple[int, ...]
    highest: int
    acted_at: tuple[int | None, ...]


def replay_state(
    request: SensitivityRequest, checkpoint: Callable[[], None] | None = None
) -> tuple[list[Decision], list[str], ReplayState]:
    h = request.history_context
    if h is None or not h.complete:
        raise HistoryInsufficient("缺少完整本手历史，请新开一手逐步记录，或使用手动范围比较")
    if h.cutoff_sequence > len(h.events):
        raise ValueError("历史截止序号超出已有事件")
    if any(e.kind != "action" for e in h.events[:2]):
        raise ValueError("完整历史必须从大小盲注开始")
    seats = h.opening_seats
    if len(set(seats)) != len(seats) or any(i >= h.count for i in seats):
        raise ValueError("开局座位无效")
    if 0 not in seats or h.dealer not in seats or h.big_blind < h.small_blind:
        raise ValueError("庄家、盲注或开局参与座位无效")
    if h.stacks is not None and (
        len(h.stacks) != h.count or {i for i, n in enumerate(h.stacks) if n > 0} != set(seats)
    ):
        raise ValueError("开局筹码与开局参与座位不一致")
    total = [0] * h.count
    paid = [0] * h.count
    active = set(seats)
    board: tuple[int, ...] = ()
    street = 0
    highest = 0
    minimum = h.big_blind
    pending: set[int] = set()
    acted: dict[int, int] = {}
    ended = False
    decisions: list[Decision] = []
    raises = 0

    def next_seat(after: int, eligible: set[int]) -> int:
        return next(
            (
                (after + offset) % h.count
                for offset in range(1, h.count + 1)
                if (after + offset) % h.count in eligible
            ),
            after,
        )

    def remaining(i: int) -> int:
        return h.stacks[i] - total[i] if h.stacks is not None else 10**30

    sb = h.dealer if len(seats) == 2 else next_seat(h.dealer, active)
    bb = next_seat(sb, active)
    actor = bb
    for seq, event in enumerate(h.events[: h.cutoff_sequence], 1):
        if checkpoint:
            checkpoint()
        if event.sequence != seq or ended:
            raise ValueError("事件序号不连续或结束后仍有行动")
        if event.kind == "street":
            expected = 3 if street == 0 else street + 1
            if pending or event.street != expected or len(active) < 2:
                raise ValueError("发牌时机或街顺序无效")
            if event.board is None:
                raise HistoryInsufficient(f"事件 {seq} 缺少当时的公共牌")
            if (
                len(event.board) != expected
                or len(set(event.board)) != expected
                or tuple(event.board[: len(board)]) != board
            ):
                raise ValueError("逐街公共牌不构成合法前缀")
            board = tuple(event.board)
            street = expected
            paid = [0] * h.count
            highest, minimum = 0, h.big_blind
            raises = 0
            acted = {}
            funded = {i for i in active if remaining(i) > 0}
            pending = funded if len(funded) > 1 else set()
            actor = next_seat(h.dealer, pending)
            continue
        if event.street != street:
            raise ValueError("事件街与重放状态不一致")
        if event.kind == "handEnd":
            valid = (
                event.reason == "allOthersFolded" and len(active) == 1 and event.winner in active
            ) or (
                event.reason == "showdown"
                and street == 5
                and not pending
                and len(active) > 1
                and event.winner is None
            )
            if not valid or event.pot != sum(total):
                raise ValueError("结束事件与牌局不一致")
            ended = True
            continue
        p, a = event.player, event.action
        if p not in active or p >= h.count:
            raise ValueError("未参与或已弃牌玩家不能行动")
        blind = seq <= 2
        if blind:
            expected_action, expected_seat, blind_amount = (
                ("smallBlind", sb, h.small_blind) if seq == 1 else ("bigBlind", bb, h.big_blind)
            )
            if a != expected_action or p != expected_seat:
                raise ValueError("历史必须从正确的大小盲注开始")
            amount = min(blind_amount, remaining(p))
            due = highest
        else:
            if p != actor or p not in pending or remaining(p) <= 0:
                raise ValueError("行动次序或行动玩家无效")
            due = highest - paid[p]
            raise_allowed = (
                any(i != p and remaining(i) > 0 for i in active)
                and (p not in acted or highest - acted[p] >= minimum)
                and remaining(p) > due
            )
            legal = ["fold", "call" if due else "check"]
            if raise_allowed:
                legal.append("raise" if highest else "bet")
            if a not in legal:
                raise ValueError("行动不属于当时的合法动作")
            if a in ("fold", "check"):
                amount = 0
            elif a == "call":
                amount = min(due, remaining(p))
            else:
                amount = event.streetTotal - paid[p]
                increment = event.streetTotal - highest
                if (
                    increment <= 0
                    or amount > remaining(p)
                    or (increment < minimum and amount != remaining(p))
                ):
                    raise ValueError("下注尺度或最小加注不合法")
            opponents = [remaining(i) for i in active if i != p]
            effective = min(remaining(p), max(opponents)) if h.stacks is not None else None
            decisions.append(
                Decision(
                    event,
                    board,
                    tuple(legal),
                    effective,
                    p == h.dealer or (len(seats) >= 4 and next_seat(p, set(seats)) == h.dealer),
                    raises,
                )
            )
        if (
            event.amount != amount
            or event.streetTotal != paid[p] + amount
            or event.totalCommitted != total[p] + amount
            or event.toCall != due
            or event.highestBefore != highest
            or event.minRaiseBefore != minimum
            or event.potBefore != sum(total)
            or event.potAfter != sum(total) + amount
            or event.activePlayersBefore != len(active)
        ):
            raise ValueError(f"事件 {seq} 的金额或行动前状态与重放不一致")
        paid[p] += amount
        total[p] += amount
        if blind:
            highest = max(paid)
            if seq == 2:
                funded = {i for i in active if remaining(i) > 0}
                highest = h.big_blind if len(funded) > 1 else max(paid)
                pending = funded if len(funded) > 1 else {i for i in funded if paid[i] < max(paid)}
                actor = next_seat(bb, pending)
        else:
            if a == "fold":
                active.remove(p)
            if a in ("raise", "bet"):
                raises += 1
                minimum = max(minimum, paid[p] - highest)
                highest = paid[p]
            acted[p] = highest
            funded = {i for i in active if remaining(i) > 0}
            pending = funded - {p} if a in ("raise", "bet") else pending & funded - {p}
            if len(funded) == 1:
                pending = {i for i in pending if paid[i] < highest}
            if len(active) == 1:
                pending = set()
            actor = next_seat(p, pending)
    base = request.base_analysis
    if 0 not in active or set(request.opponent_seats) != active - {0}:
        raise ValueError("历史中的在局玩家与当前分析不一致")
    if list(board) != base.board or sum(total) != base.pot_before_call:
        raise ValueError("历史截止点的公共牌或底池与当前分析不一致")
    if base.call_amount != min(highest - paid[0], remaining(0)):
        raise ValueError("历史截止点的跟注金额不一致")
    context = base.pot_context
    if context is None:
        raise ValueError("历史推断需要逐人投入上下文")
    if context.contributions != [total[i] for i in [0, *request.opponent_seats]] or sorted(
        context.folded_contributions
    ) != sorted(total[i] for i in range(h.count) if i not in active):
        raise ValueError("当前逐人投入与历史不一致")
    closed = actor == 0 and pending == {0}
    if context.betting_closed_after_call and not closed:
        raise ValueError("行动尚未闭合，不能声明跟注后直接摊牌")
    warnings = [] if h.stacks is not None else ["缺少起始筹码，已跳过有效筹码相关规则"]
    return (
        decisions,
        warnings,
        ReplayState(
            actor=actor,
            pending=frozenset(pending),
            active=frozenset(active),
            total=tuple(total),
            ended=ended,
            minimum=minimum,
            paid=tuple(paid),
            highest=highest,
            acted_at=tuple(acted.get(i) for i in range(h.count)),
        ),
    )


def replay(
    request: SensitivityRequest, checkpoint: Callable[[], None] | None = None
) -> tuple[list[Decision], list[str]]:
    decisions, warnings, _ = replay_state(request, checkpoint)
    return decisions, warnings
