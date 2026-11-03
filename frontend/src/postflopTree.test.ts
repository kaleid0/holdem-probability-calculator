import { describe, expect, it } from "vitest";
import { createGame, startGame } from "./liveGame";
import { emptyDraft } from "./model";
import { postflopReady } from "./postflopTree";

const game = {
  ...startGame(createGame(2, 0, 5, 10, [1000, 1000])),
  street: 3 as const,
  pending: [0],
  actor: 0,
  paid: [0, 0],
  total: [10, 10],
};
const draft = {
  ...emptyDraft(),
  hero: [48, 49] as [number, number],
  boardSize: 3 as const,
  board: [4, 9, 14],
  pot: "20",
  call: "0",
};

describe("limited tree readiness and advice", () => {
  it("only starts on the recorded in-position heads-up decision", () => {
    expect(postflopReady(draft, game)).toBe(true);
    expect(postflopReady(draft)).toBe(false);
    expect(postflopReady(draft, { ...game, dealer: 1 })).toBe(false);
    expect(postflopReady(draft, { ...game, pending: [0, 1] })).toBe(false);
    expect(postflopReady(draft, { ...game, historyComplete: false })).toBe(
      false,
    );
    expect(postflopReady({ ...draft, call: "5" }, game)).toBe(false);
    expect(postflopReady({ ...draft, board: [] }, game)).toBe(false);
  });
});
