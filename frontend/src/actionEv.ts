import type { AnalysisResult } from "./api/client";
import type { Draft } from "./model";
import { canRaise, remainingChips, type LiveGame } from "./liveGame";

export type ResponseModel = { fold: number; raise: number; probe: number };
export const defaultResponse: ResponseModel = {
  fold: 0.25,
  raise: 0.08,
  probe: 0.35,
};
export type EvRow = {
  label: string;
  additional: number;
  values: number[];
  errors: number[];
};
export type ActionEv = {
  reason?: string;
  rows: EvRow[];
  scenarios: {
    name: string;
    equity: number;
    fold: number;
    raise: number;
    probe: number;
  }[];
  best: string[];
  stable: string[];
};
const clamp = (n: number) => Math.max(0, Math.min(1, n));

/** Net chips from this decision. One opponent response + at most one half-pot probe.
 * Responses are independent of holdings; this is a transparent scenario model,
 * not a conditional-range solver. Prior commitments are sunk costs.
 */
export function actionEv(
  draft: Draft,
  result: AnalysisResult | undefined,
  game: LiveGame | null | undefined,
  model = defaultResponse,
): ActionEv {
  const empty = (reason: string): ActionEv => ({
    reason,
    rows: [],
    scenarios: [],
    best: [],
    stable: [],
  });
  if (!game || game.phase !== "betting" || game.actor !== 0 || game.folded[0])
    return empty("轮到你行动时比较候选 EV。");
  if (
    !game.historyComplete ||
    !game.stacks ||
    game.count !== draft.opponents.length + 1 ||
    game.folded.some(
      (f, i) => i > 0 && f !== !!draft.opponents[i - 1]?.folded,
    ) ||
    game.street !== draft.boardSize ||
    draft.board.length !== draft.boardSize ||
    game.total.reduce((a, b) => a + b, 0) !== Number(draft.pot)
  )
    return empty("牌面、玩家、筹码或完整行动记录不一致，暂不估算行动 EV。");
  const active = game.folded.flatMap((f, i) => (!f && i !== 0 ? [i] : []));
  if (active.length !== 1)
    return empty("当前行动模型仅支持单挑；多人请参考已支持的直接摊牌跟注 EV。");
  const seat = active[0];
  const hero = remainingChips(game, 0),
    villain = remainingChips(game, seat);
  const call = Number(draft.call),
    pot = Number(draft.pot);
  if (
    !Number.isSafeInteger(pot) ||
    pot <= 0 ||
    !Number.isSafeInteger(call) ||
    call < 0 ||
    hero <= 0 ||
    call !== Math.min(game.highest - game.paid[0], hero)
  )
    return empty("底池或跟注金额与当前行动不一致。");
  if (
    game.total[0] + call !== game.total[seat] ||
    game.total.some((n, i) => game.folded[i] && n > game.total[0] + call)
  )
    return empty("存在边池或未匹配投入，暂不套用单挑行动模型。");
  if (
    ![model.fold, model.raise, model.probe].every(
      (n) => Number.isFinite(n) && n >= 0 && n <= 1,
    ) ||
    model.fold + model.raise > 1
  )
    return empty("弃牌率与再加注率之和不能超过 100%。");
  const equity = result?.equity;
  if (equity == null || !Number.isFinite(equity) || equity < 0 || equity > 1)
    return empty("等待当前牌局权益计算完成。");
  const error = result?.equity_standard_error;
  // No fabricated zero error when the source does not provide sampling uncertainty.
  const se =
    error != null && Number.isFinite(error) && error >= 0 ? error : 0.03;
  const shift = Math.max(0.08, 1.96 * se);
  const scenarios = [
    { name: "基准", equity, ...model },
    {
      name: "不利假设",
      equity: clamp(equity - shift),
      fold: model.fold * 0.5,
      raise: Math.min(1 - model.fold * 0.5, model.raise * 1.5),
      probe: clamp(model.probe + 0.15),
    },
    {
      name: "有利假设",
      equity: clamp(equity + shift),
      fold: clamp(model.fold + 0.15),
      raise: Math.min(1 - clamp(model.fold + 0.15), model.raise * 0.5),
      probe: clamp(model.probe - 0.15),
    },
  ];
  const future = draft.futureBetting && game.street !== 5;
  // Opponent may probe half pot, hero chooses call or fold; otherwise check down.
  const continuation = (
    p: number,
    h: number,
    v: number,
    e: number,
    probe: number,
  ) => {
    const b = Math.min(Math.ceil(p / 2), h, v);
    if (!future || b <= 0) return e * p;
    return (1 - probe) * e * p + probe * Math.max(0, e * (p + 2 * b) - b);
  };
  const rows: EvRow[] = [];
  const add = (
    label: string,
    additional: number,
    evaluate: (s: (typeof scenarios)[number], e: number) => number,
  ) => {
    rows.push({
      label,
      additional,
      values: scenarios.map((s) => evaluate(s, s.equity)),
      errors: scenarios.map((s) =>
        Math.max(
          Math.abs(
            evaluate(s, clamp(s.equity + 1.96 * se)) - evaluate(s, s.equity),
          ),
          Math.abs(
            evaluate(s, clamp(s.equity - 1.96 * se)) - evaluate(s, s.equity),
          ),
        ),
      ),
    });
  };
  if (call > 0) add("弃牌", 0, () => 0);
  add(
    call > 0 ? `跟注 ${call}` : "过牌",
    call,
    (s, e) => continuation(pot + call, hero - call, villain, e, s.probe) - call,
  );
  const min = game.highest + game.minRaise;
  const max = Math.min(game.paid[0] + hero, game.paid[seat] + villain);
  if (canRaise(game) && villain > 0) {
    const targets = [
      ...new Set(
        [0.5, 1, 2]
          .map((fraction) =>
            Math.min(
              max,
              Math.max(min, game.highest + Math.ceil((pot + call) * fraction)),
            ),
          )
          .concat(max),
      ),
    ].sort((a, b) => a - b);
    for (const target of targets) {
      if (
        target <= game.highest ||
        (target < min && target !== game.paid[0] + hero)
      )
        continue;
      const h = target - game.paid[0],
        v = target - game.paid[seat];
      if (!Number.isSafeInteger(target) || h <= call || v < 0) continue;
      add(`${call > 0 ? "加注至" : "下注至"} ${target}`, h, (s, e) => {
        const r = hero === h || villain === v ? 0 : s.raise;
        return (
          s.fold * pot -
          r * h +
          (1 - s.fold - r) *
            (continuation(pot + h + v, hero - h, villain - v, e, s.probe) - h)
        );
      });
    }
  }
  // Keep candidates within a conservative sampling tolerance, not an exact argmax.
  const bestByScenario = scenarios.map((_, i) => {
    const top = rows.reduce((a, b) => (b.values[i] > a.values[i] ? b : a));
    return rows
      .filter(
        (row) =>
          top.values[i] - row.values[i] <= top.errors[i] + row.errors[i] + 1e-9,
      )
      .map((row) => row.label);
  });
  return {
    rows,
    scenarios,
    best: bestByScenario[0],
    stable: bestByScenario[0].filter((label) =>
      bestByScenario.every((best) => best.includes(label)),
    ),
  };
}
