"""Contracts for server-owned decisions over existing analysis task results."""

from typing import Literal

from pydantic import ConfigDict, Field, model_validator

from poker_calculator.domain.models import AnalysisRequest, Chips, Contract
from poker_calculator.domain.sensitivity import HistoryContext, Seat


class ResponseModel(Contract):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)
    fold: float = Field(default=0.25, ge=0, le=1, allow_inf_nan=False)
    raise_: float = Field(default=0.08, alias="raise", ge=0, le=1, allow_inf_nan=False)
    probe: float = Field(default=0.35, ge=0, le=1, allow_inf_nan=False)

    @model_validator(mode="after")
    def validate_response(self) -> "ResponseModel":
        if self.fold + self.raise_ > 1:
            raise ValueError("弃牌率与再加注率之和不能超过 100%")
        return self


class AdviceSources(Contract):
    baseline: str | None = Field(default=None, min_length=1, max_length=100)
    history: str | None = Field(default=None, min_length=1, max_length=100)
    river: str | None = Field(default=None, min_length=1, max_length=100)
    tree: str | None = Field(default=None, min_length=1, max_length=100)


class DecisionAdviceRequest(Contract):
    base_analysis: AnalysisRequest
    recorded: bool = False
    history_context: HistoryContext | None = None
    opponent_seats: list[Seat] = Field(default_factory=list, max_length=8)
    sources: AdviceSources = Field(default_factory=AdviceSources)
    response_model: ResponseModel = Field(default_factory=ResponseModel)

    @model_validator(mode="after")
    def validate_history(self) -> "DecisionAdviceRequest":
        if self.history_context is not None:
            if not self.recorded:
                raise ValueError("手动局面不能同时提供行动历史")
            if (
                len(self.opponent_seats) != len(self.base_analysis.opponents)
                or len(set(self.opponent_seats)) != len(self.opponent_seats)
                or 0 in self.opponent_seats
                or any(s >= self.history_context.count for s in self.opponent_seats)
            ):
                raise ValueError("在局座位映射与对手列表不一致")
        return self


class AdviceAction(Contract):
    action: Literal["fold", "check", "call", "bet", "raise"]
    amount: Chips = 0
    amount_kind: Literal["additional", "street_total"] = "additional"


class DecisionAdvice(Contract):
    source: str
    model_version: str
    code: Literal["recommendation", "review", "marginal", "waiting", "no-call", "unavailable"]
    title: str
    reason: str
    stability: str
    actions: list[AdviceAction] = Field(default_factory=list)
    threshold: float | None = None
    reserve: float | None = None


class EvScenario(Contract):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)
    name: str
    equity: float
    fold: float
    raise_: float = Field(alias="raise")
    probe: float


class EvRow(Contract):
    label: str
    action: AdviceAction
    additional: Chips
    values: list[float]
    errors: list[float]


class ActionEvComparison(Contract):
    model_version: str = "independent-response-v1"
    reason: str | None = None
    rows: list[EvRow] = Field(default_factory=list)
    scenarios: list[EvScenario] = Field(default_factory=list)
    best: list[str] = Field(default_factory=list)
    stable: list[str] = Field(default_factory=list)


class DecisionAdviceResponse(Contract):
    model_version: str = "decision-policy-v1"
    advice: DecisionAdvice | None
    opening_advice: DecisionAdvice | None
    fallback: DecisionAdvice | None
    fallback_reasons: list[str]
    comparison: ActionEvComparison
    response_model: ResponseModel
    advanced: bool
