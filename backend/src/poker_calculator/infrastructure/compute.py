"""Spawn-safe worker entry point; no HTTP objects cross process boundaries."""

import time
from typing import Any

from poker_calculator.application.services import AnalysisServices
from poker_calculator.domain.models import AnalysisRequest, StrategyOutcome, StrategySelection
from poker_calculator.engines.equity import CalculationCancelled, CalculationTimeout
from poker_calculator.strategies.registry import get_strategy


def execute_analysis(
    payload: dict[str, Any], progress: Any, cancellation: Any, time_limit: float
) -> dict[str, Any]:
    progress["started"] = True
    request = AnalysisRequest.model_validate(payload)
    outcomes: list[StrategyOutcome] = []
    selections = request.strategies or [
        StrategySelection(id=request.strategy_id, config=request.strategy_config)
    ]

    def report(completed: int, total: int) -> None:
        progress.update({"completed": completed, "total": total})

    try:
        services = AnalysisServices(
            progress=report,
            cancelled=cancellation.is_set,
            deadline=time.monotonic() + time_limit,
        )
        services.phases = len(selections)
        for index, selection in enumerate(selections):
            services.phase = index
            services.checkpoint()
            scenario = request.model_copy(
                update={
                    "strategy_id": selection.id,
                    "strategy_config": selection.config,
                }
            )
            try:
                strategy = get_strategy(selection.id)
                strategy.validate_config(scenario)
                support = strategy.check_support(scenario)
                if support.status != "supported":
                    outcomes.append(
                        StrategyOutcome(
                            strategy_id=selection.id,
                            status="insufficient-data"
                            if support.status == "missing-input"
                            else "unsupported",
                            reasons=support.reasons,
                        )
                    )
                else:
                    result = strategy.analyze(scenario, services)
                    services.checkpoint()
                    outcomes.append(
                        StrategyOutcome(strategy_id=selection.id, status="ok", result=result)
                    )
            except (CalculationCancelled, CalculationTimeout):
                raise
            except Exception as exc:
                outcomes.append(
                    StrategyOutcome(strategy_id=selection.id, status="error", reasons=[str(exc)])
                )
            services.report(1, 1)
        return package_outcomes(outcomes)
    except CalculationCancelled:
        complete_ids = {item.strategy_id for item in outcomes}
        outcomes.extend(
            StrategyOutcome(
                strategy_id=item.id, status="error", reasons=["任务已取消，该策略未完成"]
            )
            for item in selections
            if item.id not in complete_ids
        )
        return {**package_outcomes(outcomes), "cancelled": True}
    except CalculationTimeout as exc:
        complete_ids = {item.strategy_id for item in outcomes}
        outcomes.extend(
            StrategyOutcome(strategy_id=item.id, status="error", reasons=[str(exc)])
            for item in selections
            if item.id not in complete_ids
        )
        return {**package_outcomes(outcomes), "budget_error": str(exc)}


def package_outcomes(outcomes: list[StrategyOutcome]) -> dict[str, Any]:
    successes = [
        outcome.result for outcome in outcomes if outcome.status == "ok" and outcome.result
    ]
    return {
        "cancelled": False,
        "result": successes[0].model_dump() if successes else None,
        "outcomes": [outcome.model_dump() for outcome in outcomes],
        "completion": "complete"
        if successes and len(successes) == len(outcomes)
        else "partial"
        if successes
        else "none",
    }
