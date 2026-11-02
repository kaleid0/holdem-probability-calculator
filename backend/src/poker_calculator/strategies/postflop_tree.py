"""Bounded, paired Monte Carlo rollout of declared public-information policies."""

import hashlib
import math
import random
import time
from typing import Literal, cast

from poker_calculator.application.sensitivity import features, infer
from poker_calculator.application.services import AnalysisServices
from poker_calculator.domain.history import Decision, ReplayState, replay_state
from poker_calculator.domain.models import (
    ActionAssessment,
    AnalysisRequest,
    AnalysisResult,
    ExactOpponent,
    LimitedTreeSummary,
    RandomOpponent,
    RangeOpponent,
    StrategyIdentity,
    SupportCheck,
    TreeScenario,
    WeightedCombo,
)
from poker_calculator.domain.sensitivity import SensitivityRequest
from poker_calculator.engines.evaluator import evaluate
from poker_calculator.strategies.history_ranges import HistoryRangeConfig
from poker_calculator.strategies.pot_odds import PotOddsStrategy

HORIZON = (
    "当前动作→对手弃牌/跟注→下一张公共牌→对手过牌/半池下注→我方固定规则跟注/弃牌→余牌无下注摊牌"
)
BASELINE = "从当前决策起的净筹码收益；此前投入为沉没成本"


def prepare(
    request: AnalysisRequest, config: HistoryRangeConfig, services: AnalysisServices
) -> tuple[SensitivityRequest, list[Decision], ReplayState]:
    h = config.history_context
    if len(request.board) not in (3, 4) or len(request.opponents) != 1:
        raise ValueError("有限树仅支持单挑翻牌或转牌")
    if h.count != 2 or h.dealer != 0 or h.stacks is None:
        raise ValueError("当前有限树需要开局即单挑、自己为庄位后位且筹码已记录")
    # Replay validates facts, regardless of whether the opponent's cards are known.
    template = SensitivityRequest(
        base_analysis=request.model_copy(update={"opponents": [RandomOpponent(kind="random")]}),
        target_seat=1,
        opponent_seats=config.opponent_seats,
        history_context=h,
    )
    decisions, _, state = replay_state(template, services.checkpoint)
    if state.ended or state.actor != 0 or state.pending != {0}:
        raise ValueError("须轮到自己且本次过牌或跟注能闭合当前街行动")
    if state.total[0] + request.call_amount != state.total[1]:
        raise ValueError("当前投入不匹配或存在未跟注退回，有限树暂不支持")
    if max(h.stacks) * 4 + request.pot_before_call > 9_007_199_254_740_991:
        raise ValueError("候选收益超出安全筹码范围")
    return template, decisions, state


def sigmoid(value: float) -> float:
    return 1 / (1 + math.exp(-value))


