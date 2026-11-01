import type { HandEvent, PlayerAction, Street } from "./handHistory";
export {
  gameLog,
  playerActions,
  actionsByPlayer,
  seatName,
  streetName,
} from "./handHistory";
export type { Street, HandEvent, PlayerAction } from "./handHistory";
export type LiveGame = {
  count: number;
  dealer: number;
  smallBlind: number;
  bigBlind: number;
  street: Street;
  phase: "hand" | "betting" | "deal" | "finished";
  actor: number;
  folded: boolean[];
  paid: number[];
  total: number[];
  pending: number[];
  highest: number;
  minRaise: number;
  events: HandEvent[];
  historyComplete: boolean;
  /** Missing in legacy recordings, which had no chip limits. */
  stacks?: number[];
  payouts?: number[];
  actedAt?: (number | null)[];
  /** Legacy text prefix only. New records are stored in events. */
  log: string[];
};
export function createGame(
  count = 3,
  dealer = 0,
  smallBlind = 5,
  bigBlind = 10,
  stacks?: number[],
): LiveGame {
  return {
    count,
    dealer,
    smallBlind,
    bigBlind,
    street: 0,
    phase: "hand",
    actor: 0,
    folded: Array.from({ length: count }, (_, i) => stacks?.[i] === 0),
    paid: Array(count).fill(0),
    total: Array(count).fill(0),
    pending: [],
    highest: 0,
    minRaise: bigBlind,
    events: [],
    historyComplete: true,
    log: [],
    ...(stacks ? { stacks: [...stacks] } : {}),
  };
}
const next = (game: LiveGame, after: number, eligible: number[]) => {
  for (let offset = 1; offset <= game.count; offset++) {
    const seat = (after + offset) % game.count;
    if (eligible.includes(seat)) return seat;
  }
  return after;
};
export function startGame(game: LiveGame): LiveGame {
  if (game.phase !== "hand") return game;
  const seated = game.folded.flatMap((f, i) => (f ? [] : [i]));
  if (seated.length < 2) return game;
  const sb =
    seated.length === 2 ? game.dealer : next(game, game.dealer, seated);
  const bb = next(game, sb, seated);
  const paid = Array<number>(game.count).fill(0);
  paid[sb] = Math.min(game.smallBlind, game.stacks?.[sb] ?? Infinity);
  paid[bb] = Math.min(game.bigBlind, game.stacks?.[bb] ?? Infinity);
  const pending = seated.filter(
    (i) => paid[i] < (game.stacks?.[i] ?? Infinity),
  );
  const highest = pending.length > 1 ? game.bigBlind : Math.max(...paid);
  const canAct =
    pending.length > 1
      ? pending
      : pending.filter((i) => paid[i] < Math.max(...paid));
  return {
    ...game,
    paid,
    total: [...paid],
    pending: canAct,
    actor: next(game, bb, canAct),
    highest,
    minRaise: game.bigBlind,
    phase: canAct.length ? "betting" : "deal",
    log: [],
    historyComplete: true,
    events: [
      {
        kind: "action",
        sequence: 1,
        street: 0,
        player: sb,
        action: "smallBlind",
        amount: paid[sb],
        streetTotal: paid[sb],
        totalCommitted: paid[sb],
        toCall: 0,
        highestBefore: 0,
        minRaiseBefore: game.bigBlind,
        potBefore: 0,
        potAfter: paid[sb],
        activePlayersBefore: seated.length,
      },
      {
        kind: "action",
        sequence: 2,
        street: 0,
        player: bb,
        action: "bigBlind",
        amount: paid[bb],
        streetTotal: paid[bb],
        totalCommitted: paid[bb],
        toCall: paid[sb],
        highestBefore: paid[sb],
        minRaiseBefore: game.bigBlind,
        potBefore: paid[sb],
        potAfter: paid[sb] + paid[bb],
        activePlayersBefore: seated.length,
      },
    ],
  };
}
export function act(
  game: LiveGame,
  action: "fold" | "call" | "raise",
  raiseTo = 0,
): LiveGame {
  if (game.phase !== "betting") return game;
  if (
    action === "raise" &&
    (!Number.isSafeInteger(raiseTo) ||
      raiseTo <= game.highest ||
      raiseTo > game.paid[game.actor] + remainingChips(game, game.actor) ||
      (raiseTo < game.highest + game.minRaise &&
        raiseTo !== game.paid[game.actor] + remainingChips(game, game.actor)) ||
      !canRaise(game))
  )
    return game;
  const g: LiveGame = {
    ...game,
    paid: [...game.paid],
    total: [...game.total],
    folded: [...game.folded],
    events: [...game.events],
  };
  const seat = g.actor;
  const due = g.highest - g.paid[seat];
  const amount =
    action === "fold"
      ? 0
      : action === "raise"
        ? raiseTo - g.paid[seat]
        : Math.min(due, remainingChips(game, seat));
  const recordedAction: PlayerAction["action"] =
    action === "fold"
      ? "fold"
      : action === "raise"
        ? game.highest
          ? "raise"
          : "bet"
        : due
          ? "call"
          : "check";
  if (action === "fold") {
    g.folded[seat] = true;
  } else {
    g.paid[seat] += amount;
    g.total[seat] += amount;
    if (action === "raise") {
      g.minRaise = Math.max(g.minRaise, raiseTo - g.highest);
      g.highest = raiseTo;
    }
  }
  const active = g.folded.flatMap((folded, i) => (folded ? [] : [i]));
  g.actedAt = [...(game.actedAt ?? Array(game.count).fill(null))];
  g.actedAt[seat] = g.highest;
  const funded = active.filter((i) => remainingChips(g, i) > 0);
  g.pending =
    action === "raise"
      ? funded.filter((i) => i !== seat)
      : g.pending.filter((i) => i !== seat && funded.includes(i));
  if (funded.length === 1)
    g.pending = g.pending.filter((i) => g.paid[i] < g.highest);
  const potBefore = game.total.reduce((a, b) => a + b, 0);
  g.events.push({
    kind: "action",
    sequence: g.events.length + 1,
    street: g.street,
    player: seat,
    action: recordedAction,
    amount,
    streetTotal: g.paid[seat],
    totalCommitted: g.total[seat],
    toCall: due,
    highestBefore: game.highest,
    minRaiseBefore: game.minRaise,
    potBefore,
    potAfter: potBefore + amount,
    activePlayersBefore: game.folded.filter((folded) => !folded).length,
  });
  if (active.length === 1) {
    g.phase = "finished";
    g.events.push({
      kind: "handEnd",
      sequence: g.events.length + 1,
      street: g.street,
      reason: "allOthersFolded",
      winner: active[0],
      pot: potBefore + amount,
    });
  } else if (!g.pending.length) {
    g.phase = g.street === 5 ? "finished" : "deal";
    if (g.phase === "finished")
      g.events.push({
        kind: "handEnd",
        sequence: g.events.length + 1,
        street: g.street,
        reason: "showdown",
        winner: null,
        pot: potBefore + amount,
      });
  } else g.actor = next(g, seat, g.pending);
  return g;
}
export function nextStreet(
  game: LiveGame,
  board?: readonly number[],
): LiveGame {
  if (game.phase !== "deal" || game.street === 5) return game;
  const street = (game.street === 0 ? 3 : game.street + 1) as 3 | 4 | 5;
  const funded = game.folded.flatMap((folded, i) =>
    folded || remainingChips(game, i) === 0 ? [] : [i],
  );
  const pending = funded.length > 1 ? funded : [];
  return {
    ...game,
    street,
    phase: pending.length ? "betting" : street === 5 ? "finished" : "deal",
    paid: Array(game.count).fill(0),
    highest: 0,
    minRaise: game.bigBlind,
    pending,
    actedAt: Array(game.count).fill(null),
    actor: next(game, game.dealer, pending),
    events: [
      ...game.events,
      {
        kind: "street",
        sequence: game.events.length + 1,
        street,
        board: board ? [...board] : null,
      },
      ...(!pending.length && street === 5
        ? [
            {
              kind: "handEnd" as const,
              sequence: game.events.length + 2,
              street,
              reason: "showdown" as const,
              winner: null,
              pot: game.total.reduce((a, b) => a + b, 0),
            },
          ]
        : []),
    ],
  };
}

