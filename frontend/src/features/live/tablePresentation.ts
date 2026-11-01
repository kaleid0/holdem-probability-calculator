import { remainingChips, seatName, startGame } from "../../liveGame";
import type { LiveGame, PlayerAction } from "../../liveGame";

export type TableSeat = {
  index: number;
  name: string;
  roles: string[];
  balance: number | null;
  active: boolean;
  status: string;
  lastAction: string | null;
};

function actionLabel(event: PlayerAction): string {
  switch (event.action) {
    case "smallBlind":
      return `小盲 ${event.amount}`;
    case "bigBlind":
      return `大盲 ${event.amount}`;
    case "fold":
      return "弃牌";
    case "check":
      return "过牌";
    case "call":
      return `跟注 ${event.amount}`;
    case "bet":
      return `下注 ${event.streetTotal}`;
    case "raise":
      return `加注至 ${event.streetTotal}`;
  }
}

export function tableSeats(game: LiveGame): TableSeat[] {
  // Blind events keep their original seats after players fold. The preparation
  // preview uses the same blind rules as the betting engine without posting chips.
  const blindEvents =
    game.phase === "hand" ? startGame(game).events : game.events;
  const smallBlind = blindEvents.find(
    (event) => event.kind === "action" && event.action === "smallBlind",
  );
  const bigBlind = blindEvents.find(
    (event) => event.kind === "action" && event.action === "bigBlind",
  );
  const latest = new Map<number, PlayerAction>();
  for (const event of game.events)
    if (event.kind === "action" && event.street === game.street)
      latest.set(event.player, event);

  return Array.from({ length: game.count }, (_, index) => {
    const remaining = remainingChips(game, index);
    const balance = remaining + (game.payouts?.[index] ?? 0);
    const active =
      game.phase === "betting" && game.actor === index && !game.folded[index];
    const status =
      game.stacks?.[index] === 0
        ? "无筹码"
        : game.folded[index]
          ? "已弃牌"
          : game.payouts
            ? "已结算"
            : game.phase === "hand"
              ? "待发牌"
              : remaining === 0
                ? "全下"
                : game.phase === "finished"
                  ? "等待摊牌"
                  : game.phase === "deal"
                    ? "待发牌"
                    : active
                      ? "行动中"
                      : "等待行动";
    const action = latest.get(index);
    return {
      index,
      name: seatName(index),
      roles: [
        ...(index === game.dealer ? ["庄家 D"] : []),
        ...(smallBlind?.kind === "action" && smallBlind.player === index
          ? ["小盲 SB"]
          : []),
        ...(bigBlind?.kind === "action" && bigBlind.player === index
          ? ["大盲 BB"]
          : []),
      ],
      balance: Number.isFinite(balance) ? balance : null,
      active,
      status,
      lastAction: action ? actionLabel(action) : null,
    };
  });
}
