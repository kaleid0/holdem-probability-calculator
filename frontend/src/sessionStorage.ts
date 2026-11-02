import { z } from "zod";
import { draftSchema, emptyDraft, parseSaved, usedCards } from "./model";
import type { Session } from "./session";
import { handEventSchema } from "./handHistory";

export const sessionStorageKey = "holdem-lab:session:v1";
const legacyKeys = [
  "holdem-lab:scenario:v3",
  "holdem-lab:scenario:v2",
  "holdem-lab:scenario:v1",
];
const chips = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const seat = z.number().int().min(0).max(8);
const gameSchema = z
  .object({
    handId: z.string().max(100).optional(),
    openingSeats: z.array(seat).min(2).max(9).optional(),
    count: z.number().int().min(2).max(9),
    dealer: seat,
    smallBlind: chips.positive(),
    bigBlind: chips.positive(),
    street: z.union([z.literal(0), z.literal(3), z.literal(4), z.literal(5)]),
    phase: z.enum(["hand", "betting", "deal", "finished"]),
    actor: seat,
    folded: z.array(z.boolean()),
    paid: z.array(chips),
    total: z.array(chips),
    stacks: z.array(chips).optional(),
    payouts: z.array(chips).optional(),
    actedAt: z.array(chips.nullable()).optional(),
    pending: z.array(seat),
    highest: chips,
    minRaise: chips.positive(),
    events: z.array(handEventSchema).default([]),
    historyComplete: z.boolean().default(false),
    log: z.array(z.string()),
  })
  .refine(
    (g) =>
      g.dealer < g.count &&
      g.actor < g.count &&
      [g.folded, g.paid, g.total].every(
        (values) => values.length === g.count,
      ) &&
      g.pending.every((i) => i < g.count && !g.folded[i]) &&
      g.paid.every((value, i) => value <= g.total[i]) &&
      (!g.stacks ||
        (g.stacks.length === g.count &&
          g.total.every((n, i) => n <= g.stacks![i]))) &&
      (!g.actedAt || g.actedAt.length === g.count) &&
      (!g.payouts ||
        (g.phase === "finished" &&
          g.payouts.length === g.count &&
          g.payouts.reduce((a, b) => a + b, 0) ===
            g.total.reduce((a, b) => a + b, 0))) &&
      (g.highest === Math.max(...g.paid) ||
        (g.street === 0 &&
          g.highest === g.bigBlind &&
          g.highest >= Math.max(...g.paid))) &&
      g.events.every(
        (event, index) =>
          event.sequence === index + 1 &&
          (event.kind !== "action" ||
            (event.player < g.count &&
              event.potAfter === event.potBefore + event.amount)) &&
          (event.kind !== "handEnd" ||
            event.winner === null ||
            event.winner < g.count),
      ) &&
      g.bigBlind >= g.smallBlind &&
      (g.phase !== "betting" || g.pending.includes(g.actor)),
  );
const snapshotSchema = z
  .object({
    draft: draftSchema,
    game: gameSchema.nullable(),
  })
  .refine(({ draft, game }) => {
    const cards = usedCards(draft);
    return (
      new Set(cards).size === cards.length &&
      draft.board.length <= draft.boardSize &&
      (!game || game.count === draft.opponents.length + 1) &&
      (!draft.bankroll ||
        draft.bankroll.initial.length === draft.opponents.length + 1)
    );
  });
const savedSessionSchema = z.object({
  schemaVersion: z.literal(1),
  session: snapshotSchema.safeExtend({
    mode: z.enum(["snapshot", "live"]),
    history: z.array(snapshotSchema),
  }),
});

export function loadSession(storage: Pick<Storage, "getItem">): Session {
  const initial: Session = {
    draft: emptyDraft(),
    game: null,
    history: [],
    mode: "snapshot",
  };
  try {
    const saved = storage.getItem(sessionStorageKey);
    if (saved) {
      const raw = JSON.parse(saved);
      const parsed = savedSessionSchema.safeParse(raw);
      if (parsed.success) return parsed.data.session;
      // A damaged recording must not prevent recovery of valid cards and settings.
      try {
        return {
          ...initial,
          draft: parseSaved(
            JSON.stringify({
              schemaVersion: 3,
              draft: raw?.session?.draft,
            }),
          ),
        };
      } catch {
        /* Try the legacy backup below. */
      }
    }
  } catch {
    /* Storage may be unavailable or contain invalid JSON. */
  }
  for (const key of legacyKeys) {
    try {
      const saved = storage.getItem(key);
      if (saved) return { ...initial, draft: parseSaved(saved) };
    } catch {
      /* Try the next compatible saved scene. */
    }
  }
  return initial;
}

export function saveSession(
  storage: Pick<Storage, "setItem">,
  session: Session,
): void {
  try {
    storage.setItem(
      sessionStorageKey,
      JSON.stringify({ schemaVersion: 1, session }),
    );
  } catch {
    /* The current session remains usable when storage is unavailable. */
  }
  try {
    storage.setItem(
      legacyKeys[0],
      JSON.stringify({ schemaVersion: 3, draft: session.draft }),
    );
  } catch {
    /* Keep the compatibility backup best effort. */
  }
}
