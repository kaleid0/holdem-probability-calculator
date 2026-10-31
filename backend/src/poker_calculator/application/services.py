"""Compute services injected into strategies, independent from the API and task runner."""

import time
from collections.abc import Callable
from dataclasses import dataclass, field

from poker_calculator.domain.models import AnalysisRequest
from poker_calculator.engines.equity import (
    CalculationCancelled,
    CalculationTimeout,
    EquityResult,
    calculate_equity,
)


@dataclass
class AnalysisServices:
    progress: Callable[[int, int], None] | None = None
    cancelled: Callable[[], bool] | None = None
    deadline: float | None = None
    cache: dict[str, EquityResult] = field(default_factory=dict)
    phase: int = 0
    phases: int = 1

    def report(self, completed: int, total: int) -> None:
        if self.progress:
            fraction = completed / total if total else 1.0
            self.progress(round((self.phase + fraction) / self.phases * 1_000_000), 1_000_000)

    def checkpoint(self) -> None:
        if self.cancelled and self.cancelled():
            raise CalculationCancelled
        if self.deadline is not None and time.monotonic() >= self.deadline:
            raise CalculationTimeout("计算超过时间预算，请降低精度或减少未知对手")

    def equity(self, request: AnalysisRequest) -> EquityResult:
        """Strategies may request equity zero, one, or multiple times within the same budget."""
        self.checkpoint()
        key = request.model_dump_json(exclude={"strategy_id", "strategy_config", "strategies"})
        if key in self.cache:
            self.report(1, 1)
            return self.cache[key]
        remaining = 30.0 if self.deadline is None else self.deadline - time.monotonic()
        result = calculate_equity(
            request, progress=self.report, cancelled=self.cancelled, time_limit=remaining
        )
        self.cache[key] = result
        return result
