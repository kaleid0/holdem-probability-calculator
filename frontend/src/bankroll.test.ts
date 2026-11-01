import { describe, expect, it } from "vitest";
import { emptyDraft } from "./model";
import { bankrollFor, bankrollSchema } from "./bankroll";
import {
  act,
  canRaise,
  createGame,
  gamePots,
  nextStreet,
  remainingChips,
  settleGame,
  startGame,
} from "./liveGame";
import type { LiveGame } from "./liveGame";
import { sessionReducer } from "./session";
import type { Session } from "./session";
import { loadSession, saveSession } from "./sessionStorage";

function prepare(amounts = [100, 200]): Session {
  let state: Session = {
    draft: {
      ...emptyDraft(),
      opponents: amounts.slice(1).map(() => ({ kind: "random" })),
    },
    game: null,
    history: [],
    mode: "live",
  };
  state = sessionReducer(state, { type: "initial-chips", amounts });
  state = sessionReducer(state, { type: "new-hand" });
  return sessionReducer(state, {
    type: "record",
    game: startGame(state.game!),
  });
}
function record(
  state: Session,
  action: "call" | "fold" | "raise",
  amount = 0,
): Session {
  return sessionReducer(state, {
    type: "record",
    game: act(state.game!, action, amount),
  });
}
function runout(game: LiveGame): LiveGame {
  while (game.phase !== "finished") {
    game = game.phase === "deal" ? nextStreet(game) : act(game, "call");
  }
  return game;
}
function reload(state: Session): Session {
  const data = new Map<string, string>();
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
  saveSession(storage, state);
  const restored = loadSession(storage);
  expect(restored).toEqual(state);
  return restored;
}

