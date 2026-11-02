import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { AnalysisResult } from "../../api/client";
import RiverInferencePanel from "./RiverInferencePanel";

const base: NonNullable<AnalysisResult["inference"]> = {
  source: "本手行动历史",
  model_version: "history-river-response-v2",
  hand_id: "test",
  cutoff_sequence: 12,
  opponent_seat: 1,
  effective_stack: 910,
  posterior_combos: 990,
  observed_actions: 4,
  evidence: [],
  warnings: [],
  clipped_mass: 0,
};

describe("river inference explanations", () => {
  it("renders incomplete alternative scenarios without inventing EVs or stability", () => {
    const html = renderToStaticMarkup(
      <RiverInferencePanel
        inference={{
          ...base,
          sensitivity_summary: "部分情景未完成，不能判断三情景一致性",
          stable_amounts: [],
          scenarios: [
            {
              id: "baseline",
              name: "基准",
              status: "ok",
              equity: 0.5,
              check_ev: 90,
              best_ev: 100,
              best_amounts: [60],
            },
            {
              id: "tight",
              name: "偏紧",
              status: "insufficient-data",
              reasons: ["后验精度不足"],
              equity: null,
              check_ev: null,
              best_ev: null,
            },
          ],
        }}
      />,
    );
    expect(html).toContain("后验精度不足");
    expect(html).toContain("未完成");
    expect(html).toContain("100.00");
    expect(html).not.toContain("NaN");
  });
  it("keeps older saved inference results readable without new fields", () => {
    const html = renderToStaticMarkup(<RiverInferencePanel inference={base} />);
    expect(html).toContain("990");
    expect(html).not.toContain("三情景对照");
  });
});
