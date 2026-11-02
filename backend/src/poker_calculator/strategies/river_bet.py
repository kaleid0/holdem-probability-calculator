"""Terminal heads-up river betting with explicit, coherent opponent responses."""

import hashlib
import time
from itertools import combinations
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from poker_calculator.application.services import AnalysisServices
from poker_calculator.domain.models import (
    ActionAssessment,
    AnalysisRequest,
    AnalysisResult,
    Chips,
    ExactOpponent,
    RangeOpponent,
    StrategyIdentity,
    StrategyManifest,
    SupportCheck,
)
from poker_calculator.domain.ranges import Combo, parse_range, remove_blocked
from poker_calculator.domain.sensitivity import HistoryContext, Seat

BASELINE = "从当前决策起的净筹码收益（不计此前投入）"
SAFE_CHIPS = 9_007_199_254_740_991


class RiverBetOption(BaseModel):
    model_config = ConfigDict(extra="forbid")

    amount: Chips = Field(gt=0)
    fold_probability: float = Field(default=0, ge=0, le=1, allow_inf_nan=False)
    calling_range: str = Field(default="", max_length=65536)

    @model_validator(mode="after")
    def validate_range(self) -> "RiverBetOption":
        if self.calling_range.strip():
            parse_range(self.calling_range)
        return self


class RiverBetConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    effective_stack: Chips | None = Field(default=None, gt=0)
    mode: Literal["manual", "auto"] = "manual"
    history_context: HistoryContext | None = None
    opponent_seats: list[Seat] = Field(default_factory=list, max_length=8)
    preflop_prior: str = Field(default="", max_length=65536)
    check_closes_action: bool = False
    bets: list[RiverBetOption] = Field(
        default_factory=lambda: [RiverBetOption(amount=n) for n in (50, 100, 150)],
        min_length=1,
        max_length=6,
    )

    @model_validator(mode="after")
    def unique_amounts(self) -> "RiverBetConfig":
        if self.preflop_prior.strip():
            parse_range(self.preflop_prior)
        if len({bet.amount for bet in self.bets}) != len(self.bets):
            raise ValueError("下注金额不能重复")
        return self


def current_combos(request: AnalysisRequest) -> list[Combo]:
    opponent = request.opponents[0]
    known = set(request.hero) | set(request.board) | set(request.dead_cards)
    if isinstance(opponent, ExactOpponent):
        a, b = sorted(opponent.cards)
        return [Combo((a, b), 1)]
    if isinstance(opponent, RangeOpponent):
        return remove_blocked(opponent.expanded(), known)
    return [Combo(pair, 1) for pair in combinations(range(52), 2) if not known.intersection(pair)]


def response_error(request: AnalysisRequest, bet: RiverBetOption) -> str | None:
    """Ensure the conditional calling distribution can come from the current range."""
    if not bet.calling_range.strip() or bet.fold_probability == 1:
        return None
    known = set(request.hero) | set(request.board) | set(request.dead_cards)
    calls = remove_blocked(parse_range(bet.calling_range), known)
    if not calls:
        return "跟注范围被已知牌完全阻断"
    starting = current_combos(request)
    total = sum(c.weight for c in starting)
    prior = {tuple(sorted(c.cards)): c.weight / total for c in starting}
    call_total = sum(c.weight for c in calls)
    for combo in calls:
        probability = prior.get(tuple(sorted(combo.cards)), 0)
        if probability == 0:
            return "跟注范围必须是当前对手范围的子集"
        if (1 - bet.fold_probability) * combo.weight / call_total > probability + 1e-12:
            return (
                "弃牌率与跟注范围不一致：部分组合的跟注概率超过原范围概率，"
                "请提高弃牌率或扩大跟注范围"
            )
    return None


