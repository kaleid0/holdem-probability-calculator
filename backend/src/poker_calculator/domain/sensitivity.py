"""Versioned, single-target history inference and batch analysis contracts."""

from typing import Annotated, Literal

from pydantic import Field, model_validator

from poker_calculator.domain.models import (
    AnalysisRequest,
    AnalysisResult,
    Card,
    Chips,
    Contract,
    RangeOpponent,
    TaskStatus,
    WeightedCombo,
)

Seat = Annotated[int, Field(strict=True, ge=0, le=8)]
Street = Literal[0, 3, 4, 5]


class ActionEvent(Contract):
    kind: Literal["action"]
    sequence: Annotated[int, Field(strict=True, ge=1)]
    street: Street
    player: Seat
    action: Literal["smallBlind", "bigBlind", "fold", "check", "call", "bet", "raise"]
    amount: Chips
    streetTotal: Chips
    totalCommitted: Chips
    toCall: Chips
    highestBefore: Chips
    minRaiseBefore: Annotated[int, Field(strict=True, gt=0)]
    potBefore: Chips
    potAfter: Chips
    activePlayersBefore: Annotated[int, Field(strict=True, ge=2, le=9)]


class StreetEvent(Contract):
    kind: Literal["street"]
    sequence: Annotated[int, Field(strict=True, ge=1)]
    street: Literal[3, 4, 5]
    board: list[Card] | None = Field(max_length=5)


class EndEvent(Contract):
    kind: Literal["handEnd"]
    sequence: Annotated[int, Field(strict=True, ge=1)]
    street: Street
    reason: Literal["allOthersFolded", "showdown"]
    winner: Seat | None
    pot: Chips


Event = Annotated[ActionEvent | StreetEvent | EndEvent, Field(discriminator="kind")]


class HistoryContext(Contract):
    schema_version: Literal[1] = 1
    hand_id: str = Field(min_length=1, max_length=100)
    cutoff_sequence: Annotated[int, Field(strict=True, ge=2, le=1000)]
    complete: bool
    count: Annotated[int, Field(strict=True, ge=2, le=9)]
    opening_seats: list[Seat] = Field(min_length=2, max_length=9)
    dealer: Seat
    small_blind: Annotated[int, Field(strict=True, gt=0)]
    big_blind: Annotated[int, Field(strict=True, gt=0)]
    stacks: list[Chips] | None = Field(default=None, min_length=2, max_length=9)
    events: list[Event] = Field(min_length=2, max_length=1000)


class SensitivityScenario(Contract):
    id: str = Field(pattern=r"^[a-zA-Z0-9_-]{1,40}$")
    name: str = Field(min_length=1, max_length=60)
    bluff_bias: float = Field(default=0, ge=-3, le=3, allow_inf_nan=False)
    current_range: RangeOpponent | None = None


def default_scenarios() -> list[SensitivityScenario]:
    return [
        SensitivityScenario(id="baseline", name="基准"),
        SensitivityScenario(id="value", name="偏价值", bluff_bias=-1.2),
        SensitivityScenario(id="bluff", name="偏诈唬", bluff_bias=1.2),
    ]


class SensitivityRequest(Contract):
    schema_version: Literal[1] = 1
    model_version: Literal["history-rules-v1"] = "history-rules-v1"
    base_analysis: AnalysisRequest
    target_seat: Seat
    # Index in this list is the corresponding base_analysis.opponents index.
    opponent_seats: list[Seat] = Field(min_length=1, max_length=8)
    mode: Literal["history", "manual"] = "history"
    history_context: HistoryContext | None = None
    # None is an explicitly labelled uniform preflop prior, never the current range.
    preflop_prior: RangeOpponent | None = None
    scenarios: list[SensitivityScenario] = Field(
        default_factory=default_scenarios, min_length=1, max_length=5
    )

    @model_validator(mode="after")
    def validate_target(self) -> "SensitivityRequest":
        if len(self.opponent_seats) != len(self.base_analysis.opponents):
            raise ValueError("在局座位映射与对手列表不一致")
        if len(set(self.opponent_seats)) != len(self.opponent_seats) or 0 in self.opponent_seats:
            raise ValueError("在局座位映射必须唯一且不能包含自己")
        if self.target_seat not in self.opponent_seats:
            raise ValueError("目标必须是在局对手")
        index = self.opponent_seats.index(self.target_seat)
        if self.base_analysis.opponents[index].kind == "exact":
            raise ValueError("指定明牌对手不支持范围推断")
        ids = [item.id for item in self.scenarios]
        if len(set(ids)) != len(ids) or ids[0] != "baseline":
            raise ValueError("场景 ID 必须唯一，首个场景必须为 baseline")
        if self.mode == "history" and any(s.current_range for s in self.scenarios):
            raise ValueError("历史推断不接受当前范围，避免重复应用行动证据")
        if self.mode == "manual" and any(s.current_range is None for s in self.scenarios):
            raise ValueError("手动比较的每个场景都需要当前范围")
        return self


class InferenceTrace(Contract):
    sequence: int
    street: Street
    action: str
    board: list[Card]
    rule_id: str
    context: str
    before: dict[str, float]
    after: dict[str, float]


class SensitivityOutcome(Contract):
    id: str
    name: str
    bluff_bias: float
    status: Literal["ok", "insufficient-data", "unsupported", "error", "timed-out", "cancelled"]
    reasons: list[str] = Field(default_factory=list)
    combos: list[WeightedCombo] = Field(default_factory=list)
    composition: dict[str, float] = Field(default_factory=dict)
    traces: list[InferenceTrace] = Field(default_factory=list)
    clipped_mass: float = 0
    result: AnalysisResult | None = None
    equity_delta: float | None = None
    ev_delta: float | None = None


class SensitivityResult(Contract):
    schema_version: Literal[1] = 1
    model_version: str = "history-rules-v1"
    request_hash: str
    target_seat: Seat
    prior_source: str
    cutoff_sequence: int | None
    warnings: list[str]
    outcomes: list[SensitivityOutcome]
    summary: str
    elapsed_ms: float


class SensitivityTaskSnapshot(Contract):
    task_id: str
    status: TaskStatus
    progress: float
    result: SensitivityResult | None = None
    error: str | None = None
    completion: Literal["complete", "partial", "none"] = "none"
