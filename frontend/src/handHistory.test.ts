import { describe, expect, it } from "vitest";
import { act, createGame, nextStreet, startGame } from "./liveGame";
import {
  actionsByPlayer,
  gameLog,
  handEventSchema,
  playerActions,
} from "./handHistory";

describe("structured hand history", () => {
  it("records incremental chips, raise-to and decision context in table order", () => {
    const initial = startGame(createGame(3, 0));
    let game = act(initial, "call");
    game = act(game, "raise", 30);
    expect(game.events.at(-1)).toEqual({
      kind: "action",
      sequence: 4,
      street: 0,
      player: 1,
      action: "raise",
      amount: 25,
      streetTotal: 30,
      totalCommitted: 30,
      toCall: 5,
      highestBefore: 10,
      minRaiseBefore: 10,
      potBefore: 25,
      potAfter: 50,
      activePlayersBefore: 3,
    });
    expect(
      playerActions(game, 1).map(({ action, amount }) => [action, amount]),
    ).toEqual([
      ["smallBlind", 5],
      ["raise", 25],
    ]);
    expect(actionsByPlayer(game).map((actions) => actions.length)).toEqual([
      1, 2, 1,
    ]);
    expect(game.events.map(({ sequence }) => sequence)).toEqual([1, 2, 3, 4]);
    expect(gameLog(game)).toEqual([
      "玩家 2 小盲 5",
      "玩家 3 大盲 10",
      "翻前 · 玩家 1（我） 跟注 10",
      "翻前 · 玩家 2 加注至 30（追加 25）",
    ]);
    expect(initial.events).toHaveLength(2);
    expect(initial.log).toEqual([]);
    for (const event of game.events)
      expect(handEventSchema.safeParse(event).success).toBe(true);
  });

  it("distinguishes checks, opening bets and raises, retaining the board at each street", () => {
    let game = startGame(createGame(3));
    for (let i = 0; i < 3; i++) game = act(game, "call");
    const board = [0, 4, 8];
    game = nextStreet(game, board);
    board.push(12);
    expect(game.events.at(-1)).toMatchObject({
      kind: "street",
      street: 3,
      board: [0, 4, 8],
    });
    game = act(game, "call");
    expect(game.events.at(-1)).toMatchObject({
      action: "check",
      player: 1,
      amount: 0,
      toCall: 0,
    });
    game = act(game, "raise", 20);
    expect(game.events.at(-1)).toMatchObject({
      action: "bet",
      player: 2,
      amount: 20,
      streetTotal: 20,
      highestBefore: 0,
    });
    game = act(game, "raise", 50);
    expect(game.events.at(-1)).toMatchObject({
      action: "raise",
      player: 0,
      amount: 50,
      streetTotal: 50,
      totalCommitted: 60,
      toCall: 20,
    });
    game = act(game, "fold");
    expect(game.events.at(-1)).toMatchObject({
      action: "fold",
      amount: 0,
      toCall: 50,
      potBefore: 100,
      potAfter: 100,
    });
    expect(playerActions(game, 1).map(({ action }) => action)).toEqual([
      "smallBlind",
      "call",
      "check",
      "fold",
    ]);
  });

  it("records hand completion separately and never invents a showdown winner", () => {
    let folded = startGame(createGame(3));
    folded = act(act(folded, "fold"), "fold");
    expect(folded.events.at(-1)).toMatchObject({
      kind: "handEnd",
      reason: "allOthersFolded",
      winner: 2,
      pot: 15,
    });
    expect(act(folded, "call")).toBe(folded);
    let showdown = startGame(createGame(2));
    for (let round = 0; round < 4; round++) {
      showdown = act(act(showdown, "call"), "call");
      if (round < 3) showdown = nextStreet(showdown);
    }
    expect(showdown.events.at(-1)).toMatchObject({
      kind: "handEnd",
      reason: "showdown",
      winner: null,
      street: 5,
      pot: 20,
    });
    expect(showdown.events.map((event) => event.sequence)).toEqual(
      Array.from({ length: showdown.events.length }, (_, i) => i + 1),
    );
    expect(
      playerActions(showdown, 0).every((event) => event.kind === "action"),
    ).toBe(true);
  });

  it("does not add events for invalid raises or repeated blind posting", () => {
    const game = startGame(createGame(3));
    expect(act(game, "raise", 15)).toBe(game);
    expect(startGame(game)).toBe(game);
    expect(game.events).toHaveLength(2);
  });
});
