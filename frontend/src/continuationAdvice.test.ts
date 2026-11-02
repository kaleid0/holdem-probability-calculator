import { describe, expect, it } from "vitest";
import { continuationAdvice } from "./continuationAdvice";
import { createGame } from "./liveGame";
import { emptyDraft, type Draft } from "./model";
import type { AnalysisResult } from "./api/client";

const game = {
  ...createGame(2, 0, 5, 10, [1000, 1000]),
  phase: "betting" as const,
  actor: 0,
  street: 3 as const,
  total: [50, 100],
  paid: [0, 50],
  highest: 50,
  pending: [0],
};
const draft: Draft = {
  ...emptyDraft(),
  hero: [0, 1],
  board: [2, 3, 4],
  boardSize: 3 as const,
  pot: "150",
  call: "50",
  futureBetting: true,
};
const result = (equity: number) =>
  ({ equity, equity_standard_error: 0.005 }) as AnalysisResult;

describe("continuation guidance", () => {
  it("covers facing a bet with explicit heuristic assumptions and uncertainty", () => {
    expect(continuationAdvice(draft, result(0.6), game)?.title).toContain(
      "跟注 50",
    );
    expect(continuationAdvice(draft, result(0.1), game)?.title).toContain(
      "弃牌",
    );
    expect(continuationAdvice(draft, result(0.33), game)?.title).toContain(
      "需复核",
    );
    expect(continuationAdvice(draft, result(0.6), game)?.reason).toContain(
      "并非计算出的未来损失",
    );
  });
  it("offers free continuation without inferring a value bet from equity", () => {
    expect(
      continuationAdvice({ ...draft, call: "0" }, undefined, {
        ...game,
        highest: 0,
        total: [50, 50],
      })?.title,
    ).toBeUndefined();
    expect(
      continuationAdvice({ ...draft, call: "0", pot: "100" }, undefined, {
        ...game,
        highest: 0,
        total: [50, 50],
      })?.title,
    ).toContain("过牌");
  });
  it("rejects stale scenes, other actors and missing equity", () => {
    expect(
      continuationAdvice(draft, result(0.6), { ...game, actor: 1 }),
    ).toBeNull();
    expect(
      continuationAdvice({ ...draft, call: "40" }, result(0.6), game),
    ).toBeNull();
    expect(continuationAdvice(draft, undefined, game)).toBeNull();
    expect(continuationAdvice(draft, result(NaN), game)).toBeNull();
  });
  it("does not apply whole-pot odds to side pots or all-in calls", () => {
    expect(
      continuationAdvice(draft, result(0.9), { ...game, stacks: [100, 1000] })
        ?.title,
    ).toContain("全下");
    expect(
      continuationAdvice({ ...draft, pot: "250" }, result(0.9), {
        ...game,
        total: [50, 200],
      })?.title,
    ).toContain("边池");
  });
  it("also covers preflop repeated decisions and later streets", () => {
    for (const street of [0, 4, 5] as const) {
      expect(
        continuationAdvice(
          {
            ...draft,
            boardSize: street,
            board: Array.from({ length: street }, (_, i) => i + 2),
          },
          result(0.6),
          { ...game, street },
        )?.title,
      ).toContain("跟注");
    }
  });
});
