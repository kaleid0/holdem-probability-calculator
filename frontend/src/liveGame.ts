export type Street = 0 | 3 | 4 | 5;
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
  log: string[];
};
export const streetName = (street: Street) =>
  ({ 0: "翻前", 3: "翻牌", 4: "转牌", 5: "河牌" })[street];
export const seatName = (seat: number) =>
  `玩家 ${seat + 1}${seat === 0 ? "（我）" : ""}`;
export function createGame(
  count = 3,
  dealer = 0,
  smallBlind = 5,
  bigBlind = 10,
): LiveGame {
  return {
    count,
    dealer,
    smallBlind,
    bigBlind,
    street: 0,
    phase: "hand",
    actor: 0,
    folded: Array(count).fill(false),
    paid: Array(count).fill(0),
    total: Array(count).fill(0),
    pending: [],
    highest: 0,
    minRaise: bigBlind,
    log: [],
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
  const sb = game.count === 2 ? game.dealer : (game.dealer + 1) % game.count;
  const bb = (sb + 1) % game.count;
  const paid = Array<number>(game.count).fill(0);
  paid[sb] = game.smallBlind;
  paid[bb] = game.bigBlind;
  const pending = paid.map((_, i) => i);
  return {
    ...game,
    paid,
    total: [...paid],
    pending,
    actor: next(game, bb, pending),
    highest: game.bigBlind,
    minRaise: game.bigBlind,
    phase: "betting",
    log: [
      `${seatName(sb)} 小盲 ${game.smallBlind}`,
      `${seatName(bb)} 大盲 ${game.bigBlind}`,
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
    (!Number.isSafeInteger(raiseTo) || raiseTo < game.highest + game.minRaise)
  )
    return game;
  const g = {
    ...game,
    paid: [...game.paid],
    total: [...game.total],
    folded: [...game.folded],
    log: [...game.log],
  };
  const seat = g.actor;
  const due = g.highest - g.paid[seat];
  let label: string;
  if (action === "fold") {
    g.folded[seat] = true;
    label = "弃牌";
  } else {
    const amount = action === "raise" ? raiseTo - g.paid[seat] : due;
    g.paid[seat] += amount;
    g.total[seat] += amount;
    label =
      action === "raise"
        ? `${g.highest ? "加注" : "下注"}至 ${raiseTo}（追加 ${amount}）`
        : due
          ? `跟注 ${due}`
          : "过牌";
    if (action === "raise") {
      g.minRaise = raiseTo - g.highest;
      g.highest = raiseTo;
    }
  }
  const active = g.folded.flatMap((folded, i) => (folded ? [] : [i]));
  g.pending =
    action === "raise"
      ? active.filter((i) => i !== seat)
      : g.pending.filter((i) => i !== seat && !g.folded[i]);
  g.log.push(`${streetName(g.street)} · ${seatName(seat)} ${label}`);
  if (active.length === 1) {
    g.phase = "finished";
    g.log.push(
      `${seatName(active[0])} 赢得底池 ${g.total.reduce((a, b) => a + b, 0)}`,
    );
  } else if (!g.pending.length) g.phase = g.street === 5 ? "finished" : "deal";
  else g.actor = next(g, seat, g.pending);
  return g;
}
export function nextStreet(game: LiveGame): LiveGame {
  if (game.phase !== "deal") return game;
  const street = (game.street === 0 ? 3 : game.street + 1) as Street;
  const pending = game.folded.flatMap((folded, i) => (folded ? [] : [i]));
  return {
    ...game,
    street,
    phase: "betting",
    paid: Array(game.count).fill(0),
    highest: 0,
    minRaise: game.bigBlind,
    pending,
    actor: next(game, game.dealer, pending),
    log: [...game.log, `进入${streetName(street)}`],
  };
}
