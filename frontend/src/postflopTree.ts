import type { Draft } from "./model";
import type { LiveGame } from "./liveGame";

export function postflopReady(draft: Draft, game?: LiveGame | null): boolean {
  return (
    !!game &&
    [3, 4].includes(draft.boardSize) &&
    draft.board.length === draft.boardSize &&
    game.street === draft.boardSize &&
    game.count === 2 &&
    game.dealer === 0 &&
    game.historyComplete &&
    !!game.stacks &&
    game.phase === "betting" &&
    game.actor === 0 &&
    game.pending.length === 1 &&
    game.pending[0] === 0 &&
    game.folded.every((f) => !f) &&
    draft.opponents.length === 1 &&
    !draft.opponents[0].folded &&
    game.total[0] + Number(draft.call) === game.total[1] &&
    game.total.reduce((a, b) => a + b, 0) === Number(draft.pot)
  );
}