describe("player chips across hands", () => {
  it("settles folds once, restores on undo, carries balances and records consecutive hands", () => {
    const before = prepare();
    let state = reload(record(before, "fold"));
    expect(bankrollFor(state.draft).balances).toEqual([95, 205]);
    expect(bankrollFor(state.draft).hands[0]).toMatchObject({
      committed: [5, 10],
      payouts: [0, 15],
    });
    expect(sessionReducer(state, { type: "settle", winners: [] })).toBe(state);
    expect(reload(sessionReducer(state, { type: "undo" }))).toEqual(before);
    state = sessionReducer(state, { type: "new-hand" });
    expect(state.game!.stacks).toEqual([95, 205]);
    expect(state.game!.dealer).toBe(1);
    state = sessionReducer(state, {
      type: "record",
      game: startGame(state.game!),
    });
    state = reload(record(state, "fold"));
    expect(bankrollFor(state.draft).balances).toEqual([100, 200]);
    expect(bankrollFor(state.draft).hands).toHaveLength(2);
    expect(bankrollSchema.safeParse(state.draft.bankroll).success).toBe(true);
  });
  it("requires showdown confirmation, splits pots and undoes the settlement", () => {
    let state = prepare();
    state = reload(
      sessionReducer(state, { type: "record", game: runout(state.game!) }),
    );
    expect(state.game!.payouts).toBeUndefined();
    expect(sessionReducer(state, { type: "new-hand" })).toBe(state);
    const before = state;
    state = reload(
      sessionReducer(state, { type: "settle", winners: [[0, 1]] }),
    );
    expect(state.game!.payouts).toEqual([10, 10]);
    expect(bankrollFor(state.draft).balances).toEqual([100, 200]);
    expect(sessionReducer(state, { type: "undo" })).toEqual(before);
  });
  it("caps short calls, skips all-in players, splits side pots and returns uncalled chips", () => {
    let state = prepare([100, 20, 50]);
    state = record(state, "raise", 100);
    state = record(state, "call");
    state = record(state, "call");
    expect(state.game!.total).toEqual([100, 20, 50]);
    expect(state.game!.phase).toBe("deal");
    expect(remainingChips(state.game!, 0)).toBe(0);
    expect(state.draft.call).toBe("0");
    expect(gamePots(state.game!)).toEqual([
      { amount: 60, eligible: [0, 1, 2] },
      { amount: 60, eligible: [0, 2] },
      { amount: 50, eligible: [0], refund: 0 },
    ]);
    state = reload(
      sessionReducer(state, { type: "record", game: runout(state.game!) }),
    );
    expect(state.game!.events.at(-1)?.kind).toBe("handEnd");
    const invalid = sessionReducer(state, {
      type: "settle",
      winners: [[1], [1]],
    });
    expect(invalid).toBe(state);
    state = reload(
      sessionReducer(state, { type: "settle", winners: [[1], [2]] }),
    );
    expect(state.game!.payouts).toEqual([50, 60, 60]);
    expect(bankrollFor(state.draft).balances).toEqual([50, 60, 60]);
    expect(bankrollSchema.safeParse(state.draft.bankroll).success).toBe(true);
  });
  it("rejects bets above the stack and does not reopen a short all-in raise", () => {
    let game = startGame(createGame(3, 0, 5, 10, [100, 15, 100]));
    expect(act(game, "raise", 101)).toBe(game);
    game = act(game, "call");
    game = act(game, "raise", 15);
    expect(game.minRaise).toBe(10);
    game = act(game, "call");
    expect(game.actor).toBe(0);
    expect(canRaise(game)).toBe(false);
    expect(act(game, "raise", 25)).toBe(game);
    game = act(game, "call");
    expect(game.phase).toBe("deal");
    expect(game.total).toEqual([15, 15, 15]);
  });
  it("keeps nominal big-blind calls when the big blind is short", () => {
    let game = startGame(createGame(3, 0, 5, 10, [100, 100, 3]));
    game = act(game, "call");
    game = act(game, "call");
    expect(game.total).toEqual([10, 10, 3]);
    expect(game.phase).toBe("deal");
  });
  it("uses the next funded seats and preserves total chips on an odd-chip split", () => {
    let game = startGame(createGame(4, 1, 1, 2, [0, 100, 100, 100]));
    expect(game.paid).toEqual([0, 0, 1, 2]);
    expect(game.actor).toBe(1);
    game = act(game, "call");
    game = act(game, "fold");
    game = runout(act(game, "call"));
    const settled = settleGame(game, [
      [1, 3],
      [1, 3],
    ]);
    expect(settled.payouts).toEqual([0, 2, 0, 3]);
    expect(settled.payouts!.reduce((a, b) => a + b, 0)).toBe(5);
  });
  it("locks initial balances after play and skips busted seats next hand", () => {
    let state = prepare([10, 20, 0]);
    expect(state.game!.paid).toEqual([5, 10, 0]);
    expect(
      sessionReducer(state, { type: "initial-chips", amounts: [20, 20, 20] }),
    ).toBe(state);
    state = record(state, "call");
    state = sessionReducer(state, {
      type: "record",
      game: runout(state.game!),
    });
    state = sessionReducer(state, { type: "settle", winners: [[1]] });
    state = sessionReducer(state, { type: "new-hand" });
    expect(state.game!.stacks).toEqual([0, 30, 0]);
    expect(state.game!.dealer).toBe(1);
    expect(startGame(state.game!)).toBe(state.game);
  });
  it("rejects inconsistent saved ledger arithmetic", () => {
    const book = bankrollFor(record(prepare(), "fold").draft);
    expect(
      bankrollSchema.safeParse({ ...book, balances: [100, 205] }).success,
    ).toBe(false);
    expect(
      bankrollSchema.safeParse({
        ...book,
        hands: [{ ...book.hands[0], payouts: [0, 20] }],
      }).success,
    ).toBe(false);
  });
  it("merges folded contribution levels before awarding odd chips", () => {
    const game: LiveGame = {
      ...createGame(5, 0, 1, 2, [100, 100, 100, 100, 100]),
      phase: "finished",
      total: [5, 1, 2, 3, 5],
      folded: [false, true, true, true, false],
    };
    expect(gamePots(game)).toEqual([{ amount: 16, eligible: [0, 4] }]);
    expect(settleGame(game, [[0, 4]]).payouts).toEqual([8, 0, 0, 0, 8]);
  });
});
