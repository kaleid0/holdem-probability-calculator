"""Partition commitments and aggregate all pots on the same sampled deal."""

from poker_calculator.domain.models import AnalysisRequest, PotEquity


class PotAccumulator:
    def __init__(self, request: AnalysisRequest):
        self.pots: list[PotEquity] = []
        self.mass = 0.0
        if request.pot_context is None:
            return
        context = request.pot_context
        amounts = list(context.contributions)
        amounts[0] += request.call_amount
        active = len(amounts)
        amounts.extend(context.folded_contributions)
        previous = 0
        for level in sorted(set(amounts) - {0}):
            contributors = [i for i, amount in enumerate(amounts) if amount >= level]
            amount = (level - previous) * len(contributors)
            previous = level
            eligible = [i for i in contributors if i < active]
            refund = len(contributors) == 1
            if not eligible and not refund:
                raise ValueError("底池存在没有在局参赛者的筹码层，请检查投入记录")
            if (
                self.pots
                and not refund
                and not self.pots[-1].is_refund
                and self.pots[-1].eligible == eligible
            ):
                self.pots[-1].amount += amount
            else:
                self.pots.append(
                    PotEquity(
                        amount=amount,
                        eligible=eligible,
                        is_refund=refund,
                        equity=0,
                        expected_return=0,
                    )
                )
        self.contested_total = sum(p.amount for p in self.pots if not p.is_refund)

    def add(self, scores: list[int], weight: float = 1) -> float | None:
        if not self.pots:
            return None
        self.mass += weight
        contested_return = 0.0
        for pot in self.pots:
            share = 0.0
            if 0 in pot.eligible:
                best = min(scores[i] for i in pot.eligible)
                winners = [i for i in pot.eligible if scores[i] == best]
                if 0 in winners:
                    share = 1 / len(winners)
            pot.equity += weight * share
            pot.expected_return += weight * share * pot.amount
            if not pot.is_refund:
                contested_return += share * pot.amount
        return contested_return / self.contested_total if self.contested_total else 0.0

    def results(self) -> list[PotEquity]:
        return [
            p.model_copy(
                update={
                    "equity": p.equity / self.mass,
                    "expected_return": p.expected_return / self.mass,
                }
            )
            for p in self.pots
        ]
