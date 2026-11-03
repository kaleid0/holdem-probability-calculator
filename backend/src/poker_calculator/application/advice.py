"""Resolve trusted task results and select one versioned decision policy."""

from dataclasses import dataclass
from typing import Protocol

from poker_calculator.domain.advice import DecisionAdviceRequest, DecisionAdviceResponse
from poker_calculator.domain.decision import decision_context
from poker_calculator.domain.models import AnalysisRequest, AnalysisResult
from poker_calculator.engines.action_ev import action_ev
from poker_calculator.strategies.continuation_advice import continuation_advice
from poker_calculator.strategies.decision_advice import (
    baseline_advice,
    river_advice,
    tree_advice,
    waiting_advice,
)
from poker_calculator.strategies.preflop_advice import preflop_advice


@dataclass(frozen=True)
class AdviceResults:
    baseline: AnalysisResult | None = None
    history: AnalysisResult | None = None
    river: AnalysisResult | None = None
    tree: AnalysisResult | None = None


class AnalysisResultSource(Protocol):
    def completed_analysis(self, task_id: str) -> tuple[AnalysisRequest, AnalysisResult]: ...


def resolve_results(request: DecisionAdviceRequest, service: AnalysisResultSource) -> AdviceResults:
    results: dict[str, AnalysisResult] = {}
    expected = {
        "baseline": "pot-odds",
        "history": "history-ranges",
        "river": "river-bet",
        "tree": "postflop-tree",
    }
    for name, strategy in expected.items():
        task_id = getattr(request.sources, name)
        if task_id is None:
            continue
        original, result = service.completed_analysis(task_id)
        if analysis_facts(original) != analysis_facts(request.base_analysis):
            raise ValueError("分析任务与当前局面不一致，请重新计算")
        if result.strategy.id != strategy:
            raise ValueError("分析任务与声明的策略来源不一致")
        if name != "baseline":
            selection = next((s for s in original.strategies or [] if s.id == strategy), None)
            config = selection.config if selection else original.strategy_config
            history = request.history_context
            if (
                history is None
                or config.get("history_context") != history.model_dump()
                or config.get("opponent_seats") != request.opponent_seats
            ):
                raise ValueError("高级分析任务与当前行动历史不一致，请重新计算")
        results[name] = result
    return AdviceResults(**results)


def analysis_facts(request: AnalysisRequest) -> dict[str, object]:
    return request.model_dump(exclude={"strategy_id", "strategy_config", "strategies"})


def decision_advice(
    request: DecisionAdviceRequest, results: AdviceResults
) -> DecisionAdviceResponse:
    context = decision_context(request)
    result = results.history or results.baseline
    opening = preflop_advice(context)
    evaluated = baseline_advice(request, result, context)
    fallback = continuation_advice(context, result)
    tree, river = tree_advice(results.tree), river_advice(results.river)
    reasons = []
    if request.recorded and (context is None or not context.hero_turn):
        selected = waiting_advice() if result else None
        reasons.append("not-hero-turn" if context else "recording-unavailable")
    else:
        candidates = [tree, river]
        if opening and opening.code == "recommendation":
            candidates.append(opening)
        if evaluated and evaluated.code not in ("unavailable", "no-call"):
            candidates.append(evaluated)
        candidates.extend([fallback, opening, evaluated])
        selected = next((item for item in candidates if item is not None), None)
        if not tree:
            reasons.append("tree-result-unavailable")
        if not river:
            reasons.append("river-result-unavailable")
        if opening and opening.code == "review":
            reasons.append("preflop-outside-rule-coverage")
        if evaluated and evaluated.code == "unavailable":
            reasons.append("call-ev-unavailable")
    return DecisionAdviceResponse(
        advice=selected,
        opening_advice=opening,
        fallback=fallback,
        fallback_reasons=reasons,
        comparison=action_ev(context, result, request.response_model),
        response_model=request.response_model,
        advanced=tree is not None or river is not None,
    )
