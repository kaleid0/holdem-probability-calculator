"""Validated decision facts derived from replay, never from a browser game snapshot."""

from dataclasses import dataclass

from poker_calculator.domain.advice import DecisionAdviceRequest
from poker_calculator.domain.history import Decision, ReplayState, replay_state
from poker_calculator.domain.models import AnalysisRequest, RandomOpponent
from poker_calculator.domain.sensitivity import HistoryContext, SensitivityRequest


@dataclass(frozen=True)
class DecisionContext:
    base: AnalysisRequest
    history: HistoryContext
    state: ReplayState
    decisions: tuple[Decision, ...]

    @property
    def hero_turn(self) -> bool:
        return not self.state.ended and self.state.actor == 0 and 0 in self.state.pending

    def remaining(self, seat: int) -> int:
        assert self.history.stacks is not None
        return self.history.stacks[seat] - self.state.total[seat]

    @property
    def can_raise(self) -> bool:
        state = self.state
        last = state.acted_at[0]
        return (
            self.hero_turn
            and any(i != 0 and self.remaining(i) > 0 for i in state.active)
            and (last is None or state.highest - last >= state.minimum)
            and self.remaining(0) > state.highest - state.paid[0]
        )


def decision_context(request: DecisionAdviceRequest) -> DecisionContext | None:
    history = request.history_context
    if history is None or not history.complete or history.stacks is None:
        return None
    # Replay validates facts for all opponent types, including known cards.
    template = SensitivityRequest(
        base_analysis=request.base_analysis.model_copy(
            update={"opponents": [RandomOpponent(kind="random") for _ in request.opponent_seats]}
        ),
        target_seat=request.opponent_seats[0],
        opponent_seats=request.opponent_seats,
        history_context=history,
    )
    decisions, _, state = replay_state(template)
    return DecisionContext(request.base_analysis, history, state, tuple(decisions))
