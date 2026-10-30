"""Versioned input and output contracts shared by API and compute workers."""

from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

Card = Annotated[int, Field(strict=True, ge=0, le=51)]
Chips = Annotated[int, Field(strict=True, ge=0, le=9_007_199_254_740_991)]


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid")


class RandomOpponent(Contract):
    kind: Literal["random"]


class ExactOpponent(Contract):
    kind: Literal["exact"]
    cards: tuple[Card, Card]


Opponent = Annotated[RandomOpponent | ExactOpponent, Field(discriminator="kind")]


class AnalysisRequest(Contract):
    schema_version: Literal[1] = 1
    hero: tuple[Card, Card]
    board: list[Card] = Field(default_factory=list, max_length=5)
    dead_cards: list[Card] = Field(default_factory=list, max_length=45)
    opponents: list[Opponent] = Field(min_length=1, max_length=8)
    pot_before_call: Chips = 150
    call_amount: Chips = 50
    settlement_assumption: Literal["showdownAfterCall", "futureBettingPossible"] = (
        "futureBettingPossible"
    )
    strategy_id: str = "pot-odds"
    strategy_config: dict[str, Any] = Field(default_factory=dict)
    samples: Annotated[int, Field(strict=True, ge=1_000, le=200_000)] = 20_000
    seed: Annotated[int, Field(strict=True, ge=0, le=2**32 - 1)] = 42

    @model_validator(mode="after")
    def validate_scenario(self) -> "AnalysisRequest":
        if len(self.board) not in (0, 3, 4, 5):
            raise ValueError("公共牌数量必须为 0、3、4 或 5 张")
        known = list(self.hero) + self.board + self.dead_cards
        for opponent in self.opponents:
            if isinstance(opponent, ExactOpponent):
                known.extend(opponent.cards)
        if len(known) != len(set(known)):
            raise ValueError("手牌、公共牌、对手牌和死牌不能重复")
        random_count = sum(isinstance(p, RandomOpponent) for p in self.opponents)
        if len(known) + random_count * 2 + 5 - len(self.board) > 52:
            raise ValueError("剩余牌不足以完成牌局")
        if self.pot_before_call + self.call_amount > 9_007_199_254_740_991:
            raise ValueError("跟注后的底池超出安全整数范围")
        if self.pot_before_call == 0 and self.call_amount > 0:
            raise ValueError("存在跟注额时，当前底池必须大于零")
        if self.call_amount > self.pot_before_call:
            raise ValueError("跟注额不能超过包含对手下注的当前底池")
        return self


class StrategyIdentity(Contract):
    id: str
    name: str
    version: str


class StrategyManifest(StrategyIdentity):
    description: str
    api_version: int = 1
    config_schema: dict[str, Any]
    capabilities: dict[str, Any]


class StrategyList(Contract):
    strategies: list[StrategyManifest]


class SupportCheck(Contract):
    status: Literal["supported", "unsupported", "missing-input"]
    reasons: list[str] = Field(default_factory=list)


class AnalysisResult(Contract):
    # A table/rule strategy need not calculate equity; absent metrics stay explicit nulls.
    method: Literal["exact", "monteCarlo"] | None
    win_probability: float | None
    tie_probability: float | None
    lose_probability: float | None
    equity: float | None
    equity_standard_error: float | None
    sample_count: int
    elapsed_ms: float
    pot_odds_ratio: str | None
    break_even_equity: float | None
    call_ev: float | None
    recommendation: str | None
    assumptions: list[str]
    strategy: StrategyIdentity
    scenario_hash: str
    seed: int
    engine_version: str = "0.1.0"


TaskStatus = Literal[
    "queued", "running", "cancelling", "succeeded", "failed", "cancelled", "expired"
]


class TaskCreated(Contract):
    task_id: str
    status: TaskStatus


class TaskSnapshot(Contract):
    task_id: str
    status: TaskStatus
    progress: float
    completed_samples: int
    total_samples: int
    result: AnalysisResult | None = None
    error: str | None = None


class ErrorResponse(Contract):
    detail: str
