import { z } from "zod";
import type { components } from "./api/generated/schema";
import { tableSchema } from "./table";
import { bankrollSchema } from "./bankroll";
import {
  defaultRiverBet,
  riverBetConfig,
  riverBetSchema,
  validateRiverBet,
} from "./riverBet";

export const ranks = "23456789TJQKA";
export const suits = ["♠", "♥", "♣", "♦"] as const;
export const suitNames = ["黑桃", "红桃", "梅花", "方块"];
export function cardLabel(card: number): string {
  return `${suitNames[card % 4]}${ranks[Math.floor(card / 4)]}`;
}
export const cardSchema = z.number().int().min(0).max(51);
const nullablePair = z.tuple([cardSchema.nullable(), cardSchema.nullable()]);
export const draftSchema = z
  .object({
    hero: nullablePair,
    board: z.array(cardSchema).max(5),
    boardSize: z.union([
      z.literal(0),
      z.literal(3),
      z.literal(4),
      z.literal(5),
    ]),
    deadCards: z.array(cardSchema).max(42),
    opponents: z
      .array(
        z.discriminatedUnion("kind", [
          z.object({
            kind: z.literal("random"),
            folded: z.boolean().optional(),
          }),
          z.object({
            kind: z.literal("exact"),
            cards: nullablePair,
            folded: z.boolean().optional(),
          }),
          z.object({
            kind: z.literal("range"),
            text: z.string().max(65536),
            rangeSource: z.enum(["current", "manual"]).optional(),
            folded: z.boolean().optional(),
          }),
        ]),
      )
      .min(1)
      .max(8),
    pot: z.string().max(20),
    call: z.string().max(20),
    bets: z.array(z.string().max(20)).min(1).max(8).default(["50", "50", "50"]),
    futureBetting: z.boolean(),
    samples: z.union([z.literal(10000), z.literal(50000), z.literal(100000)]),
    seed: z.number().int().min(0).max(2147483647),
    strategyId: z.string().min(1).max(100),
    strategyIds: z.array(z.string().min(1).max(100)).max(6).default([]),
    ruleMargin: z.number().min(0).max(0.5).default(0.05),
    riverBet: riverBetSchema,
    table: tableSchema.optional(),
    bankroll: bankrollSchema.optional(),
  })
  .strict()
  .refine(
    (draft) =>
      !draft.bankroll ||
      draft.bankroll.initial.length === draft.opponents.length + 1,
    {
      message: "筹码账本人数必须与牌桌人数一致",
    },
  );
export type Draft = z.infer<typeof draftSchema>;

