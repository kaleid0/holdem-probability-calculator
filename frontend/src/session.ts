import type { Draft } from "./model";
import { createGame, settleGame, remainingChips } from "./liveGame";
import { bankrollFor, chipAmount } from "./bankroll";
import type { LiveGame } from "./liveGame";
import { defaultTable, tableSchema } from "./table";
import type { TableConfig } from "./table";

export type HandSnapshot = { draft: Draft; game: LiveGame | null };
export type Session = HandSnapshot & {
  history: HandSnapshot[];
  mode: "snapshot" | "live";
};
export type SessionAction =
  | { type: "mode"; mode: Session["mode"] }
  | { type: "patch"; patch: Partial<Draft> }
  | { type: "replace"; draft: Draft }
  | { type: "table"; count: number; table: TableConfig }
  | { type: "record"; game: LiveGame; draft?: Draft }
  | { type: "undo" }
  | { type: "initial-chips"; amounts: number[] }
  | { type: "reset-session"; amounts: number[] }
  | { type: "settle"; winners: number[][] }
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
    call: String(
      game.folded[0]
        ? 0
        : Math.min(
            remainingChips(game, 0),
            Math.max(0, game.highest - game.paid[0]),
          ),
    ),
    futureBetting:
      game.street !== 5 &&
      game.folded.filter((f, i) => !f && remainingChips(game, i) > 0).length >
        1,
    bets: game.total.slice(1).map(String),
  };
}
export function sessionReducer(state: Session, action: SessionAction): Session {
  if (action.type === "initial-chips" || action.type === "reset-session") {
    if (
      (action.type === "initial-chips" &&
        (bankrollFor(state.draft).hands.length ||
          (state.game && state.game.phase !== "hand"))) ||
      action.amounts.length !== state.draft.opponents.length + 1 ||
      action.amounts.some((n) => !chipAmount.safeParse(n).success) ||
      action.amounts.filter((n) => n > 0).length < 2 ||
      action.amounts.reduce((a, b) => a + b, 0) > 1_000_000_000
    )
      return state;
    const draft = {
      ...state.draft,
      bankroll: {
        initial: [...action.amounts],
        balances: [...action.amounts],
        hands: [],
      },
    };
    const table = tableFor(draft);
    if (action.amounts[table.dealer] === 0)
      table.dealer = action.amounts.findIndex((n) => n > 0);
    draft.table = table;
    if (action.type === "reset-session") {
      return {
        ...state,
        draft: {
          ...draft,
          hero: [null, null],
          board: [],
          boardSize: 0,
          deadCards: [],
          opponents: draft.opponents.map((_, i) => ({
            kind: "random",
            folded: action.amounts[i + 1] === 0,
          })),
          pot: "0",
          call: "0",
          bets: draft.opponents.map(() => "0"),
          futureBetting: true,
        },
        game: null,
        history: [],
      };
    }
    return {
      ...state,
      draft,
      history: [],
      game: state.game
        ? createGame(
            action.amounts.length,
            table.dealer,
            table.smallBlind,
            table.bigBlind,
            action.amounts,
          )
        : null,
    };
  }
  if (action.type === "settle") {
    if (!state.game || state.game.payouts) return state;
    const game = settleGame(state.game, action.winners);
    if (game === state.game) return state;
    return sessionReducer(state, { type: "record", game });
  }
  if (action.type === "mode") return { ...state, mode: action.mode };
  if (action.type === "replace")
    return { ...state, draft: action.draft, game: null, history: [] };
  if (action.type === "undo") {
    const previous = state.history.at(-1);
    return previous
      ? { ...state, ...previous, history: state.history.slice(0, -1) }
      : state;
  }
  if (action.type === "new-hand") {
    if (
      state.game?.stacks &&
      state.game.phase === "finished" &&
      !state.game.payouts
    )
      return state;
    const book = bankrollFor(state.draft);
    const table = tableFor(state.draft);
    if (state.game)
      table.dealer = (table.dealer + 1) % (state.draft.opponents.length + 1);
    for (
      let i = 0;
      i < book.balances.length && book.balances[table.dealer] === 0;
      i++
    )
      table.dealer = (table.dealer + 1) % book.balances.length;
    const game = createGame(
      state.draft.opponents.length + 1,
      table.dealer,
      table.smallBlind,
      table.bigBlind,
      book.balances,
    );
    const draft: Draft = {
      ...state.draft,
      table,
      bankroll: book,
      hero: [null, null],
      board: [],
      boardSize: 0,
      deadCards: [],
      opponents: state.draft.opponents.map((_, i) => ({
        kind: "random",
        folded: game.folded[i + 1],
      })),
      pot: "0",
      call: "0",
    };
    return { ...state, draft, game, history: [] };
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
    const book = bankrollFor(state.draft);
    if (
      (state.game?.stacks &&
        state.game.phase === "finished" &&
        !state.game.payouts) ||
      (book.hands.length && action.count !== book.balances.length)
    )
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
    if (draft.bankroll && action.count !== book.initial.length) {
      const initial = Array.from(
        { length: action.count },
        (_, i) => book.initial[i] ?? 1000,
      );
      draft.bankroll = { initial, balances: [...initial], hands: [] };
    }
    const balances = bankrollFor(draft).balances;
    if (balances[table.dealer] === 0)
      table.dealer = balances.findIndex((n) => n > 0);
    return {
      ...state,
      draft,
      game:
        state.game?.phase === "hand"
          ? createGame(
              action.count,
              table.dealer,
              table.smallBlind,
              table.bigBlind,
              balances,
            )
          : null,
      history: [],
    };
  }
  if (action.type === "record") {
    let game = action.game;
    const active = game.folded.flatMap((f, i) => (f ? [] : [i]));
    if (game.phase === "finished" && active.length === 1 && !game.payouts)
      game = settleGame(game, []);
    const draft = snapshotFromGame(game, action.draft ?? state.draft);
    if (game.stacks && game.payouts && !state.game?.payouts) {
      const book = bankrollFor(state.draft);
      const balances = game.stacks.map(
        (stack, i) => stack - game.total[i] + game.payouts![i],
      );
      draft.bankroll = {
        ...book,
        balances,
        hands: [
          ...book.hands,
          {
            number: book.hands.length + 1,
            committed: [...game.total],
            payouts: [...game.payouts],
            balances: [...balances],
          },
        ],
      };
    }
    return {
      ...state,
      draft,
      game,
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
