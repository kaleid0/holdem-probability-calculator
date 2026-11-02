import { z } from "zod";

export const defaultRiverBet = () => ({
  mode: "auto" as const,
  preflopPrior: "",
  effectiveStack: "",
  checkClosesAction: false,
  bets: [50, 100, 150].map((amount) => ({
    amount: String(amount),
    foldPercent: "0",
    callingRange: "",
  })),
});

export const riverBetSchema = z
  .object({
    mode: z.enum(["auto", "manual"]).optional(),
    preflopPrior: z.string().max(65536).optional(),
    effectiveStack: z.string().max(20),
    checkClosesAction: z.boolean(),
    bets: z
      .array(
        z
          .object({
            amount: z.string().max(20),
            foldPercent: z.string().max(20),
            callingRange: z.string().max(65536),
          })
          .strict(),
      )
      .min(1)
      .max(6),
  })
  .strict()
  .default(defaultRiverBet);

export type RiverBetDraft = z.infer<typeof riverBetSchema>;

export function riverBetConfig(value: RiverBetDraft) {
  if (value.mode !== "manual")
    return {
      mode: "auto",
      preflop_prior: value.preflopPrior ?? "",
    };
  return {
    effective_stack: value.effectiveStack.trim()
      ? Number(value.effectiveStack)
      : null,
    check_closes_action: value.checkClosesAction,
    bets: value.bets.map((bet) => ({
      amount: Number(bet.amount),
      fold_probability: Number(bet.foldPercent) / 100,
      calling_range: bet.callingRange,
    })),
  };
}

export function validateRiverBet(value: RiverBetDraft): string[] {
  if (value.mode !== "manual") return [];
  const errors: string[] = [];
  const positiveChips = (v: string) =>
    /^\d+$/.test(v) && Number.isSafeInteger(Number(v)) && Number(v) > 0;
  if (!positiveChips(value.effectiveStack))
    errors.push("河牌下注：请填写有效筹码（双方剩余筹码的较小值，正整数）。");
  if (!value.checkClosesAction) errors.push("河牌下注：请确认过牌后直接摊牌。");
  for (const [index, bet] of value.bets.entries()) {
    if (!positiveChips(bet.amount))
      errors.push(`河牌下注方案 ${index + 1}：金额须为安全范围内的正整数。`);
    else if (Number(bet.amount) > Number(value.effectiveStack))
      errors.push(`河牌下注方案 ${index + 1}：金额超过有效筹码。`);
    if (
      !bet.foldPercent.trim() ||
      !Number.isFinite(Number(bet.foldPercent)) ||
      Number(bet.foldPercent) < 0 ||
      Number(bet.foldPercent) > 100
    )
      errors.push(`河牌下注方案 ${index + 1}：弃牌率须为 0–100%。`);
  }
  if (
    new Set(value.bets.map((b) => Number(b.amount))).size !== value.bets.length
  )
    errors.push("河牌下注金额不能重复。");
  return errors;
}
