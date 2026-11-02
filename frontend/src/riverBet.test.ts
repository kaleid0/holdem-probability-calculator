import { describe, expect, it } from "vitest";
import { emptyDraft, parseSaved, toRequest, validateDraft } from "./model";
import { defaultRiverBet, validateRiverBet } from "./riverBet";

describe("river betting configuration", () => {
  it("migrates saved scenarios without new settings", () => {
    const legacy = { ...emptyDraft() };
    delete (legacy as Partial<typeof legacy>).riverBet;
    expect(
      parseSaved(JSON.stringify({ schemaVersion: 3, draft: legacy })).riverBet,
    ).toEqual(defaultRiverBet());
  });
  it("preserves settings in files and converts percentages exactly once", () => {
    const draft = {
      ...emptyDraft(),
      strategyIds: ["river-bet"],
      riverBet: {
        mode: "manual" as const,
        effectiveStack: "500",
        checkClosesAction: true,
        bets: [{ amount: "100", foldPercent: "37.5", callingRange: "AA" }],
      },
    };
    const restored = parseSaved(JSON.stringify({ schemaVersion: 3, draft }));
    expect(restored).toEqual(draft);
    expect(toRequest(restored).strategies).toEqual([
      {
        id: "river-bet",
        config: {
          effective_stack: 500,
          check_closes_action: true,
          bets: [{ amount: 100, fold_probability: 0.375, calling_range: "AA" }],
        },
      },
    ]);
  });
  it("keeps incomplete advanced settings out of quick analysis validation", () => {
    const draft = { ...emptyDraft(), hero: [48, 49] as [number, number] };
    expect(validateDraft(draft)).toEqual([]);
    expect(
      validateDraft({
        ...draft,
        strategyIds: ["river-bet"],
        riverBet: { ...draft.riverBet, mode: "manual" },
      }).join(),
    ).toContain("有效筹码");
  });
  it("defaults to automatic and retains legacy manual fields for an override", () => {
    expect(defaultRiverBet().mode).toBe("auto");
    expect(validateRiverBet(defaultRiverBet())).toEqual([]);
    expect(
      toRequest({ ...emptyDraft(), strategyIds: ["river-bet"] }).strategies?.[0]
        .config,
    ).toEqual({ mode: "auto", preflop_prior: "" });
    const old = {
      ...emptyDraft(),
      riverBet: {
        effectiveStack: "500",
        checkClosesAction: true,
        bets: [{ amount: "50", foldPercent: "50", callingRange: "" }],
      },
    };
    expect(
      parseSaved(JSON.stringify({ schemaVersion: 3, draft: old })).riverBet
        .mode,
    ).toBeUndefined();
    expect(
      toRequest({ ...old, strategyIds: ["river-bet"] }).strategies?.[0].config,
    ).toEqual({ mode: "auto", preflop_prior: "" });
  });
  it("rejects invalid amounts and empty or out of range fold rates", () => {
    for (const amount of ["", "0", "-1", "1.5", "9007199254740992", "501"]) {
      expect(
        validateRiverBet({
          mode: "manual",
          effectiveStack: "500",
          checkClosesAction: true,
          bets: [{ amount, foldPercent: "50", callingRange: "" }],
        }).length,
      ).toBeGreaterThan(0);
    }
    for (const foldPercent of ["", "-1", "101", "Infinity"]) {
      expect(
        validateRiverBet({
          mode: "manual",
          effectiveStack: "500",
          checkClosesAction: true,
          bets: [{ amount: "100", foldPercent, callingRange: "" }],
        }).length,
      ).toBeGreaterThan(0);
    }
  });
});
