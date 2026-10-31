import { describe, expect, it } from "vitest";
import {
  buildWidth,
  categoryOf,
  handClass,
  parseRange,
  rangeStats,
  serializeCombos,
} from "./ranges";

describe("instant range preview and sliders", () => {
  it("matches the supported backend grammar without a network request", () => {
    for (const [text, count] of [
      ["AA", 6],
      ["AKs", 4],
      ["AKo", 12],
      ["AK", 16],
      ["TT+", 30],
      ["AJs+", 12],
      ["AA-TT", 30],
      ["AJs-AKs", 12],
    ] as const)
      expect(parseRange(text)).toHaveLength(count);
    expect(
      parseRange("AKs:0.2,AKs:0.7,AsKs:0.9")
        .map((c) => c.weight)
        .sort(),
    ).toEqual([0.7, 0.7, 0.7, 0.9]);
    const stats = rangeStats(parseRange("AA,AKs"), [48, 44]);
    expect(stats.total).toBe(10);
    expect(stats.effective).toBe(6);
    for (const text of [
      "bad",
      "KA",
      "AAs",
      "AKs-KQs",
      "AA:0",
      "AsAs",
      "AA:NaN",
      "AA:0x1",
      "AA:",
      "AA:0.0000001",
    ])
      expect(() => parseRange(text)).toThrow();
    expect(parseRange("")).toEqual([]);
  });
  it("expands width monotonically and covers all 1326 combinations at 100%", () => {
    let previous = new Set<string>();
    for (const percent of [0, 5, 15, 30, 50, 100]) {
      const combos = buildWidth(percent);
      const current = new Set(combos.map((c) => c.cards.join(",")));
      expect([...previous].every((key) => current.has(key))).toBe(true);
      expect(combos.length).toBeGreaterThanOrEqual((1326 * percent) / 100);
      expect(combos.length).toBeLessThan((1326 * percent) / 100 + 12);
      previous = current;
    }
    expect(previous.size).toBe(1326);
  });
  it("category sliders stay within category and preserve text roundtrips", () => {
    for (const [category, count] of [
      ["pair", 78],
      ["suited", 312],
      ["offsuit", 936],
    ] as const) {
      const combos = buildWidth(100, category);
      expect(combos).toHaveLength(count);
      expect(
        combos.every((c) => categoryOf(handClass(c.cards)) === category),
      ).toBe(true);
      expect(parseRange(serializeCombos(combos))).toHaveLength(count);
    }
    expect(
      rangeStats(
        buildWidth(100).map((c) => ({ ...c, weight: 0.5 })),
        [],
      ).weightedCoverage,
    ).toBe(50);
  });
});
