import hashlib
import math
from typing import Literal

from pydantic import BaseModel, ConfigDict

from poker_calculator.application.services import AnalysisServices
from poker_calculator.domain.models import (
    ActionAssessment,
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
        version="0.3.0",
        description="比较摊牌权益与跟注成本；不评估加注或后续下注策略。",
        config_schema=PotOddsConfig.model_json_schema(),
        capabilities={
            "streets": ["preflop", "flop", "turn", "river"],
            "max_players": 9,
            "side_pots": True,
            "objective": "chip_ev",
            "opponent_models": ["random", "exact", "range"],
        },
    )

    def validate_config(self, request: AnalysisRequest) -> None:
        PotOddsConfig.model_validate(request.strategy_config)

    def check_support(self, request: AnalysisRequest) -> SupportCheck:
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
            "范围权重为相对可能性；多名对手的联合权重为乘积，再以无牌冲突为条件归一化。",
        ]
        if request.pot_context is None:
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
                    assumptions.append(
                        "跟注后不再发生额外投入，剩余公共牌发完；EV 以现在弃牌为零点。"
                    )
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
        expected_return = None
        if request.pot_context:
            assumptions[0] = "标准 52 张牌、单次发牌；按跟注后的投入拆分主池/边池，不计抽水与 ICM。"
            total = sum(p.amount for p in equity.pots if not p.is_refund)
            expected_return = sum(p.expected_return for p in equity.pots)
            assumptions.append(
                "权益为各争夺池预期所得之和除以全部争夺池金额；不含未跟注退回。"
                "独赢/平局/输牌仍表示与全部在局对手比较牌力，不表示每池结果。"
            )
            assumptions.append("分池平局按等份计算，不模拟整数余筹的庄位分配。")
            # Returned chips already owned by hero cannot count as incremental call profit.
            hero_refund = any(p.is_refund and 0 in p.eligible for p in equity.pots)
            supported_ev = (
                call > 0
                and total > 0
                and not hero_refund
                and request.pot_context.betting_closed_after_call
                and request.settlement_assumption == "showdownAfterCall"
            )
            ratio = None
            threshold = None
            call_ev = None
            recommendation = None
            if supported_ev:
                available = sum(
                    p.amount for p in equity.pots if not p.is_refund and 0 in p.eligible
                )
                divisor = math.gcd(available - call, call)
                ratio = f"{(available - call) // divisor}:{call // divisor}"
                threshold = call / total
                call_ev = expected_return - call
                recommendation = "在行动已闭合且直接摊牌的假设下，" + (
                    "跟注与弃牌的增量 EV 相同。"
                    if abs(call_ev) < 1e-9
                    else "跟注的增量 EV 高于弃牌。"
                    if call_ev > 0
                    else "弃牌的增量 EV 高于跟注。"
                )
            else:
                assumptions.append(
                    "本局面仅展示分池权益与预期所得；只有本次跟注可闭合行动、"
                    "无后续投入且没有自己的未跟注退回时，才提供跟注 EV。"
                )
                recommendation = "当前仅提供分池权益，跟注 EV 的适用条件尚未满足。"
        else:
            assumptions.append("未提供玩家累计投入，采用单底池模型。")
        method: Literal["exact", "monteCarlo"] = (
            "exact" if equity.method == "exact" else "monteCarlo"
        )
        return AnalysisResult(
            engine_version="0.3.0",
            model_version="side-pot-independent-v1"
            if request.pot_context
            else "weighted-independent-v1",
            pots=list(equity.pots),
            expected_return=expected_return,
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
            scenario_hash=hashlib.sha256(
                request.model_dump_json(
                    exclude={"strategy_id", "strategy_config", "strategies"}
                ).encode()
            ).hexdigest(),
            seed=request.seed,
            candidates=[
                ActionAssessment(
                    action="fold", amount=0, ev=0, explanation="相对此刻弃牌，增量收益为零。"
                ),
                ActionAssessment(
                    action="call",
                    amount=call,
                    ev=call_ev,
                    explanation="跟注后无额外投入并发完公共牌的参考 EV；不包含加注。",
                ),
            ]
            if call > 0 and (request.pot_context is None or call_ev is not None)
            else [],
            strategy_config=request.strategy_config,
        )
