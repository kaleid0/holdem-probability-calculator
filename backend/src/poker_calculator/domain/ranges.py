"""Range grammar and concrete combinations, independent of HTTP and evaluators."""

import re
from dataclasses import dataclass
from itertools import combinations

RANKS = "23456789TJQKA"
SUITS = "shcd"
MODEL_VERSION = "weighted-independent-v1"


@dataclass(frozen=True)
class Combo:
    cards: tuple[int, int]
    weight: float

    @property
    def mask(self) -> int:
        return (1 << self.cards[0]) | (1 << self.cards[1])


def expand_class(label: str) -> list[tuple[int, int]]:
    if not re.fullmatch(r"[2-9TJQKA]{2}[so]?", label):
        raise ValueError(f"无效手牌类别：{label}")
    first, second = RANKS.index(label[0]), RANKS.index(label[1])
    mode = label[2:] if len(label) > 2 else ""
    if first < second or (first == second and mode):
        raise ValueError(f"手牌须高牌在前，对子不能加 s/o：{label}")
    if first == second:
        return list(combinations(range(first * 4, first * 4 + 4), 2))
    return [
        (second * 4 + b, first * 4 + a)
        for a in range(4)
        for b in range(4)
        if not mode or (mode == "s" and a == b) or (mode == "o" and a != b)
    ]


def token_classes(token: str) -> list[str]:
    if token.endswith("+"):
        base = token[:-1]
        expand_class(base)
        high, low = RANKS.index(base[0]), RANKS.index(base[1])
        if high == low:
            return [rank * 2 for rank in RANKS[high:]]
        return [base[0] + RANKS[i] + base[2:] for i in range(low, high)]
    if "-" in token:
        parts = token.split("-")
        if len(parts) != 2:
            raise ValueError("区间须为 AA-TT 或 AJs-AKs")
        left, right = parts
        expand_class(left)
        expand_class(right)
        if left[0] == left[1] and right[0] == right[1]:
            a, b = sorted((RANKS.index(left[0]), RANKS.index(right[0])))
            return [rank * 2 for rank in RANKS[a : b + 1]]
        if left[0] != right[0] or left[2:] != right[2:]:
            raise ValueError("非对子区间须保持相同高牌和同花类型，例如 AJs-AKs")
        a, b = sorted((RANKS.index(left[1]), RANKS.index(right[1])))
        return [left[0] + RANKS[i] + left[2:] for i in range(a, b + 1)]
    return [token]


def parse_range(text: str) -> list[Combo]:
    """Comma/space separated classes or explicit AsKh, with optional :weight.

    Duplicate concrete combinations take the maximum weight (including overlaps).
    """
    weights: dict[tuple[int, int], float] = {}
    tokens = re.split(r"[,;\s]+", text.strip())
    for index, token in enumerate(tokens, 1):
        if not token:
            continue
        try:
            pieces = token.split(":")
            if len(pieces) > 2:
                raise ValueError("权重格式应为 AKs:0.5")
            label = pieces[0]
            weight = float(pieces[1]) if len(pieces) == 2 else 1.0
            if not 0 <= weight <= 1 or (0 < weight < 0.000001):
                raise ValueError("权重须为 0 或 0.000001–1 的有限数")
            if re.fullmatch(r"[2-9TJQKA][shcd][2-9TJQKA][shcd]", label):
                cards = [RANKS.index(label[i]) * 4 + SUITS.index(label[i + 1]) for i in (0, 2)]
                if cards[0] == cards[1]:
                    raise ValueError("同一组合不能重复用牌")
                cards.sort()
                pairs = [(cards[0], cards[1])]
            else:
                pairs = [pair for item in token_classes(label) for pair in expand_class(item)]
            for pair in pairs:
                weights[pair] = max(weights.get(pair, 0), weight)
        except ValueError as exc:
            raise ValueError(f"范围第 {index} 项「{token}」：{exc}") from exc
    result = [Combo(pair, weight) for pair, weight in sorted(weights.items()) if weight > 0]
    if not result:
        raise ValueError("范围没有正权重的手牌组合")
    return result


def remove_blocked(combos: list[Combo], known: set[int]) -> list[Combo]:
    return [combo for combo in combos if not known.intersection(combo.cards)]


def merge_combos(combos: list[Combo]) -> list[Combo]:
    weights: dict[tuple[int, int], float] = {}
    for combo in combos:
        pair = (min(combo.cards), max(combo.cards))
        weights[pair] = max(weights.get(pair, 0), combo.weight)
    return [Combo(pair, weight) for pair, weight in sorted(weights.items()) if weight > 0]
