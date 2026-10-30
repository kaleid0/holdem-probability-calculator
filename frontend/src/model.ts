import { z } from "zod";
import type { components } from "./api/generated/schema";

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
          z.object({ kind: z.literal("random") }),
          z.object({ kind: z.literal("exact"), cards: nullablePair }),
        ]),
      )
      .min(1)
      .max(8),
    pot: z.string().max(20),
    call: z.string().max(20),
    futureBetting: z.boolean(),
    samples: z.union([z.literal(10000), z.literal(50000), z.literal(100000)]),
    seed: z.number().int().min(0).max(2147483647),
    strategyId: z.string().min(1).max(100),
  })
  .strict();
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
    futureBetting: true,
    samples: 50000,
    seed: 42,
    strategyId: "pot-odds",
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
  if (draft.hero.some((card) => card === null))
    errors.push("请选择我的两张手牌。");
  if (draft.board.length !== draft.boardSize)
    errors.push(`当前阶段需要 ${draft.boardSize} 张公共牌，请补齐后计算。`);
  if (
    draft.opponents.some(
      (opponent) =>
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
      draft.opponents.filter((o) => o.kind === "random").length * 2 +
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
  return errors;
}

export function toRequest(
  draft: Draft,
): components["schemas"]["AnalysisRequest"] {
  return {
    schema_version: 1,
    hero: draft.hero as [number, number],
    board: draft.board,
    dead_cards: draft.deadCards,
    opponents: draft.opponents.map((o) =>
      o.kind === "random"
        ? { kind: "random" as const }
        : { kind: "exact" as const, cards: o.cards as [number, number] },
    ),
    pot_before_call: Number(draft.pot),
    call_amount: Number(draft.call),
    settlement_assumption: draft.futureBetting
      ? ("futureBettingPossible" as const)
      : ("showdownAfterCall" as const),
    strategy_id: draft.strategyId,
    samples: draft.samples,
    seed: draft.seed,
  };
}

export const savedSchema = z
  .object({ schemaVersion: z.literal(1), draft: draftSchema })
  .strict();
export function parseSaved(value: string): Draft {
  const parsed = savedSchema.parse(JSON.parse(value));
  const cards = usedCards(parsed.draft);
  if (new Set(cards).size !== cards.length)
    throw new Error("文件包含重复的扑克牌。");
  if (parsed.draft.board.length > parsed.draft.boardSize)
    throw new Error("公共牌数量超出所选阶段。");
  return parsed.draft;
}
