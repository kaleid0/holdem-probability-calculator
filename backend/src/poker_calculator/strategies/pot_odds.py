import hashlib
import math
from typing import Literal

from pydantic import BaseModel, ConfigDict

from poker_calculator.application.services import AnalysisServices
from poker_calculator.domain.models import (
    AnalysisRequest,
    AnalysisResult,
    StrategyIdentity,
    StrategyManifest,
    SupportCheck,
)


class PotOddsConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")


class PotOddsStrategy:
    manifest = StrategyManifest(
        id="pot-odds",
        name="底池赔率基线",
        version="0.1.0",
        description="比较摊牌权益与跟注成本；不评估加注或后续下注策略。",
        config_schema=PotOddsConfig.model_json_schema(),
        capabilities={
            "streets": ["preflop", "flop", "turn", "river"],
            "max_players": 9,
            "side_pots": False,
            "objective": "chip_ev",
            "opponent_models": ["random", "exact"],
        },
    )

    def validate_config(self, request: AnalysisRequest) -> None:
        PotOddsConfig.model_validate(request.strategy_config)

    def check_support(self, request: AnalysisRequest) -> SupportCheck:
        # Current request contract is exclusively single-pot standard Hold'em.
        # Later strategies can reject missing history, positions or unsupported rules here.
        return SupportCheck(status="supported")

    def analyze(self, request: AnalysisRequest, services: AnalysisServices) -> AnalysisResult:
        equity = services.equity(request)
        pot, call = request.pot_before_call, request.call_amount
        ratio = None
        threshold = None
        call_ev = None
        recommendation = None
        assumptions = [
            "标准 52 张牌、单次发牌、单底池；不计抽水与锦标赛 ICM。",
            "随机对手在所有不冲突的合法两张牌组合中等概率取牌。",
            "权益包含多人平局分摊；显示的胜率为最终独赢概率。",
        ]
        if call > 0:
            divisor = math.gcd(pot, call)
            ratio = f"{pot // divisor}:{call // divisor}"
            threshold = call / (pot + call)
            call_ev = equity.equity * (pot + call) - call
            if request.settlement_assumption == "showdownAfterCall":
                if abs(call_ev) < 1e-9:
                    recommendation = "在跟注后直接摊牌的假设下，跟注与弃牌的增量 EV 相同。"
                elif call_ev > 0:
                    recommendation = "在跟注后直接摊牌的假设下，跟注的增量 EV 高于弃牌。"
                else:
                    recommendation = "在跟注后直接摊牌的假设下，弃牌的增量 EV 高于跟注。"
                assumptions.append("跟注后不再发生额外投入，剩余公共牌发完；EV 以现在弃牌为零点。")
            else:
                assumptions.append(
                    "后续仍可能下注：当前 EV 仅为跟注后不再投入且直接摊牌的参考值，"
                    "不能代表完整行动 EV。"
                )
        else:
            recommendation = "当前无需跟注；本策略不比较过牌和下注。"
            assumptions.append("跟注额为零，不展示底池赔率、所需跟注权益和跟注 EV。")
        if equity.method == "monteCarlo":
            assumptions.append("模拟误差仅反映抽样误差，不涵盖对手范围假设的不确定性。")
        assumptions.append("不支持边池；如存在不同玩家全下额度，请勿将该结果用于收益结算。")
        method: Literal["exact", "monteCarlo"] = (
            "exact" if equity.method == "exact" else "monteCarlo"
        )
        return AnalysisResult(
            method=method,
            win_probability=equity.win_probability,
            tie_probability=equity.tie_probability,
            lose_probability=equity.lose_probability,
            equity=equity.equity,
            equity_standard_error=equity.equity_standard_error,
            sample_count=equity.sample_count,
            elapsed_ms=equity.elapsed_ms,
            pot_odds_ratio=ratio,
            break_even_equity=threshold,
            call_ev=call_ev,
            recommendation=recommendation,
            assumptions=assumptions,
            strategy=StrategyIdentity(
                id=self.manifest.id, name=self.manifest.name, version=self.manifest.version
            ),
            scenario_hash=hashlib.sha256(request.model_dump_json().encode()).hexdigest(),
            seed=request.seed,
        )
