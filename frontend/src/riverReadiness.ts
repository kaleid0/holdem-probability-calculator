import type { Draft } from "./model";
import type { LiveGame } from "./liveGame";
import { remainingChips } from "./liveGame";

/** Preview only: the server independently replays the complete history before inference. */
export function riverReadiness(draft: Draft, game?: LiveGame | null) {
  const reasons: string[] = [];
  const active = draft.opponents.flatMap((o, i) => (o.folded ? [] : [i + 1]));
  if (draft.board.length !== 5 || draft.boardSize !== 5)
    reasons.push("请先补齐五张河牌公共牌。");
  if (active.length !== 1) reasons.push("当前需为单挑，只能有一名在局对手。");
  if (Number(draft.call) > 0)
    reasons.push("当前需要跟注；本策略比较无需跟注时的过牌与主动下注。");
  if (Number(draft.pot) <= 0) reasons.push("当前底池须大于零。");
  let effectiveStack: number | null = null;
  if (!game || !game.historyComplete || game.events.length < 2) {
    reasons.push("当前缺少完整本手记录；请使用逐步记录模式，或切换手动配置。");
  } else {
    if (game.street !== 5)
      reasons.push("录入牌面与记录街道不一致，请先在逐步记录中发到河牌。");
    if (
      game.count !== draft.opponents.length + 1 ||
      active.some((seat) => game.folded[seat])
    )
      reasons.push("在局玩家与行动记录不一致，请恢复记录中的牌局。");
    if (game.phase !== "betting")
      reasons.push("当前尚未进入可行动阶段，或本手已经结束。");
    if (game.folded[0]) reasons.push("你已弃牌，无法继续进行下注分析。");
    if (game.actor !== 0 || game.pending.length !== 1 || game.pending[0] !== 0)
      reasons.push("请等到对手已过牌、由你最后行动时分析。");
    if (game.total.reduce((sum, n) => sum + n, 0) !== Number(draft.pot))
      reasons.push("底池录入与行动记录不一致，请恢复记录中的牌局。");
    if (!game.stacks) reasons.push("旧记录缺少开局筹码，请新开一手完整记录。");
    else if (active.length === 1) {
      effectiveStack = Math.min(
        remainingChips(game, 0),
        remainingChips(game, active[0]),
      );
      if (effectiveStack <= 0)
        reasons.push("有效剩余筹码为零，没有可比较的下注动作。");
      if (game.total[0] !== game.total[active[0]])
        reasons.push("当前投入未匹配或存在边池。");
    }
  }
  return { ready: reasons.length === 0, reasons, effectiveStack };
}
