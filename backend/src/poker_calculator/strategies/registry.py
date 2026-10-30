from poker_calculator.strategies.base import Strategy
from poker_calculator.strategies.pot_odds import PotOddsStrategy

_STRATEGIES: dict[str, Strategy] = {"pot-odds": PotOddsStrategy()}


def get_strategy(strategy_id: str) -> Strategy:
    try:
        return _STRATEGIES[strategy_id]
    except KeyError as exc:
        raise ValueError(f"未知策略：{strategy_id}") from exc


def list_strategies() -> list[Strategy]:
    return list(_STRATEGIES.values())
