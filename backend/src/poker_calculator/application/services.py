"""Compute services injected into strategies, independent from the API and task runner."""

import time
from collections.abc import Callable
from dataclasses import dataclass

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

    def checkpoint(self) -> None:
        if self.cancelled and self.cancelled():
            raise CalculationCancelled
        if self.deadline is not None and time.monotonic() >= self.deadline:
            raise CalculationTimeout("计算超过时间预算，请降低精度或减少未知对手")

    def equity(self, request: AnalysisRequest) -> EquityResult:
        """Strategies may request equity zero, one, or multiple times within the same budget."""
        self.checkpoint()
        remaining = 30.0 if self.deadline is None else self.deadline - time.monotonic()
        return calculate_equity(
            request, progress=self.progress, cancelled=self.cancelled, time_limit=remaining
        )
