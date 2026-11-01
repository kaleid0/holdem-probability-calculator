import { describe, expect, it } from "vitest";
import {
  act,
  createGame,
  nextStreet,
  settleGame,
  startGame,
} from "../../liveGame";
import { tableSeats } from "./tablePresentation";

describe("visual table seats", () => {
  it("previews blinds while retaining unposted preparation balances", () => {
    const game = createGame(3, 0, 5, 10, [100, 200, 300]);
    const seats = tableSeats(game);
    expect(seats.map((seat) => seat.roles)).toEqual([
      ["庄家 D"],
      ["小盲 SB"],
      ["大盲 BB"],
    ]);
    expect(seats.map((seat) => seat.balance)).toEqual([100, 200, 300]);
    expect(seats.every((seat) => seat.status === "待发牌")).toBe(true);
    expect(seats.every((seat) => !seat.active && !seat.lastAction)).toBe(true);
    expect(game.events).toEqual([]);
    expect(game.paid).toEqual([0, 0, 0]);
  });

  it("combines dealer and small blind heads-up and skips seats with no chips", () => {
    const game = createGame(4, 2, 5, 10, [100, 0, 200, 0]);
    const seats = tableSeats(game);
    expect(seats.map((seat) => seat.roles)).toEqual([
      ["大盲 BB"],
      [],
      ["庄家 D", "小盲 SB"],
      [],
    ]);
    expect(seats[1]).toMatchObject({ status: "无筹码", balance: 0 });
    expect(seats[3]).toMatchObject({ status: "无筹码", balance: 0 });
    expect(tableSeats(startGame(game))[2].active).toBe(true);
  });

  it("shows the current actor, remaining chips and latest additional call", () => {
    const game = act(
      startGame(createGame(3, 0, 5, 10, [100, 100, 100])),
      "call",
    );
    const seats = tableSeats(game);
    expect(seats[0]).toMatchObject({
      index: 0,
      name: "玩家 1（我）",
      balance: 90,
      active: false,
      status: "等待行动",
      lastAction: "跟注 10",
    });
    expect(seats[1]).toMatchObject({
      balance: 95,
      active: true,
      status: "行动中",
      lastAction: "小盲 5",
    });
    expect(seats.filter((seat) => seat.active)).toHaveLength(1);
  });

  it("retains blind seats after folds and clears actor highlighting at hand end", () => {
    let game = startGame(createGame(3, 0, 5, 10, [100, 100, 100]));
    game = act(act(game, "fold"), "fold");
    const seats = tableSeats(game);
    expect(seats[1]).toMatchObject({
      roles: ["小盲 SB"],
      status: "已弃牌",
      lastAction: "弃牌",
    });
    expect(seats[2]).toMatchObject({
      roles: ["大盲 BB"],
      status: "等待摊牌",
    });
    expect(seats.every((seat) => !seat.active)).toBe(true);
  });

  it("uses raise-to amounts and clears old action labels on a new street", () => {
    let game = startGame(createGame());
    game = act(game, "raise", 30);
    expect(tableSeats(game)[0].lastAction).toBe("加注至 30");
    game = act(act(game, "call"), "call");
    expect(tableSeats(game).every((seat) => !seat.active)).toBe(true);
    expect(tableSeats(game)[0].status).toBe("待发牌");
    game = nextStreet(game);
    expect(tableSeats(game).every((seat) => seat.lastAction === null)).toBe(
      true,
    );
    expect(tableSeats(game)[1].active).toBe(true);
    game = act(game, "call");
    expect(tableSeats(game)[1].lastAction).toBe("过牌");
    game = act(game, "raise", 20);
    expect(tableSeats(game)[2].lastAction).toBe("下注 20");
  });

  it("shows all-in seats during runout without treating folded seats as all-in", () => {
    let game = startGame(createGame(3, 0, 5, 10, [10, 100, 100]));
    game = act(game, "call");
    game = act(game, "fold");
    game = act(game, "call");
    expect(tableSeats(game)[0].status).toBe("全下");
    expect(tableSeats(game)[1].status).toBe("已弃牌");
    game = nextStreet(game);
    expect(tableSeats(game)[0]).toMatchObject({
      status: "全下",
      balance: 0,
      active: false,
      lastAction: null,
    });
    expect(tableSeats(game)[1].status).toBe("已弃牌");
  });

  it("adds settled distributions including refunds without declaring winners", () => {
    let game = startGame(createGame(3, 0, 5, 10, [100, 20, 50]));
    game = act(game, "raise", 100);
    game = act(act(game, "call"), "call");
    while (game.phase === "deal") game = nextStreet(game);
    game = settleGame(game, [[1], [2]]);
    const seats = tableSeats(game);
    expect(seats.map((seat) => seat.balance)).toEqual([50, 60, 60]);
    expect(seats.every((seat) => seat.status === "已结算")).toBe(true);
    expect(seats.every((seat) => !seat.active)).toBe(true);
  });

  it("keeps legacy unbounded chips and missing blind events unknown", () => {
    const game = {
      ...startGame(createGame()),
      events: [],
      historyComplete: false,
    };
    const seats = tableSeats(game);
    expect(seats.every((seat) => seat.balance === null)).toBe(true);
    expect(seats.map((seat) => seat.roles)).toEqual([["庄家 D"], [], []]);
    expect(seats.every((seat) => seat.lastAction === null)).toBe(true);
  });
});
