import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createGame, gameLog, nextStreet, startGame } from "./liveGame";

describe("hand identifiers on LAN HTTP pages", () => {
  const uuidV4 =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  beforeEach(() => {
    vi.stubGlobal("crypto", {
      getRandomValues: crypto.getRandomValues.bind(crypto),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("creates distinct UUIDs when randomUUID is unavailable", () => {
    const first = createGame().handId;
    const second = createGame().handId;
    expect(first).toMatch(uuidV4);
    expect(second).toMatch(uuidV4);
    expect(first).not.toBe(second);
  });

  it("assigns an ID to a legacy game and preserves existing IDs", () => {
    const game = createGame();
    expect(startGame(game).handId).toBe(game.handId);
    delete game.handId;
    expect(startGame(game).handId).toMatch(uuidV4);
  });
});

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
    expect(gameLog(game).at(-1)).toContain("赢得底池 15");
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
