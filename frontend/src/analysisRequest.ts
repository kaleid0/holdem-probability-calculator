import { toRequest as baseRequest } from "./model";
import type { Draft } from "./model";
import type { LiveGame } from "./liveGame";
import { remainingChips } from "./liveGame";

/** Use recorded commitments only; manual snapshots never invent missing investments. */
export function toRequest(draft: Draft, game?: LiveGame | null) {
  const request = baseRequest(draft);
  if (
    !game ||
    game.phase === "hand" ||
    game.folded[0] ||
    game.total.reduce((a, b) => a + b, 0) !== Number(draft.pot) ||
    Number(draft.pot) + Number(draft.call) === 0
  )
    return request;
  const recorded = {
    ...request,
    pot_context: {
      contributions: game.total.filter((_, i) => !game.folded[i]),
      folded_contributions: game.total.filter((_, i) => game.folded[i]),
      betting_closed_after_call:
        game.phase === "betting" &&
        game.actor === 0 &&
        game.pending.every(
          (i) => i === 0 || game.folded[i] || remainingChips(game, i) === 0,
        ),
    },
  };
  if (!game.historyComplete || game.phase !== "betting") return recorded;
  const openingSeats =
    game.openingSeats ?? game.stacks?.flatMap((n, i) => (n > 0 ? [i] : []));
  if (!openingSeats) return recorded;
  return {
    ...recorded,
    strategies: request.strategies?.map((selection) =>
      (selection.id === "river-bet" && selection.config?.mode === "auto") ||
      selection.id === "history-ranges" ||
      selection.id === "postflop-tree"
        ? {
            ...selection,
            config: {
              ...selection.config,
              opponent_seats: draft.opponents.flatMap((o, i) =>
                o.folded ? [] : [i + 1],
              ),
              history_context: {
                schema_version: 1,
                hand_id: game.handId ?? "legacy-recording",
                cutoff_sequence: game.events.length,
                complete: game.historyComplete,
                count: game.count,
                opening_seats: openingSeats,
                dealer: game.dealer,
                small_blind: game.smallBlind,
                big_blind: game.bigBlind,
                stacks: game.stacks ?? null,
                events: game.events,
              },
            },
          }
        : selection,
    ),
  };
}
