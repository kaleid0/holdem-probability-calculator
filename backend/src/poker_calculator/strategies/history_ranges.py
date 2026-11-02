"""Rebuild random opponents from a uniform prior on every history snapshot."""

from pydantic import BaseModel, ConfigDict, Field

from poker_calculator.application.sensitivity import infer
from poker_calculator.application.services import AnalysisServices
from poker_calculator.domain.history import replay_state
from poker_calculator.domain.models import (
    AnalysisRequest,
    AnalysisResult,
    HistoryRangeSummary,
    RangeOpponent,
    StrategyIdentity,
    SupportCheck,
)
from poker_calculator.domain.sensitivity import HistoryContext, SensitivityRequest
from poker_calculator.strategies.pot_odds import PotOddsStrategy


class HistoryRangeConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    history_context: HistoryContext
    opponent_seats: list[int] = Field(min_length=1, max_length=8)


def inference_request(request: AnalysisRequest, config: HistoryRangeConfig) -> SensitivityRequest:
    target = next(
        (
            seat
            for seat, o in zip(config.opponent_seats, request.opponents, strict=True)
            if o.kind == "random"
        ),
        None,
    )
    if target is None:
        raise ValueError("没有随机对手；手动范围与明牌保持不变")
    return SensitivityRequest(
        base_analysis=request,
        target_seat=target,
        opponent_seats=config.opponent_seats,
        history_context=config.history_context,
    )


class HistoryRangeStrategy(PotOddsStrategy):
    manifest = PotOddsStrategy.manifest.model_copy(
        update={
            "id": "history-ranges",
            "name": "本手行动范围",
            "version": "0.1.0",
            "description": "完整逐步记录下，按本手行动更新随机对手范围；手动范围与明牌不变。",
            "config_schema": HistoryRangeConfig.model_json_schema(),
        }
    )

    def validate_config(self, request: AnalysisRequest) -> None:
        HistoryRangeConfig.model_validate(request.strategy_config)

    def check_support(self, request: AnalysisRequest) -> SupportCheck:
        try:
            config = HistoryRangeConfig.model_validate(request.strategy_config)
            replay_state(inference_request(request, config))
        except ValueError as exc:
            return SupportCheck(status="missing-input", reasons=[str(exc)])
        return SupportCheck(status="supported")

    def analyze(self, request: AnalysisRequest, services: AnalysisServices) -> AnalysisResult:
        config = HistoryRangeConfig.model_validate(request.strategy_config)
        template = inference_request(request, config)
        decisions, warnings, _ = replay_state(template, services.checkpoint)
        opponents = list(request.opponents)
        summaries = []
        for index, (seat, opponent) in enumerate(
            zip(config.opponent_seats, request.opponents, strict=True)
        ):
            services.checkpoint()
            if opponent.kind != "random":
                continue
            # Always use the original request; inferred posteriors never become priors.
            target = template.model_copy(update={"target_seat": seat})
            combos, traces, composition, _ = infer(target, decisions, 0, services.checkpoint)
            opponents[index] = RangeOpponent(kind="range", combos=combos)
            weights = [c.weight for c in combos]
            summaries.append(
                HistoryRangeSummary(
                    seat=seat,
                    observed_actions=len(traces),
                    combos=len(combos),
                    effective_combos=sum(weights) ** 2 / sum(w * w for w in weights),
                    value_share=composition["value"],
                    source="均匀翻前先验 + 本手行动",
                )
            )
        updated = request.model_copy(update={"opponents": opponents})
        result = super().analyze(updated, services)
        result.strategy = StrategyIdentity(
            id=self.manifest.id, name=self.manifest.name, version=self.manifest.version
        )
        result.model_version = "multi-opponent-history-rules-v1"
        result.history_ranges = summaries
        result.signals = [
            "手动范围与明牌保持不变；每次从均匀先验重放，不重复累乘旧后验。",
            *[
                f"玩家 {s.seat + 1}：{s.observed_actions} 次行动，有效组合 {s.effective_combos:.1f}"
                for s in summaries
            ],
        ]
        result.assumptions.extend(
            [
                "启发式行为模型未校准；各玩家范围独立推断，再以无牌冲突为条件联合抽样。",
                "仅为基准行为假设下的结果，未验证偏紧/偏松情景稳定性。",
                *warnings,
            ]
        )
        return result
