import { describe, expect, it } from "vitest";
import { actionEv } from "./actionEv";
import { createGame, act } from "./liveGame";
import { emptyDraft, type Draft } from "./model";
import type { AnalysisResult } from "./api/client";

const game = {
  ...createGame(2, 0, 5, 10, [1000, 1000]),
  phase: "betting" as const,
  street: 3 as const,
  actor: 0,
  paid: [0, 50],
  total: [50, 100],
  highest: 50,
  minRaise: 50,
  pending: [0],
};
const draft: Draft = {
  ...emptyDraft(),
  hero: [48, 49],
  board: [4, 9, 14],
  boardSize: 3,
  pot: "150",
  call: "50",
  futureBetting: false,
  opponents: [{ kind: "random" }],
};
const result = { equity: 0.6, equity_standard_error: 0 } as AnalysisResult;
const passive = { fold: 0, raise: 0, probe: 0 };

describe("current action EV accounting", () => {
  it("uses sunk-cost zero for folds and correct net call/raise returns", () => {
    const ev = actionEv(draft, result, game, passive);
    expect(ev.reason).toBeUndefined();
    expect(ev.rows.find((x) => x.label === "弃牌")?.values[0]).toBe(0);
    expect(ev.rows.find((x) => x.label === "跟注 50")?.values[0]).toBeCloseTo(
      70,
    );
    // Raise to 150: add 150, opponent adds 100, final pot 400.
    expect(
      ev.rows.find((x) => x.label === "加注至 150")?.values[0],
    ).toBeCloseTo(90);
  });
  it("returns uncalled bets and applies loss only to chips newly committed", () => {
    const fold = actionEv(draft, result, game, { ...passive, fold: 1 });
    expect(
      fold.rows
        .filter((x) => x.label.startsWith("加注"))
        .every((x) => x.values[0] === 150),
    ).toBe(true);
    const raise = actionEv(draft, result, game, { ...passive, raise: 1 });
    expect(raise.rows.find((x) => x.label === "加注至 150")?.values[0]).toBe(
      -150,
    );
    // At effective all-in no opponent re-raise is possible.
    expect(raise.rows.at(-1)?.values[0]).toBeCloseTo(250);
  });
  it("models a capped future half-pot probe with hero call-or-fold", () => {
    const ev = actionEv(
      { ...draft, futureBetting: true },
      { ...result, equity: 0.1 },
      game,
      { ...passive, probe: 1 },
    );
    // Fold to future probe: lose only the 50 called now.
    expect(ev.rows.find((x) => x.label === "跟注 50")?.values[0]).toBe(-50);
    const allin = actionEv(
      { ...draft, futureBetting: true },
      result,
      { ...game, stacks: [100, 1000] },
      { ...passive, probe: 1 },
    );
    expect(
      allin.rows.find((x) => x.label === "跟注 50")?.values[0],
    ).toBeCloseTo(70);
    expect(allin.rows).toHaveLength(2);
  });
  it("produces legal and capped raise sizes, respecting unopened raise rights", () => {
    for (const g of [
      game,
      { ...game, stacks: [120, 1000] },
      { ...game, stacks: [1000, 120] },
      { ...game, actedAt: [50, null] },
    ]) {
      const ev = actionEv(draft, result, g);
      for (const row of ev.rows.filter((r) => r.label.startsWith("加注"))) {
        const target = row.additional + g.paid[0];
        const after = act(g, "raise", target);
        expect(after).not.toBe(g);
        expect(after.total[0] - g.total[0]).toBe(row.additional);
        expect(target).toBeLessThanOrEqual(
          g.paid[1] + g.stacks![1] - g.total[1],
        );
      }
    }
    expect(
      actionEv(draft, result, { ...game, actedAt: [50, null] }).rows,
    ).toHaveLength(2);
  });
  it("rejects stale scenes, side pots, invalid models and missing results", () => {
    expect(actionEv(draft, undefined, game).rows).toHaveLength(0);
    expect(actionEv({ ...draft, pot: "999" }, result, game).reason).toContain(
      "不一致",
    );
    expect(
      actionEv({ ...draft, call: "25" }, result, {
        ...game,
        stacks: [75, 1000],
      }).reason,
    ).toContain("边池");
    expect(
      actionEv(draft, result, game, { ...passive, fold: 0.8, raise: 0.3 })
        .reason,
    ).toContain("100%");
    expect(actionEv(draft, result, { ...game, actor: 1 }).rows).toHaveLength(0);
  });
  it("includes near-ties within sampling uncertainty and varies scenario outcomes", () => {
    const ev = actionEv(
      draft,
      { ...result, equity_standard_error: 0.01 },
      game,
    );
    expect(ev.scenarios).toHaveLength(3);
    expect(ev.rows.every((row) => row.values.every(Number.isFinite))).toBe(
      true,
    );
    expect(ev.rows.some((row) => row.errors.some((error) => error > 0))).toBe(
      true,
    );
    expect(ev.rows.find((x) => x.label === "跟注 50")!.values[1]).toBeLessThan(
      70,
    );
    expect(ev.best.length).toBeGreaterThan(0);
  });
  it("provides a zero-cost check without offering fold or betting into all-in opponent", () => {
    const ev = actionEv({ ...draft, call: "0", pot: "200" }, result, {
      ...game,
      paid: [50, 50],
      total: [100, 100],
      stacks: [1000, 100],
    });
    expect(ev.rows).toHaveLength(1);
    expect(ev.rows[0].label).toBe("过牌");
    expect(ev.rows[0].values[0]).toBe(120);
  });
});
