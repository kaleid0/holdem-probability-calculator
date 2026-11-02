import { describe, expect, it } from "vitest";
import { act, createGame, nextStreet, startGame } from "./liveGame";
import { emptyDraft, toRequest } from "./model";
import { defaultScenarios, sensitivityRequest } from "./sensitivity";
import { snapshotFromGame } from "./session";
import { parseRange, serializeCombos } from "./ranges";

function recorded() {
  let game = startGame(createGame(2, 0, 5, 10, [1000, 1000]));
  game = act(game, "call");
  game = act(game, "call");
  game = nextStreet(game, [4, 9, 14]);
  game = act(game, "raise", 20);
  game = act(game, "call");
  game = nextStreet(game, [4, 9, 14, 19]);
  game = act(game, "raise", 60);
  const draft = snapshotFromGame(game, {
    ...emptyDraft(),
    hero: [48, 49],
    board: [4, 9, 14, 19],
  });
  return { game, draft };
}

describe("history sensitivity request", () => {
  it("preserves seats, historical boards and cutoff without reusing current range", () => {
    const { game, draft } = recorded();
    draft.opponents = [{ kind: "range", text: "AA", rangeSource: "current" }];
    const input = sensitivityRequest(
      draft,
      game,
      1,
      "history",
      "",
      defaultScenarios,
    );
    expect(input.preflop_prior).toBeNull();
    expect(input.history_context?.opening_seats).toEqual([0, 1]);
    expect(input.history_context?.cutoff_sequence).toBe(9);
    expect(
      input.history_context?.events
        .filter((e) => e.kind === "street")
        .map((e) => e.board),
    ).toEqual([
      [4, 9, 14],
      [4, 9, 14, 19],
    ]);
    expect(input.base_analysis.pot_context?.contributions).toEqual([30, 90]);
    expect(input.base_analysis.call_amount).toBe(60);
  });
  it("rejects incomplete and old ambiguous histories", () => {
    const { game, draft } = recorded();
    expect(() =>
      sensitivityRequest(
        draft,
        { ...game, historyComplete: false },
        1,
        "history",
        "",
        defaultScenarios,
      ),
    ).toThrow("完整");
    expect(() =>
      sensitivityRequest(
        draft,
        { ...game, openingSeats: undefined, stacks: undefined },
        1,
        "history",
        "",
        defaultScenarios,
      ),
    ).toThrow("开局");
  });
  it("manual snapshots need no history and do not infer from current ranges", () => {
    const { draft } = recorded();
    const scenarios = defaultScenarios.map((s) => ({
      ...s,
      current_range: { kind: "range" as const, text: "KK" },
    }));
    const input = sensitivityRequest(draft, null, 1, "manual", "", scenarios);
    expect(input.history_context).toBeUndefined();
    expect(input.scenarios).toHaveLength(3);
  });
  it("specific suit posterior weights survive text serialization and scene requests", () => {
    const posterior = [
      { cards: [40, 41], weight: 1 },
      { cards: [40, 42], weight: 0.0123456789 },
    ];
    const text = serializeCombos(posterior);
    expect(parseRange(text)).toEqual(posterior);
    const draft = {
      ...emptyDraft(),
      hero: [48, 49] as [number, number],
      opponents: [
        { kind: "range" as const, text, rangeSource: "current" as const },
      ],
    };
    expect(toRequest(draft).opponents[0]).toEqual({ kind: "range", text });
  });
});
