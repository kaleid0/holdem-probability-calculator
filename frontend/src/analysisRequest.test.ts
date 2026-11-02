import { describe, expect, it } from "vitest";
import { toRequest } from "./analysisRequest";
import { exampleDraft } from "./model";
import { createGame } from "./liveGame";
import { defaultRiverBet } from "./riverBet";

function setup() {
  const draft = {
    ...exampleDraft(),
    opponents: [
      { kind: "random" as const },
      { kind: "random" as const },
      {
        kind: "exact" as const,
        cards: [2, 3] as [number, number],
        folded: true,
      },
    ],
    pot: "450",
    call: "100",
  };
  const game = {
    ...createGame(4, 0, 5, 10, [200, 100, 200, 100]),
    phase: "betting" as const,
    actor: 0,
    total: [100, 100, 200, 50],
    paid: [100, 100, 200, 50],
    highest: 200,
    pending: [0],
    folded: [false, false, false, true],
  };
  return { draft, game };
}

describe("recorded pot analysis", () => {
  it("maps active commitments and folded money without losing known dead cards", () => {
    const { draft, game } = setup();
    const result = toRequest(draft, game);
    expect(result.pot_context).toEqual({
      contributions: [100, 100, 200],
      folded_contributions: [50],
      betting_closed_after_call: true,
    });
    expect(result.dead_cards).toEqual([2, 3]);
    expect(result.opponents).toHaveLength(2);
  });
  it("does not enable call EV when another funded player is pending or hero is not acting", () => {
    const { draft, game } = setup();
    game.stacks = [200, 300, 400, 100];
    game.pending = [0, 1];
    expect(toRequest(draft, game).pot_context?.betting_closed_after_call).toBe(
      false,
    );
    game.pending = [0];
    game.actor = 1;
    expect(toRequest(draft, game).pot_context?.betting_closed_after_call).toBe(
      false,
    );
  });
  it("does not invent commitments for manual or mismatched snapshots", () => {
    const { draft, game } = setup();
    expect(toRequest(draft).pot_context).toBeUndefined();
    expect(
      toRequest({ ...draft, pot: "999" }, game).pot_context,
    ).toBeUndefined();
  });
  it("makes contributions and eligibility part of result staleness identity", () => {
    const { draft, game } = setup();
    const original = JSON.stringify(toRequest(draft, game));
    game.total = [150, 50, 200, 50];
    expect(JSON.stringify(toRequest(draft, game))).not.toBe(original);
  });
  it("attaches history only to automatic river analysis", () => {
    const { draft, game } = setup();
    const scene = {
      ...draft,
      strategyIds: ["pot-odds", "river-bet"],
      riverBet: defaultRiverBet(),
    };
    const result = toRequest(scene, game);
    expect(result.strategies?.[0].config).toEqual({});
    expect(result.strategies?.[1].config).toMatchObject({
      mode: "auto",
      opponent_seats: [1, 2],
      history_context: {
        cutoff_sequence: game.events.length,
        stacks: game.stacks,
        events: game.events,
      },
    });
    expect(
      toRequest({ ...scene, strategyIds: ["pot-odds"] }, game).strategies?.[0]
        .config,
    ).toEqual({});
    expect(toRequest(scene).strategies?.[1].config).not.toHaveProperty(
      "history_context",
    );
    expect(
      toRequest(scene, { ...game, historyComplete: false }).strategies?.[1]
        .config,
    ).not.toHaveProperty("history_context");
  });
});
