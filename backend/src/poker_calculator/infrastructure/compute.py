"""Spawn-safe worker entry point; no HTTP objects cross process boundaries."""

import time
from typing import Any

from poker_calculator.application.services import AnalysisServices
from poker_calculator.domain.models import AnalysisRequest
from poker_calculator.engines.equity import CalculationCancelled
from poker_calculator.strategies.registry import get_strategy


def execute_analysis(
    payload: dict[str, Any], progress: Any, cancellation: Any, time_limit: float
) -> dict[str, Any]:
    progress["started"] = True
    request = AnalysisRequest.model_validate(payload)

    def report(completed: int, total: int) -> None:
        progress.update({"completed": completed, "total": total})

    try:
        services = AnalysisServices(
            progress=report,
            cancelled=cancellation.is_set,
            deadline=time.monotonic() + time_limit,
        )
        services.checkpoint()
        strategy = get_strategy(request.strategy_id)
        result = strategy.analyze(request, services)
        services.checkpoint()
        progress.update({"completed": result.sample_count, "total": result.sample_count})
        return {"cancelled": False, "result": result.model_dump()}
    except CalculationCancelled:
        return {"cancelled": True}
