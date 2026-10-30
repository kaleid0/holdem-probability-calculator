"""Adapter: rank * 4 + suit. Suit permutation is consistent across all cards."""

from collections.abc import Sequence

from phevaluator import evaluate_cards


def evaluate(cards: Sequence[int]) -> int:
    """Lower rank wins; Hold'em uses the best five of seven cards."""
    return int(evaluate_cards(*cards))
