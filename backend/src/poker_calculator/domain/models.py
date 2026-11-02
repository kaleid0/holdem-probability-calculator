"""Versioned input and output contracts shared by API and compute workers."""

from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from poker_calculator.domain.ranges import Combo, merge_combos, parse_range, remove_blocked

Card = Annotated[int, Field(strict=True, ge=0, le=51)]
Chips = Annotated[int, Field(strict=True, ge=0, le=9_007_199_254_740_991)]


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid")


class RandomOpponent(Contract):
    kind: Literal["random"]


class ExactOpponent(Contract):
    kind: Literal["exact"]
    cards: tuple[Card, Card]


class WeightedCombo(Contract):
    cards: tuple[Card, Card]
    weight: float = Field(default=1, ge=0, le=1, allow_inf_nan=False)

    @model_validator(mode="after")
    def validate_pair(self) -> "WeightedCombo":
        if self.cards[0] == self.cards[1]:
            raise ValueError("组合中不能重复用牌")
        if 0 < self.weight < 0.000001:
            raise ValueError("非零权重不得小于 0.000001")
        return self


class RangeOpponent(Contract):
    kind: Literal["range"]
    text: str = Field(default="", max_length=65536)
    combos: list[WeightedCombo] = Field(default_factory=list, max_length=1326)

    @model_validator(mode="after")
    def validate_range(self) -> "RangeOpponent":
        if bool(self.text.strip()) == bool(self.combos):
            raise ValueError("范围必须且只能提供 text 或 combos 之一")
        self.expanded()
        return self

    def expanded(self) -> list[Combo]:
        combos = (
            parse_range(self.text)
            if self.text.strip()
            else merge_combos([Combo(item.cards, item.weight) for item in self.combos])
        )
        if not combos:
            raise ValueError("范围没有正权重组合")
        return combos


Opponent = Annotated[RandomOpponent | ExactOpponent | RangeOpponent, Field(discriminator="kind")]


class StrategySelection(Contract):
    id: str = Field(min_length=1, max_length=100)
    config: dict[str, Any] = Field(default_factory=dict)


class PotContext(Contract):
    # Current commitments, before hero calls. Index 0 is hero; others match opponents.
    contributions: list[Chips] = Field(min_length=2, max_length=9)
    folded_contributions: list[Chips] = Field(default_factory=list, max_length=7)
    betting_closed_after_call: bool = False


class PotEquity(Contract):
    amount: Chips
    eligible: list[int]
    is_refund: bool = False
    equity: float
    expected_return: float


class AnalysisRequest(Contract):
    schema_version: Literal[1, 2] = 1
    hero: tuple[Card, Card]
    board: list[Card] = Field(default_factory=list, max_length=5)
    dead_cards: list[Card] = Field(default_factory=list, max_length=45)
    opponents: list[Opponent] = Field(min_length=1, max_length=8)
    pot_before_call: Chips = 150
    call_amount: Chips = 50
    pot_context: PotContext | None = None
    settlement_assumption: Literal["showdownAfterCall", "futureBettingPossible"] = (
        "futureBettingPossible"
    )
    strategy_id: str = "pot-odds"
    strategy_config: dict[str, Any] = Field(default_factory=dict)
    strategies: list[StrategySelection] | None = Field(default=None, min_length=1, max_length=6)
    samples: Annotated[int, Field(strict=True, ge=1_000, le=200_000)] = 20_000
    equity_method: Literal["auto", "monteCarlo"] = "auto"
    seed: Annotated[int, Field(strict=True, ge=0, le=2**32 - 1)] = 42

    @model_validator(mode="after")
    def validate_scenario(self) -> "AnalysisRequest":
        if self.pot_context:
            context = self.pot_context
            if len(context.contributions) != len(self.opponents) + 1:
                raise ValueError("投入额必须对应自己及每一名在局对手")
            if len(context.contributions) + len(context.folded_contributions) > 9:
                raise ValueError("牌桌最多九人")
            if sum(context.contributions + context.folded_contributions) != self.pot_before_call:
                raise ValueError("玩家累计投入之和必须等于当前底池")
            if self.pot_before_call + self.call_amount == 0:
                raise ValueError("分池分析需要非零底池")
        if len(self.board) not in (0, 3, 4, 5):
            raise ValueError("公共牌数量必须为 0、3、4 或 5 张")
        known = list(self.hero) + self.board + self.dead_cards
        for opponent in self.opponents:
            if isinstance(opponent, ExactOpponent):
                known.extend(opponent.cards)
        if len(known) != len(set(known)):
            raise ValueError("手牌、公共牌、对手牌和死牌不能重复")
        random_count = sum(not isinstance(p, ExactOpponent) for p in self.opponents)
        if len(known) + random_count * 2 + 5 - len(self.board) > 52:
            raise ValueError("剩余牌不足以完成牌局")
        for index, opponent in enumerate(self.opponents, 1):
            if isinstance(opponent, RangeOpponent) and not remove_blocked(
                opponent.expanded(), set(known)
            ):
                raise ValueError(f"对手 {index} 的范围被已知牌完全阻断")
        if self.strategies and len({item.id for item in self.strategies}) != len(self.strategies):
            raise ValueError("一次比较中不能重复选择同一策略")
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


