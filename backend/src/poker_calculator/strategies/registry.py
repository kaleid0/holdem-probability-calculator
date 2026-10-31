from poker_calculator.strategies.base import Strategy
from poker_calculator.strategies.pot_odds import PotOddsStrategy
from poker_calculator.strategies.rules import RuleStrategy

_STRATEGIES: dict[str, Strategy] = {"pot-odds": PotOddsStrategy(), "equity-rules": RuleStrategy()}


def get_strategy(strategy_id: str) -> Strategy:
    try:
        return _STRATEGIES[strategy_id]
    except KeyError as exc:
        raise ValueError(f"未知策略：{strategy_id}") from exc


def list_strategies() -> list[Strategy]:
    return list(_STRATEGIES.values())