export function remainingChips(game: LiveGame, seat: number): number {
  return (game.stacks?.[seat] ?? Infinity) - game.total[seat];
}
export function canRaise(game: LiveGame): boolean {
  const last = game.actedAt?.[game.actor];
  return (
    game.folded.some(
      (f, i) => !f && i !== game.actor && remainingChips(game, i) > 0,
    ) &&
    (last == null || game.highest - last >= game.minRaise) &&
    remainingChips(game, game.actor) > game.highest - game.paid[game.actor]
  );
}
export type Pot = { amount: number; eligible: number[]; refund?: number };
export function gamePots(game: LiveGame): Pot[] {
  let previous = 0;
  const layers = [...new Set(game.total)]
    .filter((n) => n > 0)
    .sort((a, b) => a - b)
    .map((level) => {
      const contributors = game.total.flatMap((n, i) =>
        n >= level ? [i] : [],
      );
      const amount = (level - previous) * contributors.length;
      previous = level;
      return {
        amount,
        eligible: contributors.filter((i) => !game.folded[i]),
        ...(contributors.length === 1 ? { refund: contributors[0] } : {}),
      };
    });
  // Folded contributions alone do not create a separate pot. Merge equal
  // eligibility before splitting so odd chips are awarded only once per pot.
  const pots: Pot[] = [];
  for (const layer of layers) {
    const last = pots.at(-1);
    if (
      last &&
      last.refund === undefined &&
      layer.refund === undefined &&
      last.eligible.join(",") === layer.eligible.join(",")
    )
      last.amount += layer.amount;
    else pots.push(layer);
  }
  return pots;
}
/** Winners are confirmed for each pot. Ties split chips, odd chips start left of dealer. */
export function settleGame(game: LiveGame, winners: number[][]): LiveGame {
  if (game.phase !== "finished" || game.payouts) return game;
  const pots = gamePots(game);
  const payouts = Array<number>(game.count).fill(0);
  for (const [index, pot] of pots.entries()) {
    const selected =
      pot.refund !== undefined
        ? [pot.refund]
        : pot.eligible.length === 1
          ? pot.eligible
          : winners[index];
    if (
      !selected?.length ||
      new Set(selected).size !== selected.length ||
      selected.some((i) => i !== pot.refund && !pot.eligible.includes(i))
    )
      return game;
    const ordered = [...selected].sort(
      (a, b) =>
        ((a - game.dealer - 1 + game.count) % game.count) -
        ((b - game.dealer - 1 + game.count) % game.count),
    );
    const share = Math.floor(pot.amount / ordered.length);
    ordered.forEach((seat, i) => {
      payouts[seat] += share + (i < pot.amount % ordered.length ? 1 : 0);
    });
  }
  return { ...game, payouts };
}
