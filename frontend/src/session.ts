import type { Draft } from "./model";
import { createGame } from "./liveGame";
import type { LiveGame } from "./liveGame";
import { defaultTable, tableSchema } from "./table";
import type { TableConfig } from "./table";

export type HandSnapshot = { draft: Draft; game: LiveGame | null };
export type Session = HandSnapshot & { history: HandSnapshot[] };
export type SessionAction =
  | { type: "patch"; patch: Partial<Draft> }
  | { type: "replace"; draft: Draft }
  | { type: "table"; count: number; table: TableConfig }
  | { type: "record"; game: LiveGame; draft?: Draft }
  | { type: "undo" }
  | { type: "new-hand" };

export const tableFor = (draft: Draft): TableConfig => ({
  ...defaultTable(),
  ...draft.table,
});
export function snapshotFromGame(game: LiveGame, draft: Draft): Draft {
  return {
    ...draft,
    table: {
      dealer: game.dealer,
      smallBlind: game.smallBlind,
      bigBlind: game.bigBlind,
    },
    opponents: draft.opponents.map((opponent, i) => ({
      ...opponent,
      folded: game.folded[i + 1],
    })),
    boardSize:
      game.phase === "deal"
        ? ((game.street === 0 ? 3 : game.street + 1) as Draft["boardSize"])
        : game.street,
    pot: String(game.total.reduce((sum, value) => sum + value, 0)),
    call: String(game.folded[0] ? 0 : Math.max(0, game.highest - game.paid[0])),
    futureBetting: game.street !== 5,
    bets: game.total.slice(1).map(String),
  };
}
export function sessionReducer(state: Session, action: SessionAction): Session {
  if (action.type === "replace")
    return { draft: action.draft, game: null, history: [] };
  if (action.type === "undo") {
    const previous = state.history.at(-1);
    return previous
      ? { ...previous, history: state.history.slice(0, -1) }
      : state;
  }
  if (action.type === "new-hand") {
    const table = tableFor(state.draft);
    if (state.game)
      table.dealer = (table.dealer + 1) % (state.draft.opponents.length + 1);
    const game = createGame(
      state.draft.opponents.length + 1,
      table.dealer,
      table.smallBlind,
      table.bigBlind,
    );
    const draft: Draft = {
      ...state.draft,
      table,
      hero: [null, null],
      board: [],
      boardSize: 0,
      deadCards: [],
      opponents: state.draft.opponents.map(() => ({ kind: "random" })),
      pot: "0",
      call: "0",
    };
    return { draft, game, history: [] };
  }
  if (action.type === "table") {
    if (
      state.game &&
      state.game.phase !== "hand" &&
      state.game.phase !== "finished"
    )
      return state;
    if (!Number.isInteger(action.count) || action.count < 2 || action.count > 9)
      return state;
    if (!tableSchema.safeParse(action.table).success) return state;
    const table = {
      ...action.table,
      dealer: Math.min(action.table.dealer, action.count - 1),
    };
    const opponents = Array.from(
      { length: action.count - 1 },
      (_, i) => state.draft.opponents[i] ?? { kind: "random" as const },
    );
    const draft = { ...state.draft, table, opponents };
    return {
      draft,
      game:
        state.game?.phase === "hand"
          ? createGame(
              action.count,
              table.dealer,
              table.smallBlind,
              table.bigBlind,
            )
          : null,
      history: [],
    };
  }
  if (action.type === "record") {
    const draft = snapshotFromGame(action.game, action.draft ?? state.draft);
    return {
      draft,
      game: action.game,
      history: [...state.history, { draft: state.draft, game: state.game }],
    };
  }
  // Analysis preferences and knowledge about opponents do not change the recorded actions.
  const changesFacts =
    ["hero", "board", "boardSize", "pot", "call", "table"].some(
      (key) => key in action.patch,
    ) ||
    (action.patch.opponents !== undefined &&
      (action.patch.opponents.length !== state.draft.opponents.length ||
        action.patch.opponents.some(
          (o, i) => !!o.folded !== !!state.draft.opponents[i]?.folded,
        )));
  return {
    ...state,
    draft: { ...state.draft, ...action.patch },
    game: changesFacts ? null : state.game,
    history: changesFacts ? [] : state.history,
  };
}