export function emptyDraft(): Draft {
  return {
    hero: [null, null],
    board: [],
    boardSize: 0,
    deadCards: [],
    opponents: [{ kind: "random" }],
    pot: "150",
    call: "50",
    bets: ["50", "50", "50"],
    futureBetting: true,
    samples: 50000,
    seed: 42,
    strategyId: "pot-odds",
    strategyIds: ["pot-odds"],
    ruleMargin: 0.05,
    riverBet: defaultRiverBet(),
  };
}
export function exampleDraft(): Draft {
  return { ...emptyDraft(), hero: [48, 44], board: [40, 36, 1], boardSize: 3 };
}
export function usedCards(draft: Draft): number[] {
  return [
    ...draft.hero.filter((v): v is number => v !== null),
    ...draft.board,
    ...draft.deadCards,
    ...draft.opponents.flatMap((opponent) =>
      opponent.kind === "exact"
        ? opponent.cards.filter((v): v is number => v !== null)
        : [],
    ),
  ];
}
export function validateDraft(draft: Draft): string[] {
  const errors: string[] = [];
  for (const [index, bet] of draft.bets.entries()) {
    if (!/^\d+$/.test(bet) || !Number.isSafeInteger(Number(bet)))
      errors.push(`玩家${index + 1}下注须为安全范围内的非负整数。`);
  }
  if (draft.hero.some((card) => card === null))
    errors.push("请选择我的两张手牌。");
  if (draft.board.length !== draft.boardSize)
    errors.push(`当前阶段需要 ${draft.boardSize} 张公共牌，请补齐后计算。`);
  if (
    draft.opponents.some(
      (opponent) =>
        !opponent.folded &&
        opponent.kind === "exact" &&
        opponent.cards.some((card) => card === null),
    )
  ) {
    errors.push("请补齐指定对手的两张手牌，或改为随机手牌。");
  }
  const cards = usedCards(draft);
  if (new Set(cards).size !== cards.length)
    errors.push("同一张牌不能出现在多个位置。");
  if (
    cards.length +
      draft.opponents.filter((o) => !o.folded && o.kind !== "exact").length *
        2 +
      (5 - draft.board.length) >
    52
  ) {
    errors.push("剩余牌不足以发完所有对手手牌与公共牌。");
  }
  for (const [value, name] of [
    [draft.pot, "当前底池"],
    [draft.call, "跟注金额"],
  ]) {
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)))
      errors.push(`${name}须为安全范围内的非负整数。`);
  }
  if (
    Number.isSafeInteger(Number(draft.pot)) &&
    Number.isSafeInteger(Number(draft.call)) &&
    !Number.isSafeInteger(Number(draft.pot) + Number(draft.call))
  )
    errors.push("底池与跟注金额总和超出安全整数范围。");
  if (Number(draft.call) > Number(draft.pot))
    errors.push("跟注额不能大于已包含对手下注的当前底池。");
  if (!draft.strategyIds.length) errors.push("请至少选择一种分析策略。");
  if (draft.strategyIds.includes("river-bet")) {
    errors.push(...validateRiverBet(draft.riverBet));
  }
  if (!draft.opponents.some((o) => !o.folded))
    errors.push("至少需要一名在局对手才能分析摊牌权益。");
  if (draft.table && draft.table.dealer > draft.opponents.length)
    errors.push("庄位超出牌桌人数。");
  if (
    draft.opponents.some(
      (o) => !o.folded && o.kind === "range" && !o.text.trim(),
    )
  )
    errors.push("请填写对手范围，或改为随机手牌。");
  return errors;
}

export function toRequest(
  draft: Draft,
): components["schemas"]["AnalysisRequest"] {
  return {
    schema_version: 2,
    hero: draft.hero as [number, number],
    board: draft.board,
    dead_cards: [
      ...draft.deadCards,
      ...draft.opponents.flatMap((o) =>
        o.folded && o.kind === "exact"
          ? o.cards.filter((c): c is number => c !== null)
          : [],
      ),
    ],
    opponents: draft.opponents
      .filter((o) => !o.folded)
      .map((o) =>
        o.kind === "range"
          ? { kind: "range" as const, text: o.text }
          : o.kind === "random"
            ? { kind: "random" as const }
            : { kind: "exact" as const, cards: o.cards as [number, number] },
      ),
    pot_before_call: Number(draft.pot),
    call_amount: Number(draft.call),
    settlement_assumption: draft.futureBetting
      ? ("futureBettingPossible" as const)
      : ("showdownAfterCall" as const),
    strategy_id: draft.strategyId,
    strategies: (draft.strategyIds.length
      ? draft.strategyIds
      : [draft.strategyId]
    ).map((id) => ({
      id,
      config:
        id === "equity-rules"
          ? { equity_margin: draft.ruleMargin }
          : id === "river-bet"
            ? riverBetConfig(draft.riverBet)
            : {},
    })),
    samples: draft.samples,
    equity_method: "auto",
    seed: draft.seed,
  };
}

export const savedSchema = z
  .object({
    schemaVersion: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    draft: draftSchema,
  })
  .strict();
export function parseSaved(value: string): Draft {
  const parsed = savedSchema.parse(JSON.parse(value));
  if (parsed.schemaVersion === 1)
    parsed.draft.strategyIds = [parsed.draft.strategyId];
  const cards = usedCards(parsed.draft);
  if (new Set(cards).size !== cards.length)
    throw new Error("文件包含重复的扑克牌。");
  if (parsed.draft.board.length > parsed.draft.boardSize)
    throw new Error("公共牌数量超出所选阶段。");
  return parsed.draft;
}
