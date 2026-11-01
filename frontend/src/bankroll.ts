import { z } from "zod";
import type { Draft } from "./model";

export const chipAmount = z.number().int().min(0).max(1_000_000_000);
const seats = z.array(chipAmount).min(2).max(9);
export const bankrollSchema = z
  .object({
    initial: seats,
    balances: seats,
    hands: z.array(
      z.object({
        number: z.number().int().positive(),
        committed: seats,
        payouts: seats,
        balances: seats,
      }),
    ),
  })
  .refine((book) => {
    const count = book.initial.length;
    let previous = book.initial;
    for (const [index, hand] of book.hands.entries()) {
      if (
        hand.number !== index + 1 ||
        [hand.committed, hand.payouts, hand.balances].some(
          (a) => a.length !== count,
        ) ||
        hand.committed.reduce((a, b) => a + b, 0) !==
          hand.payouts.reduce((a, b) => a + b, 0) ||
        hand.balances.some(
          (balance, i) =>
            hand.committed[i] > previous[i] ||
            balance !== previous[i] - hand.committed[i] + hand.payouts[i],
        )
      )
        return false;
      previous = hand.balances;
    }
    return (
      book.balances.length === count &&
      book.balances.every((b, i) => b === previous[i])
    );
  });
export type Bankroll = z.infer<typeof bankrollSchema>;
export function bankrollFor(draft: Draft): Bankroll {
  const count = draft.opponents.length + 1;
  if (draft.bankroll?.balances.length === count) return draft.bankroll;
  const initial = Array<number>(count).fill(1000);
  return { initial, balances: [...initial], hands: [] };
}
export const signedChips = (value: number) => `${value > 0 ? "+" : ""}${value}`;