def continuation(
    share: float,
    pot: int,
    invested: int,
    capacity: int,
    hero: tuple[int, int],
    villain: tuple[int, int],
    next_board: tuple[int, ...],
    bias: float,
    shift: float,
    blind: int,
) -> float:
    """Integrate response probabilities; hero policy never reads villain's hidden cards."""
    if capacity <= 0:
        return share * pot - invested
    amount = min(capacity, max(blind, (pot + 1) // 2))
    strength, group = features(villain, next_board)
    bet_probability = sigmoid(-1 + 2 * strength + (bias if group != "value" else 0) + shift / 4)
    hero_strength, _ = features(hero, next_board)
    hero_calls = hero_strength >= amount / (pot + 2 * amount) + 0.1
    check_value = share * pot - invested
    bet_value = share * (pot + 2 * amount) - invested - amount if hero_calls else -invested
    return (1 - bet_probability) * check_value + bet_probability * bet_value


class PostflopTreeStrategy(PotOddsStrategy):
    manifest = PotOddsStrategy.manifest.model_copy(
        update={
            "id": "postflop-tree",
            "name": "翻牌/转牌有限行动树",
            "version": "0.1.0",
            "description": "单挑后位，比较当前动作及下一街固定应对；三种行为假设的有限树模拟。",
            "config_schema": HistoryRangeConfig.model_json_schema(),
            "capabilities": {
                "streets": ["flop", "turn"],
                "max_players": 2,
                "side_pots": False,
                "objective": "chip_ev",
                "opponent_models": ["random", "range", "exact"],
            },
        }
    )

    def validate_config(self, request: AnalysisRequest) -> None:
        HistoryRangeConfig.model_validate(request.strategy_config)

    def check_support(self, request: AnalysisRequest) -> SupportCheck:
        try:
            prepare(
                request,
                HistoryRangeConfig.model_validate(request.strategy_config),
                AnalysisServices(),
            )
        except ValueError as exc:
            return SupportCheck(status="missing-input", reasons=[str(exc)])
        return SupportCheck(status="supported")

    def analyze(self, request: AnalysisRequest, services: AnalysisServices) -> AnalysisResult:
        start = time.monotonic()
        config = HistoryRangeConfig.model_validate(request.strategy_config)
        template, decisions, state = prepare(request, config, services)
        h = config.history_context
        assert h.stacks is not None
        pot, due = request.pot_before_call, request.call_amount
        own = h.stacks[0] - state.total[0]
        other = h.stacks[1] - state.total[1]
        stack = min(own, other)
        actions: list[tuple[str, int]] = [("fold", 0), ("call", due)] if due else [("check", 0)]
        if not due and stack > 0:
            amounts = sorted(
                {
                    min(stack, max(h.big_blind, (pot * n + d // 2) // d))
                    for n, d in ((1, 3), (2, 3), (1, 1))
                }
            )
            actions.extend(("bet", a) for a in amounts if a >= h.big_blind or a == own)
        labels = [
            "弃牌"
            if a == "fold"
            else f"跟注 {b}"
            if a == "call"
            else "过牌"
            if a == "check"
            else f"下注 {b}"
            for a, b in actions
        ]
        outcomes: list[list[float]] = []
        errors: list[float] = []
        summaries = []
        samples = min(request.samples, 10_000)  # One bounded budget for every action.
        baseline_equity = baseline_se = 0.0
        marginal = False
        for scenario_index, (sid, name, bias, shift) in enumerate(
            (
                ("baseline", "基准", 0.0, 0.0),
                ("tight", "偏紧", -1.2, -0.8),
                ("loose", "偏松", 1.2, 0.8),
            )
        ):
            services.checkpoint()
            opponent = request.opponents[0]
            known = set(request.hero) | set(request.board) | set(request.dead_cards)
            if isinstance(opponent, ExactOpponent):
                combos = [WeightedCombo(cards=opponent.cards, weight=1)]
            elif isinstance(opponent, RangeOpponent):
                combos = [
                    WeightedCombo(cards=c.cards, weight=c.weight)
                    for c in opponent.expanded()
                    if not known.intersection(c.cards)
                ]
            else:
                combos, _, _, _ = infer(template, decisions, bias, services.checkpoint)
            if not combos:
                raise ValueError("对手范围被已知牌完全阻断")
            rng = random.Random(request.seed)
            # Every action shares the same hands and runouts, enabling paired EV errors.
            selected = rng.choices(combos, weights=[c.weight for c in combos], k=samples)
            values: list[list[float]] = [[] for _ in actions]
            shares = []
            decks = {
                c.cards: [v for v in range(52) if v not in known and v not in c.cards]
                for c in combos
            }
            for i, combo in enumerate(selected):
                if i % 100 == 0:
                    services.checkpoint()
                    services.report(scenario_index * samples + i, 3 * samples)
                runout = rng.sample(decks[combo.cards], 5 - len(request.board))
                board = (*request.board, *runout)
                next_board = (*request.board, runout[0])
                hero_rank = evaluate((*request.hero, *board))
                villain_rank = evaluate((*combo.cards, *board))
                share = (
                    1.0 if hero_rank < villain_rank else 0.5 if hero_rank == villain_rank else 0.0
                )
                shares.append(share)
                strength, _ = features(combo.cards, tuple(request.board))
                for j, (action, amount) in enumerate(actions):
                    if action == "fold":
                        value = 0.0
                    elif action in ("call", "check"):
                        value = continuation(
                            share,
                            pot + amount,
                            amount,
                            min(own - amount, other),
                            request.hero,
                            combo.cards,
                            next_board,
                            bias,
                            shift,
                            h.big_blind,
                        )
                    else:
                        probability = sigmoid(8 * (strength - amount / (pot + 2 * amount)) + shift)
                        called = continuation(
                            share,
                            pot + 2 * amount,
                            amount,
                            stack - amount,
                            request.hero,
                            combo.cards,
                            next_board,
                            bias,
                            shift,
                            h.big_blind,
                        )
                        value = (1 - probability) * pot + probability * called
                    values[j].append(value)
            means = [sum(v) / samples for v in values]
            outcomes.append(means)
            best = max(means)
            summaries.append(
                TreeScenario(
                    id=sid,
                    name=name,
                    best_actions=[labels[j] for j, v in enumerate(means) if abs(v - best) < 1e-9],
                )
            )
            if scenario_index == 0:
                baseline_equity = sum(shares) / samples
                baseline_se = standard_error(shares)
                errors = [standard_error(v) for v in values]
                deltas = [[x - y for x, y in zip(v, values[0], strict=True)] for v in values]
                delta_errors = [standard_error(v) for v in deltas]
                ordered = sorted(range(len(means)), key=lambda j: means[j], reverse=True)
                if len(ordered) > 1:
                    a, b = ordered[:2]
                    paired = [x - y for x, y in zip(values[a], values[b], strict=True)]
                    marginal = means[a] - means[b] <= 1.96 * standard_error(paired) + 1e-9
        stable = sorted(set.intersection(*(set(s.best_actions) for s in summaries)))
        best_label = " / ".join(summaries[0].best_actions)
        recommendation = (
            "收益接近，暂不下结论。" if marginal else f"有限树基准模型倾向{best_label}。"
        )
        recommendation += "三种假设下一致。" if stable else "建议对对手假设敏感。"
        if len(actions) == 1:
            recommendation = "当前仅有过牌候选，不能比较下注。"
        candidates = [
            ActionAssessment(
                action=cast(Literal["fold", "call", "check", "bet"], action),
                amount=amount,
                ev=outcomes[0][j],
                ev_baseline=BASELINE,
                method="limited-tree-monte-carlo-v1",
                explanation=HORIZON,
                ev_delta=outcomes[0][j] - outcomes[0][0],
                ev_standard_error=errors[j],
                delta_standard_error=delta_errors[j],
                ev_min=min(o[j] for o in outcomes),
                ev_max=max(o[j] for o in outcomes),
            )
            for j, (action, amount) in enumerate(actions)
        ]
        return AnalysisResult(
            method="monteCarlo",
            win_probability=None,
            tie_probability=None,
            lose_probability=None,
            equity=baseline_equity,
            equity_standard_error=baseline_se,
            sample_count=samples * 3,
            elapsed_ms=(time.monotonic() - start) * 1000,
            pot_odds_ratio=None,
            break_even_equity=None,
            call_ev=None,
            recommendation=recommendation,
            assumptions=[
                HORIZON,
                "当前下注后对手只弃牌或跟注；不比较当前加注或对手再加注。",
                "下一街对手最多半池下注；我方以公开牌面特征和赔率固定规则跟注或弃牌。",
                "后续其余街道无下注；无抽水、无ICM。三情景范围不是置信区间。",
                "行为与牌力特征为未校准启发式，非GTO或完整行动EV。",
                "随机对手从历史重建；手动范围与明牌保持不变。",
            ],
            strategy=StrategyIdentity(
                id=self.manifest.id, name=self.manifest.name, version=self.manifest.version
            ),
            scenario_hash=hashlib.sha256(request.model_dump_json().encode()).hexdigest(),
            seed=request.seed,
            model_version="limited-postflop-tree-v1",
            candidates=candidates,
            limited_tree=LimitedTreeSummary(
                horizon=HORIZON,
                scenarios=summaries,
                stable_actions=stable,
                marginal=marginal,
                sample_count_per_scenario=samples,
                elapsed_ms=(time.monotonic() - start) * 1000,
            ),
        )


def standard_error(values: list[float]) -> float:
    mean = sum(values) / len(values)
    return math.sqrt(sum((v - mean) ** 2 for v in values) / (len(values) - 1) / len(values))
