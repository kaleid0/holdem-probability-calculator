import { describe, it, expect } from "vitest";
import { createGame, startGame, act } from "./liveGame";
import type { LiveGame } from "./liveGame";
import { emptyDraft } from "./model";
import { preflopAdvice } from "./preflopAdvice";

function draft(game: LiveGame, hero: [number, number] = [48, 49]) {
  return {
    ...emptyDraft(),
    hero,
    opponents: Array.from({ length: game.count - 1 }, () => ({
      kind: "random" as const,
    })),
    pot: String(game.total.reduce((a, b) => a + b, 0)),
    call: String(
      Math.min(game.highest - game.paid[0], game.stacks![0] - game.total[0]),
    ),
  };
}
describe("preflop training rules", () => {
  it("immediately gives a legal raise-to and incremental amount for the HU button", () => {
    const game = startGame(createGame(2, 0, 5, 10, [1000, 1000]));
    const advice = preflopAdvice(draft(game), game)!;
    expect(advice.title).toBe("倾向加注至 25");
    expect(advice.reason).toContain("追加 20");
    expect(advice.reason).toContain("BTN");
    expect(act(game, "raise", 25).highest).toBe(25);
  });
  it("folds weak hands facing a cost but checks for free in the BB", () => {
    const game = startGame(createGame(2, 0, 5, 10, [1000, 1000]));
    expect(preflopAdvice(draft(game, [0, 21]), game)?.title).toBe("倾向弃牌");
    const bigBlind = act(
      startGame(createGame(2, 1, 5, 10, [1000, 1000])),
      "call",
    );
    expect(preflopAdvice(draft(bigBlind, [0, 21]), bigBlind)?.title).toBe(
      "倾向过牌",
    );
  });
  it("identifies the cutoff in a larger opening table", () => {
    const game = startGame(createGame(6, 1, 5, 10, Array(6).fill(1000)));
    let current = game;
    while (current.actor !== 0) current = act(current, "fold");
    expect(preflopAdvice(draft(current), current)?.reason).toContain("CO");
  });
  it("does not issue shove advice for short stacks or a second hero action", () => {
    const short = startGame(createGame(2, 0, 5, 10, [150, 1000]));
    expect(preflopAdvice(draft(short), short)?.title).toContain("需复核");
    const game = startGame(createGame(2, 0, 5, 10, [1000, 1000]));
    const reraised = act(act(game, "raise", 25), "raise", 80);
    expect(preflopAdvice(draft(reraised), reraised)?.title).toContain("需复核");
  });
  it("requires a matching complete recording and the hero turn", () => {
    const game = startGame(createGame(2, 0, 5, 10, [1000, 1000]));
    expect(preflopAdvice({ ...draft(game), pot: "99" }, game)).toBeNull();
    expect(
      preflopAdvice(draft(game), { ...game, historyComplete: false }),
    ).toBeNull();
    expect(preflopAdvice(draft(game), { ...game, actor: 1 })).toBeNull();
    expect(preflopAdvice(draft(game))).toBeNull();
  });
});
