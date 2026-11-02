import type { AnalysisResult } from "./api/client";
import type { Draft } from "./model";
import { remainingChips, type LiveGame } from "./liveGame";
import type { QuickAdvice } from "./quickAdvice";

/** Conservative fallback, never presented as an evaluated action EV. */
export function continuationAdvice(
  draft: Draft,
  result?: AnalysisResult,
  game?: LiveGame | null,
): QuickAdvice | null {
  if (
    !game ||
    game.phase !== "betting" ||
    game.actor !== 0 ||
    game.folded[0] ||
    !game.historyComplete ||
    !game.stacks ||
    game.street !== draft.boardSize ||
    draft.board.length !== draft.boardSize ||
    draft.hero.some((c) => c == null) ||
    game.total.reduce((a, b) => a + b, 0) !== Number(draft.pot) ||
    Math.min(game.highest - game.paid[0], remainingChips(game, 0)) !==
      Number(draft.call) ||
    remainingChips(game, 0) <= 0
  )
    return null;
  const answer = (title: string, reason: string): QuickAdvice => ({
    title,
    reason,
    stability: "后续行动启发式 v1；未计算完整行动 EV，非 GTO",
  });
  const due = Number(draft.call);
  if (due === 0)
    return answer(
      "倾向过牌（保守参考）",
      "当前可免费继续，默认过牌控制投入；尚未比较价值下注与诈唬收益，不能据此排除下注。支持的局面会由行动树或河牌比较替换此参考。",
    );
  const equity = result?.equity;
  if (equity == null || !Number.isFinite(equity) || equity < 0 || equity > 1)
    return null;
  // A single pot-odds threshold is invalid when hero cannot contest the whole pot.
  if (
    game.folded.some(
      (folded, i) =>
        !folded &&
        i !== 0 &&
        (game.total[i] > game.total[0] + due || remainingChips(game, i) === 0),
    ) ||
    due === remainingChips(game, 0)
  )
    return answer(
      "全下或边池局面，需复核",
      "本局面不能用整个底池的单一权益门槛决定跟注，请查看主池、边池与可争夺权益；未计算完整行动 EV。",
    );
  const threshold = due / (Number(draft.pot) + due);
  const open = game.pending.some(
    (i) => i !== 0 && !game.folded[i] && remainingChips(game, i) > 0,
  );
  const opponents = game.folded.filter((f, i) => i !== 0 && !f).length;
  const reserve =
    (draft.futureBetting ? 0.08 : 0) +
    (open ? 0.05 : 0) +
    (opponents > 1 ? 0.04 : 0);
  const error = result?.equity_standard_error;
  const noise =
    error != null && Number.isFinite(error) && error >= 0 ? 1.96 * error : 0.03;
  const gap = equity - threshold - reserve;
  return answer(
    Math.abs(gap) <= noise
      ? "接近启发式门槛，需复核"
      : gap > 0
        ? `倾向跟注 ${due}（启发式）`
        : "倾向弃牌（启发式）",
    `当前范围权益 ${(equity * 100).toFixed(1)}%，直接底池赔率门槛 ${(threshold * 100).toFixed(1)}%；另加 ${(reserve * 100).toFixed(0)} 个百分点的保守余量（后续下注、未闭合行动及多人因素）。` +
      "余量是项目规则，并非计算出的未来损失；未比较加注、隐含赔率或未来弃牌收益，可能放弃有利跟注。",
  );
}
