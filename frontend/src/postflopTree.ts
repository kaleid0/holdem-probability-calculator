import type { Draft } from "./model";
import type { LiveGame } from "./liveGame";
import type { AnalysisResult } from "./api/client";
import type { QuickAdvice } from "./quickAdvice";

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

export function treeAdvice(
  result?: Pick<AnalysisResult, "limited_tree" | "candidates">,
): QuickAdvice | null {
  const tree = result?.limited_tree;
  if (!tree || !result) return null;
  return {
    title:
      result.candidates?.length === 1
        ? "当前仅评估过牌，未比较下注"
        : tree.marginal
          ? "候选收益接近，暂不下结论"
          : `有限树倾向${tree.scenarios.find((s) => s.id === "baseline")?.best_actions.join(" / ") ?? "查看动作比较"}`,
    reason:
      "比较当前行动与下一街固定应对，后续其余街无下注；不含当前加注或对手再加注。",
    stability: tree.stable_actions.length
      ? "三种模型假设下最优候选一致"
      : "建议对对手假设敏感",
  };
}
