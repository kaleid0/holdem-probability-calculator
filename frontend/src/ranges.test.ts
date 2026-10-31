import { describe, expect, it } from "vitest";
import { expandClass, handClass, matrixLabel, serializeCombos } from "./ranges";
import {
  emptyDraft,
  exampleDraft,
  parseSaved,
  toRequest,
  validateDraft,
} from "./model";

describe("range editor contracts", () => {
  it("maps the 169 matrix cells to distinct hand classes", () => {
    const labels = Array.from({ length: 169 }, (_, i) =>
      matrixLabel(Math.floor(i / 13), i % 13),
    );
    expect(new Set(labels).size).toBe(169);
    expect(matrixLabel(0, 1)).toBe("AKs");
    expect(matrixLabel(1, 0)).toBe("AKo");
  });
  it("expands pairs and suited/offsuit classes with the API card encoding", () => {
    for (const [label, count] of [
      ["AA", 6],
      ["AKs", 4],
      ["AKo", 12],
    ] as const) {
      const pairs = expandClass(label);
      expect(pairs.length).toBe(count);
      expect(new Set(pairs.map((cards) => cards.join(","))).size).toBe(count);
      expect(pairs.every((cards) => handClass(cards) === label)).toBe(true);
    }
  });
  it("compresses full classes but preserves partial combinations and weights", () => {
    expect(
      serializeCombos(
        expandClass("AKs").map((cards) => ({ cards, weight: 0.5 })),
      ),
    ).toBe("AKs:0.5");
    expect(serializeCombos([{ cards: [44, 48], weight: 0.25 }])).toBe(
      "KsAs:0.25",
    );
  });
  it("migrates actual v1 files without changing the selected strategy", () => {
    const v1: Partial<ReturnType<typeof emptyDraft>> = { ...emptyDraft() };
    delete v1.strategyIds;
    delete v1.ruleMargin;
    const result = parseSaved(JSON.stringify({ schemaVersion: 1, draft: v1 }));
    expect(result.strategyIds).toEqual(["pot-odds"]);
    expect(result.ruleMargin).toBe(0.05);
  });
  it("saves and submits weighted ranges with per-strategy configuration", () => {
    const draft = {
      ...exampleDraft(),
      opponents: [{ kind: "range" as const, text: "AA:0.5,AKs" }],
      strategyIds: ["pot-odds", "equity-rules"],
      ruleMargin: 0.1,
    };
    expect(parseSaved(JSON.stringify({ schemaVersion: 2, draft }))).toEqual(
      draft,
    );
    const request = toRequest(draft);
    expect(request.schema_version).toBe(2);
    expect(request.opponents[0]).toEqual({ kind: "range", text: "AA:0.5,AKs" });
    expect(request.strategies?.[1].config).toEqual({ equity_margin: 0.1 });
    expect(validateDraft({ ...draft, strategyIds: [] })).toContain(
      "请至少选择一种分析策略。",
    );
    expect(
      validateDraft({
        ...draft,
        opponents: [{ kind: "range", text: "" }],
      }).join(),
    ).toContain("请填写对手范围");
  });
});