class ActionAssessment(Contract):
    action: Literal["fold", "call", "check", "bet"]
    amount: int | None = None
    ev: float | None = None
    ev_unit: Literal["chips"] = "chips"
    ev_baseline: str = "相对此刻弃牌的增量收益"
    method: str = "showdown-reference"
    explanation: str
    fold_probability: float | None = None
    showdown_equity: float | None = None
    ev_delta: float | None = None
    ev_min: float | None = None
    ev_max: float | None = None
    fold_return: float | None = None
    call_return: float | None = None
    ev_standard_error: float | None = None
    delta_standard_error: float | None = None


class InferredHandClass(Contract):
    hand: str
    probability: float
    combos: int


class RiverScenarioSummary(Contract):
    id: str
    name: str
    status: Literal["ok", "insufficient-data"] = "ok"
    reasons: list[str] = Field(default_factory=list)
    equity: float | None = None
    check_ev: float | None = None
    best_ev: float | None = None
    best_amounts: list[int] = Field(default_factory=list)


class StrategyInference(Contract):
    source: str
    model_version: str
    hand_id: str
    cutoff_sequence: int
    opponent_seat: int
    effective_stack: Chips
    posterior_combos: int
    observed_actions: int
    evidence: list[str]
    warnings: list[str]
    range_classes: list[InferredHandClass] = Field(default_factory=list)
    effective_combos: float | None = None
    clipped_mass: float = 0
    scenarios: list[RiverScenarioSummary] = Field(default_factory=list)
    stable_amounts: list[int] = Field(default_factory=list)
    sensitivity_summary: str | None = None


class HistoryRangeSummary(Contract):
    seat: int
    observed_actions: int
    combos: int
    effective_combos: float
    value_share: float
    source: str


class TreeScenario(Contract):
    id: str
    name: str
    best_actions: list[str]


class LimitedTreeSummary(Contract):
    horizon: str
    scenarios: list[TreeScenario]
    stable_actions: list[str]
    marginal: bool
    sample_count_per_scenario: int
    elapsed_ms: float


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
    engine_version: str = "0.2.0"
    model_version: str = "weighted-independent-v1"
    candidates: list[ActionAssessment] = Field(default_factory=list)
    signals: list[str] = Field(default_factory=list)
    strategy_config: dict[str, Any] = Field(default_factory=dict)
    pots: list[PotEquity] = Field(default_factory=list)
    expected_return: float | None = None
    inference: StrategyInference | None = None
    history_ranges: list[HistoryRangeSummary] = Field(default_factory=list)
    limited_tree: LimitedTreeSummary | None = None


class StrategyOutcome(Contract):
    strategy_id: str
    status: Literal["ok", "unsupported", "insufficient-data", "error"]
    result: AnalysisResult | None = None
    reasons: list[str] = Field(default_factory=list)


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
    outcomes: list[StrategyOutcome] = Field(default_factory=list)
    completion: Literal["complete", "partial", "none"] = "none"


class RangePreviewRequest(Contract):
    text: str = Field(min_length=1, max_length=65536)
    known_cards: list[Card] = Field(default_factory=list, max_length=52)


class RangePreview(Contract):
    total_combos: int
    effective_combos: int
    blocked_combos: int
    combos: list[WeightedCombo]
    class_weights: dict[str, float]


class ErrorResponse(Contract):
    detail: str
