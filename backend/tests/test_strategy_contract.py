from typing import Any

import pytest

from poker_calculator.application.services import AnalysisServices
from poker_calculator.domain.models import AnalysisRequest, AnalysisResult, StrategyIdentity
from poker_calculator.infrastructure.compute import execute_analysis


class NeverCancelled:
    def is_set(self) -> bool:
        return False


class TableOnlyStrategy:
    """An intentionally engine-free plugin demonstrates independent strategy execution."""

    def analyze(self, request: AnalysisRequest, services: AnalysisServices) -> AnalysisResult:
        services.checkpoint()
        return AnalysisResult(
            method=None,
            win_probability=None,
            tie_probability=None,
            lose_probability=None,
            equity=None,
            equity_standard_error=None,
            sample_count=0,
            elapsed_ms=0,
            pot_odds_ratio=None,
            break_even_equity=None,
            call_ev=None,
            recommendation="示例表策略，不推断权益或 EV",
            assumptions=["这是测试插件，未调用概率引擎。"],
            strategy=StrategyIdentity(id="table-only", name="测试表策略", version="0.1.0"),
            scenario_hash="test",
            seed=request.seed,
        )


def test_worker_dispatch_does_not_require_equity(monkeypatch: pytest.MonkeyPatch) -> None:
    def unexpected_equity(*args: Any, **kwargs: Any) -> None:
        raise AssertionError("The worker must not force all strategies to calculate equity")

    monkeypatch.setattr("poker_calculator.application.services.calculate_equity", unexpected_equity)
    monkeypatch.setattr(
        "poker_calculator.infrastructure.compute.get_strategy", lambda _: TableOnlyStrategy()
    )
    progress: dict[str, object] = {}
    result = execute_analysis(
        {"hero": [48, 49], "opponents": [{"kind": "random"}], "strategy_id": "table-only"},
        progress,
        NeverCancelled(),
        30,
    )
    assert result["result"]["equity"] is None
    assert result["result"]["strategy"]["id"] == "table-only"
