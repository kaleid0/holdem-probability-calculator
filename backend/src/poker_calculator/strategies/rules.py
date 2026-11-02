"""Explicit equity-margin heuristic; risk preferences never alter mathematical EV."""

from pydantic import BaseModel, ConfigDict, Field

from poker_calculator.application.services import AnalysisServices
from poker_calculator.domain.models import (
    AnalysisRequest,
    AnalysisResult,
    StrategyIdentity,
    SupportCheck,
)
from poker_calculator.engines.pots import PotAccumulator
from poker_calculator.strategies.pot_odds import PotOddsStrategy


class RuleConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    equity_margin: float = Field(default=0.05, ge=0, le=0.5, allow_inf_nan=False)


class RuleStrategy(PotOddsStrategy):
    manifest = PotOddsStrategy.manifest.model_copy(
        update={
            "id": "equity-rules",
            "name": "权益余量规则",
            "version": "0.3.0",
            "description": "按用户设定的权益安全余量输出跟注倾向；属于启发式偏好，不改变 EV。",
            "config_schema": RuleConfig.model_json_schema(),
            "capabilities": {**PotOddsStrategy.manifest.capabilities, "side_pots": False},
        }
    )

    def validate_config(self, request: AnalysisRequest) -> None:
        RuleConfig.model_validate(request.strategy_config)

    def check_support(self, request: AnalysisRequest) -> SupportCheck:
        if request.pot_context:
            pots = PotAccumulator(request).pots
            if (
                len(pots) != 1
                or pots[0].is_refund
                or len(pots[0].eligible) != len(request.opponents) + 1
            ):
                return SupportCheck(
                    status="unsupported",
                    reasons=["权益余量规则暂仅支持单底池；分池请使用底池赔率基线"],
                )
            if not request.pot_context.betting_closed_after_call:
                return SupportCheck(status="unsupported", reasons=["尚有其他玩家待行动"])

        if request.call_amount == 0:
            return SupportCheck(
                status="unsupported", reasons=["没有跟注额，本规则不比较过牌与下注"]
            )
        if request.settlement_assumption != "showdownAfterCall":
            return SupportCheck(
                status="unsupported", reasons=["本规则仅支持跟注后无后续投入的场景"]
            )
        return SupportCheck(status="supported")

    def analyze(self, request: AnalysisRequest, services: AnalysisServices) -> AnalysisResult:
        config = RuleConfig.model_validate(request.strategy_config)
        result = super().analyze(request, services)
        assert result.equity is not None and result.break_even_equity is not None
        target = result.break_even_equity + config.equity_margin
        meets = result.equity >= target
        result.strategy = StrategyIdentity(
            id=self.manifest.id, name=self.manifest.name, version=self.manifest.version
        )
        result.recommendation = (
            "权益达到规则阈值，偏向跟注。" if meets else "权益未达到规则阈值，偏向弃牌。"
        )
        result.signals = [
            f"所需权益 {result.break_even_equity:.2%} + 用户余量 {config.equity_margin:.2%}"
            f" = 阈值 {target:.2%}",
            f"当前权益 {result.equity:.2%}，{'触发跟注' if meets else '触发弃牌'}倾向。",
            "余量是偏好而非盈利保证；本规则不评估加注，也不改写候选动作 EV。",
        ]
        result.strategy_config = config.model_dump()
        result.assumptions.append("启发式规则；余量可能导致放弃正参考 EV 的跟注。")
        return result
