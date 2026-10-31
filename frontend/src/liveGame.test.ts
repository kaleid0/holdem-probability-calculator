import { describe, expect, it } from "vitest";
import { act, createGame, nextStreet, startGame } from "./liveGame";

describe("live betting rounds", () => {
  it("posts blinds and preserves the big blind's option after calls", () => {
    let game = startGame(createGame(3, 0));
    expect(game.paid).toEqual([0, 5, 10]);
    expect(game.actor).toBe(0);
    game = act(game, "call");
    game = act(game, "call");
    expect(game.phase).toBe("betting");
    expect(game.actor).toBe(2);
    game = act(game, "call");
    expect(game.phase).toBe("deal");
    expect(game.total).toEqual([10, 10, 10]);
    game = nextStreet(game);
    expect(game.street).toBe(3);
    expect(game.actor).toBe(1);
    expect(game.paid).toEqual([0, 0, 0]);
    expect(game.total.reduce((a, b) => a + b)).toBe(30);
  });
  it("reopens action on a raise and rejects an insufficient raise", () => {
    let game = startGame(createGame());
    expect(act(game, "raise", 15)).toBe(game);
    game = act(game, "call");
    game = act(game, "raise", 30);
    expect(game.minRaise).toBe(20);
    expect(game.pending).toEqual([0, 2]);
    game = act(game, "call");
    expect(game.actor).toBe(0);
    game = act(game, "call");
    expect(game.phase).toBe("deal");
    expect(game.total).toEqual([30, 30, 30]);
  });
  it("retains folded chips and ends immediately when one player remains", () => {
    let game = startGame(createGame());
    game = act(game, "fold");
    game = act(game, "fold");
    expect(game.phase).toBe("finished");
    expect(game.total).toEqual([0, 5, 10]);
    expect(game.log.at(-1)).toContain("赢得底池 15");
  });
  it("uses the heads-up dealer as small blind and reverses postflop order", () => {
    let game = startGame(createGame(2, 0));
    expect(game.paid).toEqual([5, 10]);
    expect(game.actor).toBe(0);
    game = act(act(game, "call"), "call");
    game = nextStreet(game);
    expect(game.actor).toBe(1);
    for (let round = 0; round < 3; round++) {
      game = act(act(game, "call"), "call");
      if (round < 2) game = nextStreet(game);
    }
    expect(game.phase).toBe("finished");
    expect(game.street).toBe(5);
  });
});
