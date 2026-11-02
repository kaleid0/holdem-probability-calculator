import { describe, expect, it } from "vitest";
import { emptyDraft } from "./model";
import { createGame, startGame } from "./liveGame";
import { riverReadiness } from "./riverReadiness";

function setup() {
  const draft = {
    ...emptyDraft(),
    hero: [48, 49] as [number, number],
    board: [4, 9, 14, 19, 24],
    boardSize: 5 as const,
    pot: "180",
    call: "0",
  };
  const game = {
    ...startGame(createGame(2, 0, 5, 10, [1000, 1000])),
    street: 5 as const,
    phase: "betting" as const,
    actor: 0,
    pending: [0],
    paid: [0, 0],
    total: [90, 90],
    highest: 0,
  };
  return { draft, game };
}

describe("automatic river readiness preview", () => {
  it("derives effective stack and reports a ready last action", () => {
    const { draft, game } = setup();
    expect(riverReadiness(draft, game)).toEqual({
      ready: true,
      reasons: [],
      effectiveStack: 910,
    });
  });
  it("explains missing history and the wrong street before submission", () => {
    const { draft } = setup();
    expect(
      riverReadiness({ ...draft, board: [], boardSize: 0 }).reasons.join(),
    ).toContain("五张");
    expect(riverReadiness(draft).reasons.join()).toContain("完整本手记录");
  });
  it("does not claim readiness for a pending opponent or a facing bet", () => {
    const { draft, game } = setup();
    expect(
      riverReadiness(draft, { ...game, pending: [0, 1] }).reasons.join(),
    ).toContain("最后行动");
    expect(
      riverReadiness({ ...draft, call: "20" }, game).reasons.join(),
    ).toContain("需要跟注");
  });
  it("detects edited pots, depleted stacks and ended hands", () => {
    const { draft, game } = setup();
    expect(
      riverReadiness({ ...draft, pot: "200" }, game).reasons.join(),
    ).toContain("不一致");
    expect(
      riverReadiness(draft, { ...game, stacks: [90, 1000] }).reasons.join(),
    ).toContain("筹码为零");
    expect(riverReadiness(draft, { ...game, phase: "finished" }).ready).toBe(
      false,
    );
  });
});
