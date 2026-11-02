import type { components } from "./api/generated/schema";
import type { Draft } from "./model";
import type { LiveGame } from "./liveGame";
import { validateDraft } from "./model";
import { toRequest } from "./analysisRequest";
import { parseRange } from "./ranges";

export type SensitivityRequest = components["schemas"]["SensitivityRequest"];
export type SensitivityResult = components["schemas"]["SensitivityResult"];
export type SensitivityTask = components["schemas"]["SensitivityTaskSnapshot"];
export type Scenario = components["schemas"]["SensitivityScenario"];
export const defaultScenarios: Scenario[] = [
  { id: "baseline", name: "基准", bluff_bias: 0 },
  { id: "value", name: "偏价值", bluff_bias: -1.2 },
  { id: "bluff", name: "偏诈唬", bluff_bias: 1.2 },
];

export function sensitivityRequest(
  draft: Draft,
  game: LiveGame | null,
  target: number,
  mode: "history" | "manual",
  prior: string,
  scenarios: Scenario[],
): SensitivityRequest {
  const errors = validateDraft(draft);
  if (errors.length) throw new Error(errors.join(" "));
  const opponentSeats = draft.opponents.flatMap((o, i) =>
    o.folded ? [] : [i + 1],
  );
  const targetOpponent = draft.opponents[target - 1];
  if (!opponentSeats.includes(target) || targetOpponent?.kind === "exact")
    throw new Error("请选择一名未指定明牌的在局对手。");
  const base = toRequest(draft, game);
  if (mode === "history") {
    if (!game || game.phase === "hand" || !game.historyComplete)
      throw new Error(
        "需要完整本手历史，请新开一手逐步记录，或切换手动范围比较。",
      );
    const openingSeats =
      game.openingSeats ?? game.stacks?.flatMap((n, i) => (n > 0 ? [i] : []));
    if (!openingSeats) throw new Error("旧存档缺少开局参与座位，请新开一手。");
    if (!base.pot_context)
      throw new Error("牌局投入上下文不完整，请确认当前牌面和底池。");
    if (prior.trim()) parseRange(prior);
    return {
      schema_version: 1,
      model_version: "history-rules-v1",
      mode,
      base_analysis: base,
      target_seat: target,
      opponent_seats: opponentSeats,
      preflop_prior: prior.trim() ? { kind: "range", text: prior } : null,
      scenarios,
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
    };
  }
  for (const scenario of scenarios) {
    if (!scenario.current_range?.text)
      throw new Error("请填写每个场景的当前范围。");
    parseRange(scenario.current_range.text);
  }
  return {
    schema_version: 1,
    model_version: "history-rules-v1",
    mode,
    base_analysis: base,
    target_seat: target,
    opponent_seats: opponentSeats,
    scenarios,
  };
}

export function downloadSensitivity(
  input: SensitivityRequest,
  result: SensitivityResult,
) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify({ schemaVersion: 1, input, result }, null, 2)], {
      type: "application/json",
    }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "river-lab-sensitivity.json";
  anchor.click();
  URL.revokeObjectURL(url);
}
