import { describe, expect, it } from "vitest";
import { emptyDraft, exampleDraft } from "./model";
import { act, nextStreet, startGame } from "./liveGame";
import { gameLog } from "./handHistory";
import { sessionReducer } from "./session";
import type { Session } from "./session";
import { loadSession, saveSession, sessionStorageKey } from "./sessionStorage";

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
}
function initial(): Session {
  return { draft: emptyDraft(), game: null, history: [], mode: "live" };
}
function restore(session: Session): Session {
  const storage = memoryStorage();
  saveSession(storage, session);
  const loaded = loadSession(storage);
  expect(loaded).toEqual(session);
  return loaded;
}

describe("saved hand sessions", () => {
  it("restores legacy text without inferring a complete structured history", () => {
    const storage = memoryStorage();
    let state = sessionReducer(initial(), { type: "new-hand" });
    state = sessionReducer(state, {
      type: "record",
      game: startGame(state.game!),
    });
    const oldGame = { ...state.game!, log: gameLog(state.game!) };
    const legacyGame = JSON.parse(JSON.stringify(oldGame));
    delete legacyGame.events;
    delete legacyGame.historyComplete;
    // Serializing through JSON matches the old on-disk shape, including undo snapshots.
    const raw = JSON.parse(
      JSON.stringify({ schemaVersion: 1, session: state }),
    );
    raw.session.game = legacyGame;
    for (const snapshot of raw.session.history) {
      delete snapshot.game?.events;
      delete snapshot.game?.historyComplete;
    }
    storage.setItem(sessionStorageKey, JSON.stringify(raw));
    state = loadSession(storage);
    expect(state.game!.historyComplete).toBe(false);
    expect(state.game!.events).toEqual([]);
    expect(gameLog(state.game!)).toEqual([
      "玩家 1（我） 小盲 5",
      "玩家 2 大盲 10",
    ]);
    state = sessionReducer(state, {
      type: "record",
      game: act(state.game!, "call"),
    });
    expect(state.game!.events).toHaveLength(1);
    expect(state.game!.events[0]).toMatchObject({
      sequence: 1,
      player: 0,
      action: "call",
      amount: 5,
      potBefore: 15,
    });
    state = restore(state);
    expect(state.game!.historyComplete).toBe(false);
    expect(gameLog(state.game!)).toHaveLength(3);
    expect(sessionReducer(state, { type: "undo" }).game!.events).toEqual([]);
  });
  it("restores preparation, blinds, calls, raises, folds and undo history", () => {
    let state = restore(sessionReducer(initial(), { type: "new-hand" }));
    state = restore(
      sessionReducer(state, {
        type: "record",
        game: state.game!,
        draft: { ...state.draft, hero: [48, null] },
      }),
    );
    state = sessionReducer(state, {
      type: "record",
      game: state.game!,
      draft: { ...state.draft, hero: [48, 44] },
    });
    state = restore(
      sessionReducer(state, { type: "record", game: startGame(state.game!) }),
    );
    const beforeRaise = state;
    state = restore(
      sessionReducer(state, {
        type: "record",
        game: act(state.game!, "raise", 30),
      }),
    );
    state = restore(
      sessionReducer(state, { type: "record", game: act(state.game!, "fold") }),
    );
    expect(state.game!.phase).toBe("finished");
    state = restore(sessionReducer(state, { type: "undo" }));
    state = restore(sessionReducer(state, { type: "undo" }));
    expect(state).toEqual(beforeRaise);
    expect(state.mode).toBe("live");
  });

  it("restores partial public cards and every betting street", () => {
    let state = sessionReducer(initial(), { type: "new-hand" });
    state = sessionReducer(state, {
      type: "record",
      game: startGame(state.game!),
      draft: { ...state.draft, hero: [48, 44] },
    });
    for (const street of [3, 4, 5] as const) {
      while (state.game!.phase === "betting")
        state = sessionReducer(state, {
          type: "record",
          game: act(state.game!, "call"),
        });
      state = restore(state);
      const board = [0, 4, 8, 12, 16].slice(0, street);
      if (street === 3)
        state = restore(
          sessionReducer(state, {
            type: "record",
            game: state.game!,
            draft: { ...state.draft, board: board.slice(0, 2) },
          }),
        );
      state = restore(
        sessionReducer(state, {
          type: "record",
          game: nextStreet(state.game!),
          draft: { ...state.draft, board },
        }),
      );
      expect(state.game!.street).toBe(street);
    }
    while (state.game!.phase === "betting")
      state = sessionReducer(state, {
        type: "record",
        game: act(state.game!, "call"),
      });
    expect(restore(state).game!.phase).toBe("finished");
    expect(
      restore(sessionReducer(state, { type: "mode", mode: "snapshot" })).mode,
    ).toBe("snapshot");
  });

  it.each([1, 2, 3])(
    "migrates v%s scene data without inventing a recording",
    (version) => {
      const storage = memoryStorage();
      storage.setItem(
        `holdem-lab:scenario:v${version}`,
        JSON.stringify({
          schemaVersion: version,
          draft: exampleDraft(),
        }),
      );
      expect(loadSession(storage)).toEqual({
        ...initial(),
        draft: exampleDraft(),
        mode: "snapshot",
      });
    },
  );

  it("keeps valid cards when a stored recording is damaged", () => {
    const storage = memoryStorage();
    const state = sessionReducer(initial(), { type: "new-hand" });
    storage.setItem(
      sessionStorageKey,
      JSON.stringify({
        schemaVersion: 1,
        session: {
          ...state,
          draft: exampleDraft(),
          game: { ...state.game, actor: 8 },
        },
      }),
    );
    const recovered = loadSession(storage);
    expect(recovered.game).toBeNull();
    expect(recovered.draft).toEqual(exampleDraft());
    expect(recovered.history).toEqual([]);
  });

  it("falls back to a compatible backup when the session JSON is corrupt", () => {
    const storage = memoryStorage();
    storage.setItem(sessionStorageKey, "{invalid");
    storage.setItem(
      "holdem-lab:scenario:v3",
      JSON.stringify({ schemaVersion: 3, draft: exampleDraft() }),
    );
    expect(loadSession(storage).draft).toEqual(exampleDraft());
  });

  it("keeps the app usable when browser storage is denied", () => {
    const denied = {
      getItem: () => {
        throw new Error("Storage denied");
      },
      setItem: () => {
        throw new Error("Storage denied");
      },
    };
    expect(loadSession(denied)).toEqual({ ...initial(), mode: "snapshot" });
    expect(() => saveSession(denied, initial())).not.toThrow();
  });
});
