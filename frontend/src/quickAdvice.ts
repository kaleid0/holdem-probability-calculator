import type { AnalysisResult } from "./api/client";
import type { Draft } from "./model";
import type { LiveGame } from "./liveGame";
import { toRequest } from "./analysisRequest";

export type QuickAdvice = { title: string; reason: string; stability: string };
const label = (amount: number) => (amount === 0 ? "过牌" : `下注 ${amount}`);

/** Translate evaluated facts; never infer a future-street bet from equity alone. */
export function quickAdvice(
  draft: Draft,
  result?: AnalysisResult,
  game?: LiveGame | null,
  river?: AnalysisResult,
): QuickAdvice | null {
  if (!result) return null;
  if (game && (game.phase !== "betting" || game.actor !== 0))
    return {
      title: "等待你的行动",
      reason: "当前展示牌局权益；轮到你时再给行动建议。",
      stability: "尚未评估",
    };
  if (river) {
    const inference = river.inference;
    const scenarios = inference?.scenarios ?? [];
    const complete =
      scenarios.length === 3 && scenarios.every((s) => s.status === "ok");
    const stable = complete ? (inference?.stable_amounts ?? []) : [];
    const baseline = scenarios.find((s) => s.id === "baseline") ?? scenarios[0];
    return {
      title:
        (stable.length ? stable : (baseline?.best_amounts ?? []))
          .map(label)
          .join(" / ") || "查看河牌比较",
      reason:
        river.recommendation ?? "根据本手行动历史与响应模型比较候选金额。",
      stability: !complete
        ? "情景不足，暂不能判断稳定性"
        : stable.length
          ? "三种假设下均为最优候选"
          : "对对手假设敏感",
    };
  }
  if (Number(draft.call) === 0)
    return {
      title: "当前无需跟注",
      reason: "权益不能单独决定是否下注。",
      stability: "尚未比较下注动作",
    };
  if (
    result.call_ev == null ||
    result.equity == null ||
    result.break_even_equity == null
  ) {
    const reasons: string[] = [];
    const context = toRequest(draft, game).pot_context;
    if (game && !context)
      reasons.push(
        "当前底池与累计投入记录不一致或记录不可用，无法可靠拆分主池和边池。",
      );
    if (context && !context.betting_closed_after_call)
      reasons.push(
        "本次跟注尚不能闭合当前街，其他玩家仍可行动，可能改变跟注成本和底池。",
      );
    if (draft.futureBetting)
      reasons.push("当前允许后续下注，尚未计算未来投入与弃牌的影响。");
    if (result.pots?.some((pot) => pot.is_refund && pot.eligible.includes(0)))
      reasons.push(
        "存在退回给你的未跟注筹码，当前模型尚不支持此情形的跟注 EV。",
      );
    return {
      title: "暂不给跟注结论",
      reason:
        (reasons.join("") ||
          "当前未返回完整的跟注 EV 与权益门槛，请检查分析结果及底池设置。") +
        "当前权益仅供参考，不代表应该跟注或弃牌。",
      stability: "跟注 EV 暂不可用",
    };
  }
  const gap = result.equity - result.break_even_equity;
  const error = result.equity_standard_error;
  const marginal =
    Math.abs(result.call_ev) < 1e-9 ||
    (error != null && Math.abs(gap) <= 1.96 * error);
  return {
    title: marginal
      ? "接近临界，暂不下结论"
      : `${draft.futureBetting ? "摊牌参考：" : "倾向"}${result.call_ev > 0 ? `跟注 ${draft.call}` : "弃牌"}`,
    reason:
      `权益 ${(result.equity * 100).toFixed(1)}%，跟注门槛 ${(result.break_even_equity * 100).toFixed(1)}%。` +
      (draft.futureBetting
        ? "后续仍可下注，尚未计入未来投入。"
        : "按跟注后无后续投入计算。"),
    stability: marginal
      ? "差距接近抽样误差，可用精细分析复核"
      : "仅基于当前范围，未检验范围稳定性",
  };
}