class RiverBetStrategy:
    manifest = StrategyManifest(
        id="river-bet",
        name="河牌下注 EV",
        version="0.3.0",
        description="单挑河牌自动读取筹码和行动历史，推断范围及下注响应；也支持手动配置。",
        config_schema=RiverBetConfig.model_json_schema(),
        capabilities={
            "streets": ["river"],
            "max_players": 2,
            "side_pots": False,
            "objective": "chip_ev",
            "opponent_models": ["random", "exact", "range"],
        },
    )

    def validate_config(self, request: AnalysisRequest) -> None:
        RiverBetConfig.model_validate(request.strategy_config)

    def check_support(self, request: AnalysisRequest) -> SupportCheck:
        reasons = []
        if len(request.board) != 5:
            reasons.append("仅支持五张公共牌齐全的河牌局面")
        if len(request.opponents) != 1:
            reasons.append("仅支持一名在局对手")
        if request.call_amount != 0:
            reasons.append("当前需跟注；本策略仅比较无需跟注时的过牌与主动下注")
        if request.pot_before_call <= 0:
            reasons.append("当前底池必须大于零")
        if request.pot_context and len(set(request.pot_context.contributions)) != 1:
            reasons.append("不支持边池或尚未匹配的投入")
        if reasons:
            return SupportCheck(status="unsupported", reasons=reasons)
        config = RiverBetConfig.model_validate(request.strategy_config)
        if config.mode == "auto":
            from poker_calculator.application.river_inference import prepare_history

            try:
                prepare_history(request, config)
            except ValueError as exc:
                return SupportCheck(status="missing-input", reasons=[str(exc)])
            return SupportCheck(status="supported")
        if not config.check_closes_action:
            reasons.append("请确认过牌后直接摊牌（例如对手已过牌且你最后行动）")
        if config.effective_stack is None:
            reasons.append("请填写有效筹码：双方剩余筹码的较小值")
        for bet in config.bets:
            if config.effective_stack is not None and bet.amount > config.effective_stack:
                reasons.append(f"下注 {bet.amount} 超过有效筹码 {config.effective_stack}")
            if request.pot_before_call + 2 * bet.amount > SAFE_CHIPS:
                reasons.append(f"下注 {bet.amount} 后的底池超出安全整数范围")
            error = response_error(request, bet)
            if error:
                reasons.append(f"下注 {bet.amount}：{error}")
        return SupportCheck(status="missing-input" if reasons else "supported", reasons=reasons)

    def analyze(self, request: AnalysisRequest, services: AnalysisServices) -> AnalysisResult:
        config = RiverBetConfig.model_validate(request.strategy_config)
        if config.mode == "auto":
            from poker_calculator.application.river_inference import analyze_automatic

            return analyze_automatic(request, config, services)
        support = self.check_support(request)
        if support.status != "supported":
            raise ValueError("；".join(support.reasons))
        start = time.monotonic()
        # At most 990 legal opponent combinations: exact river enumeration is inexpensive.
        scenario = request.model_copy(update={"equity_method": "auto", "pot_context": None})
        equity = services.equity(scenario)
        pot = request.pot_before_call
        candidates = [
            ActionAssessment(
                action="check",
                amount=0,
                ev=equity.equity * pot,
                ev_baseline=BASELINE,
                method="terminal-river-response",
                showdown_equity=equity.equity,
                explanation="过牌后直接摊牌；EV = 当前范围权益 × 当前底池。",
            )
        ]
        sample_count = equity.sample_count
        for bet in config.bets:
            services.checkpoint()
            called_equity = None
            value = float(pot)
            if bet.fold_probability < 1:
                called = equity
                if bet.calling_range.strip():
                    conditional = scenario.model_copy(
                        update={"opponents": [RangeOpponent(kind="range", text=bet.calling_range)]}
                    )
                    called = services.equity(conditional)
                    sample_count += called.sample_count
                called_equity = called.equity
                value = bet.fold_probability * pot + (1 - bet.fold_probability) * (
                    called_equity * (pot + 2 * bet.amount) - bet.amount
                )
            candidates.append(
                ActionAssessment(
                    action="bet",
                    amount=bet.amount,
                    ev=value,
                    ev_baseline=BASELINE,
                    method="terminal-river-response",
                    fold_probability=bet.fold_probability,
                    showdown_equity=called_equity,
                    explanation=(
                        "EV = F × P + (1−F) × [被跟注权益 × (P+2B) − B]；"
                        f"P={pot}，B={bet.amount}，F={bet.fold_probability:.2%}。"
                        + (
                            "对手总是弃牌，不计算被跟注权益。"
                            if bet.fold_probability == 1
                            else "使用指定的条件跟注范围。"
                            if bet.calling_range.strip()
                            else "跟注范围沿用当前范围；假设弃牌与手牌无关。"
                        )
                    ),
                )
            )
        best = max(c.ev for c in candidates if c.ev is not None)
        labels = [
            "过牌" if c.action == "check" else f"下注 {c.amount}"
            for c in candidates
            if c.ev is not None and abs(c.ev - best) <= 1e-8
        ]
        return AnalysisResult(
            method="exact",
            win_probability=equity.win_probability,
            tie_probability=equity.tie_probability,
            lose_probability=equity.lose_probability,
            equity=equity.equity,
            equity_standard_error=None,
            sample_count=sample_count,
            elapsed_ms=(time.monotonic() - start) * 1000,
            pot_odds_ratio=None,
            break_even_equity=None,
            call_ev=None,
            recommendation=(
                f"在当前响应假设及候选金额内，{'、'.join(labels)}的 EV 最高（{best:.2f} 筹码）。"
            ),
            assumptions=[
                "河牌单挑，无需跟注；过牌直接摊牌。下注后对手只弃牌或跟注，不加注。",
                "有效筹码由用户填写；下注不能超过双方剩余筹码的较小值。",
                "不计抽水、ICM；平局等分底池。已投入筹码视为沉没成本。",
                "弃牌率与条件跟注范围是用户假设，不根据行动历史自动推断。",
                "留空跟注范围时沿用当前范围，假设弃牌与手牌无关；指定范围时校验响应概率一致性。",
                "仅比较已配置金额，结果不表示全局最优或 GTO 策略。",
            ],
            strategy=StrategyIdentity(
                id=self.manifest.id, name=self.manifest.name, version=self.manifest.version
            ),
            scenario_hash=hashlib.sha256(
                request.model_dump_json(
                    exclude={"strategy_id", "strategy_config", "strategies"}
                ).encode()
            ).hexdigest(),
            seed=request.seed,
            engine_version="0.3.0",
            model_version="terminal-river-response-v1",
            candidates=candidates,
            signals=[
                "上方权益对应当前对手范围；下注行的权益对应被跟注后的条件范围。",
                "候选 EV 使用当前决策起的净收益；不能与以弃牌为零点的跟注参考 EV 直接排名。",
            ],
            strategy_config=config.model_dump(),
        )
