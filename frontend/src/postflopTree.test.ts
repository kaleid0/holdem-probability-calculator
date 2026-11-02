import { describe, expect, it } from "vitest";
import { createGame, startGame } from "./liveGame";
import { emptyDraft } from "./model";
import type { AnalysisResult } from "./api/client";
import { postflopReady, treeAdvice } from "./postflopTree";

const game = {
  ...startGame(createGame(2, 0, 5, 10, [1000, 1000])),
  street: 3 as const,
  pending: [0],
  actor: 0,
  paid: [0, 0],
  total: [10, 10],
};
const draft = {
  ...emptyDraft(),
  hero: [48, 49] as [number, number],
  boardSize: 3 as const,
  board: [4, 9, 14],
  pot: "20",
  call: "0",
};

describe("limited tree readiness and advice", () => {
  it("only starts on the recorded in-position heads-up decision", () => {
    expect(postflopReady(draft, game)).toBe(true);
    expect(postflopReady(draft)).toBe(false);
    expect(postflopReady(draft, { ...game, dealer: 1 })).toBe(false);
    expect(postflopReady(draft, { ...game, pending: [0, 1] })).toBe(false);
    expect(postflopReady(draft, { ...game, historyComplete: false })).toBe(
      false,
    );
    expect(postflopReady({ ...draft, call: "5" }, game)).toBe(false);
    expect(postflopReady({ ...draft, board: [] }, game)).toBe(false);
  });
  it("withholds a firm recommendation when paired errors overlap the best two actions", () => {
    const result: Pick<AnalysisResult, "limited_tree" | "candidates"> = {
      limited_tree: {
        horizon: "测试有限树",
        sample_count_per_scenario: 1000,
        elapsed_ms: 1,
        marginal: true,
        stable_actions: [],
        scenarios: [
          { id: "baseline", name: "基准", best_actions: ["下注 10"] },
        ],
      },
    };
    expect(treeAdvice(result)?.title).toContain("暂不下结论");
    expect(treeAdvice(result)?.stability).toContain("敏感");
    result.limited_tree!.marginal = false;
    result.limited_tree!.stable_actions = ["下注 10"];
    expect(treeAdvice(result)?.title).toBe("有限树倾向下注 10");
    expect(treeAdvice(result)?.stability).toContain("一致");
    expect(treeAdvice()).toBeNull();
  });
});
