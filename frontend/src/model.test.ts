import { describe, expect, it } from "vitest";
import {
  cardLabel,
  emptyDraft,
  exampleDraft,
  parseSaved,
  toRequest,
  validateDraft,
} from "./model";
import { reducer } from "./state";
import { activeTask } from "./api/client";

describe("scenario contracts", () => {
  it("uses the agreed rank * 4 + suit encoding", () => {
    expect(cardLabel(48)).toBe("黑桃A");
    expect(cardLabel(1)).toBe("红桃2");
  });
  it("requires complete hero and board before creating a request", () => {
    expect(validateDraft(emptyDraft())).toContain("请选择我的两张手牌。");
    expect(validateDraft({ ...exampleDraft(), board: [40] }).join()).toContain(
      "3 张公共牌",
    );
  });
  it("rejects duplicate cards across all card groups", () => {
    expect(
      validateDraft({ ...exampleDraft(), deadCards: [48] }).join(),
    ).toContain("同一张牌");
  });
  it("rejects negative, decimal and unsafe chip amounts", () => {
    for (const pot of ["-1", "1.5", "9007199254740992", ""]) {
      expect(validateDraft({ ...exampleDraft(), pot }).length).toBeGreaterThan(
        0,
      );
    }
    expect(
      validateDraft({ ...exampleDraft(), pot: "20", call: "50" }).join(),
    ).toContain("跟注额不能大于");
  });
  it("accepts a free check but rejects insufficient unseen cards", () => {
    expect(validateDraft({ ...exampleDraft(), call: "0" })).toEqual([]);
    const draft = {
      ...exampleDraft(),
      opponents: Array.from({ length: 8 }, () => ({ kind: "random" as const })),
      deadCards: Array.from({ length: 35 }, (_, i) => i + 2),
    };
    expect(validateDraft(draft).join()).toContain("剩余牌不足");
  });
  it("serializes a valid request without frontend-only fields", () => {
    const request = toRequest(exampleDraft());
    expect(request.hero).toEqual([48, 44]);
    expect(request.settlement_assumption).toBe("futureBettingPossible");
    expect(request).not.toHaveProperty("boardSize");
  });
  it("roundtrips partial saved scenes but rejects untrusted imports", () => {
    expect(
      parseSaved(JSON.stringify({ schemaVersion: 1, draft: emptyDraft() })),
    ).toEqual(emptyDraft());
    expect(() => parseSaved('{"schemaVersion":2}')).toThrow();
    expect(() =>
      parseSaved(
        JSON.stringify({
          schemaVersion: 1,
          draft: { ...exampleDraft(), hero: [52, 44] },
        }),
      ),
    ).toThrow();
    expect(() =>
      parseSaved(
        JSON.stringify({
          schemaVersion: 1,
          draft: { ...exampleDraft(), deadCards: [48] },
        }),
      ),
    ).toThrow();
  });
  it("reducer preserves unrelated settings and supports full scene replacement", () => {
    const original = exampleDraft();
    expect(reducer(original, { type: "patch", patch: { pot: "300" } })).toEqual(
      { ...original, pot: "300" },
    );
    expect(reducer(original, { type: "replace", draft: emptyDraft() })).toEqual(
      emptyDraft(),
    );
  });
  it("only polls tasks that can still advance", () => {
    expect(activeTask("running")).toBe(true);
    expect(activeTask("cancelled")).toBe(false);
  });
});
