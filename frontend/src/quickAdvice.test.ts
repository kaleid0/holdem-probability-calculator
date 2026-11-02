import { describe, expect, it } from "vitest";
import type { AnalysisResult } from "./api/client";
import { emptyDraft } from "./model";
import { createGame, startGame } from "./liveGame";
import { quickAdvice } from "./quickAdvice";

const result = {
  equity: 0.6,
  break_even_equity: 0.25,
  call_ev: 70,
  equity_standard_error: 0.004,
} as AnalysisResult;
const draft = { ...emptyDraft(), call: "50", futureBetting: false };
describe("quick decision guidance", () => {
  it("distinguishes a future betting reference from a closed decision", () => {
    expect(quickAdvice(draft, result)?.title).toBe("倾向跟注 50");
    expect(quickAdvice({ ...draft, futureBetting: true }, result)?.title).toBe(
      "摊牌参考：跟注 50",
    );
    expect(
      quickAdvice(draft, { ...result, equity: 0.1, call_ev: -30 })?.title,
    ).toBe("倾向弃牌");
  });
  it("does not turn sampling noise or an exact tie into a firm decision", () => {
    expect(
      quickAdvice(draft, { ...result, equity: 0.253, call_ev: 0.6 })?.title,
    ).toContain("临界");
    expect(
      quickAdvice(draft, {
        ...result,
        equity: 0.25,
        call_ev: 0,
        equity_standard_error: 0,
      })?.title,
    ).toContain("临界");
  });
  it("withholds advice with missing EV, another actor or no current result", () => {
    expect(quickAdvice(draft, { ...result, call_ev: null })?.title).toContain(
      "暂不给",
    );
    expect(
      quickAdvice(draft, result, { ...startGame(createGame()), actor: 1 })
        ?.title,
    ).toBe("等待你的行动");
    expect(quickAdvice(draft)).toBeNull();
    expect(quickAdvice({ ...draft, call: "0" }, result)?.title).toBe(
      "当前无需跟注",
    );
  });
  it("requires three completed scenarios to call a river recommendation stable", () => {
    const scenarios = ["baseline", "tight", "loose"].map((id) => ({
      id,
      status: "ok",
      best_amounts: [60],
    }));
    const river = {
      ...result,
      recommendation: "下注 60",
      inference: { stable_amounts: [60], scenarios },
    } as unknown as AnalysisResult;
    expect(quickAdvice(draft, result, null, river)?.stability).toContain(
      "均为最优",
    );
    expect(quickAdvice(draft, result, null, river)?.title).toBe("下注 60");
    river.inference!.scenarios![2].status = "insufficient-data";
    expect(quickAdvice(draft, result, null, river)?.stability).toContain(
      "情景不足",
    );
    river.inference!.scenarios![2].status = "ok";
    river.inference!.stable_amounts = [];
    expect(quickAdvice(draft, result, null, river)?.stability).toContain(
      "敏感",
    );
  });
  it("explains open action and future betting separately from tree support", () => {
    const game = {
      ...createGame(3, 0, 5, 10, [500, 500, 500]),
      phase: "betting" as const,
      actor: 0,
      total: [50, 100, 100],
      pending: [0, 2],
    };
    const scene = { ...draft, pot: "250", futureBetting: true };
    const missing = { ...result, call_ev: null };
    const advice = quickAdvice(scene, missing, game)!;
    expect(advice.reason).toContain("尚不能闭合当前街");
    expect(advice.reason).toContain("允许后续下注");
    expect(advice.reason).toContain("不代表应该跟注或弃牌");
    expect(advice.reason).not.toContain("单挑");
    const closed = quickAdvice({ ...scene, futureBetting: false }, missing, {
      ...game,
      pending: [0],
    })!;
    expect(closed.reason).not.toContain("尚不能闭合");
    expect(closed.reason).not.toContain("允许后续下注");
    expect(closed.reason).toContain("未返回完整");
  });
  it("identifies mismatched recorded investments without inventing a call EV", () => {
    const advice = quickAdvice(
      { ...draft, pot: "999" },
      { ...result, call_ev: null },
      { ...startGame(createGame()), actor: 0 },
    )!;
    expect(advice.reason).toContain("累计投入记录不一致");
    expect(advice.title).toBe("暂不给跟注结论");
  });
});
