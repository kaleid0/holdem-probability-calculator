"""Strategy contract. Strategies never own task execution or process pools."""

from typing import Protocol

from poker_calculator.application.services import AnalysisServices
from poker_calculator.domain.models import (
    AnalysisRequest,
    AnalysisResult,
    StrategyManifest,
    SupportCheck,
)


class Strategy(Protocol):
    manifest: StrategyManifest

    def validate_config(self, request: AnalysisRequest) -> None: ...

    def check_support(self, request: AnalysisRequest) -> SupportCheck: ...

    def analyze(self, request: AnalysisRequest, services: AnalysisServices) -> AnalysisResult: ...
