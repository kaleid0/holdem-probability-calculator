import { describe, it, expect } from "vitest";
import { emptyDraft, toRequest, parseSaved, validateDraft } from "./model";
import { sessionReducer, tableFor } from "./session";
import type { Session } from "./session";
import { act, startGame } from "./liveGame";

function initial(): Session {
  return { draft: emptyDraft(), game: null, history: [], mode: "snapshot" };
}
function prepared(): Session {
  let state = sessionReducer(initial(), {
    type: "table",
    count: 3,
    table: { dealer: 0, smallBlind: 2, bigBlind: 4 },
  });
  state = sessionReducer(state, { type: "new-hand" });
  return sessionReducer(state, {
    type: "record",
    game: state.game!,
    draft: { ...state.draft, hero: [48, 44] },
  });
}
describe("shared hand session", () => {
  it("uses the same table configuration for blind posting, call and snapshot", () => {
    let state = prepared();
    state = sessionReducer(state, {
      type: "record",
      game: startGame(state.game!),
    });
    expect(state.draft.pot).toBe("6");
    expect(state.draft.call).toBe("4");
    expect(state.game!.paid).toEqual([0, 2, 4]);
    expect(tableFor(state.draft).bigBlind).toBe(4);
    const locked = sessionReducer(state, {
      type: "table",
      count: 9,
      table: { dealer: 1, smallBlind: 5, bigBlind: 10 },
    });
    expect(locked).toBe(state);
  });
  it("keeps folded seats and chips while excluding them from equity opponents", () => {
    let state = prepared();
    state = sessionReducer(state, {
      type: "record",
      game: startGame(state.game!),
    });
    state = sessionReducer(state, {
      type: "record",
      game: act(state.game!, "call"),
    });
    state = sessionReducer(state, {
      type: "record",
      game: act(state.game!, "fold"),
    });
    expect(state.draft.opponents).toHaveLength(2);
    expect(state.draft.opponents[0].folded).toBe(true);
    expect(toRequest(state.draft).opponents).toHaveLength(1);
    expect(state.draft.pot).toBe("10");
    state = sessionReducer(state, { type: "undo" });
    expect(state.draft.opponents[0].folded).toBe(false);
    expect(state.game!.actor).toBe(1);
  });
  it("preserves recording when changing analysis preferences but invalidates changed facts", () => {
    let state = prepared();
    state = sessionReducer(state, {
      type: "record",
      game: startGame(state.game!),
    });
    const preferences = sessionReducer(state, {
      type: "patch",
      patch: {
        samples: 10000,
        opponents: [{ kind: "range", text: "AA" }, { kind: "random" }],
      },
    });
    expect(preferences.game).toBe(state.game);
    const edited = sessionReducer(preferences, {
      type: "patch",
      patch: { pot: "200" },
    });
    expect(edited.game).toBeNull();
    expect(edited.history).toEqual([]);
    expect(edited.draft.hero).toEqual([48, 44]);
  });
  it("starts a fresh hand with rotated dealer while retaining settings", () => {
    const state = prepared();
    const next = sessionReducer(state, { type: "new-hand" });
    expect(next.draft.hero).toEqual([null, null]);
    expect(next.draft.pot).toBe("0");
    expect(next.game!.dealer).toBe(1);
    expect(next.game!.bigBlind).toBe(4);
    expect(next.draft.strategyIds).toEqual(state.draft.strategyIds);
    expect(next.history).toEqual([]);
  });
  it("exports v3 seats and table, treats known folded cards as dead and imports legacy scenes", () => {
    const draft = {
      ...emptyDraft(),
      hero: [48, 44] as [number, number],
      opponents: [
        {
          kind: "exact" as const,
          cards: [0, 1] as [number, number],
          folded: true,
        },
        { kind: "random" as const },
      ],
      table: { dealer: 2, smallBlind: 2, bigBlind: 4 },
    };
    expect(toRequest(draft).dead_cards).toEqual([0, 1]);
    expect(toRequest(draft).opponents).toEqual([{ kind: "random" }]);
    expect(parseSaved(JSON.stringify({ schemaVersion: 3, draft }))).toEqual(
      draft,
    );
    expect(
      parseSaved(JSON.stringify({ schemaVersion: 2, draft: emptyDraft() })),
    ).toEqual(emptyDraft());
    expect(
      validateDraft({
        ...draft,
        opponents: draft.opponents.map((o) => ({ ...o, folded: true })),
      }).join(),
    ).toContain("在局对手");
  });
  it("importing a snapshot never invents a betting history", () => {
    const state = prepared();
    const imported = sessionReducer(state, {
      type: "replace",
      draft: { ...state.draft, board: [0, 4, 8], boardSize: 3 },
    });
    expect(imported.game).toBeNull();
    expect(imported.history).toEqual([]);
    expect(imported.draft.table).toEqual(state.draft.table);
  });
});
