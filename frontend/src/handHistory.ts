import { z } from "zod";

export type Street = 0 | 3 | 4 | 5;
export const streetName = (street: Street) =>
  ({ 0: "翻前", 3: "翻牌", 4: "转牌", 5: "河牌" })[street];
export const seatName = (seat: number) =>
  `玩家 ${seat + 1}${seat === 0 ? "（我）" : ""}`;

const chips = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const seat = z.number().int().min(0).max(8);
const street = z.union([
  z.literal(0),
  z.literal(3),
  z.literal(4),
  z.literal(5),
]);
const sequence = z.number().int().positive();
export const playerActionSchema = z.object({
  kind: z.literal("action"),
  sequence,
  street,
  player: seat,
  action: z.enum([
    "smallBlind",
    "bigBlind",
    "fold",
    "check",
    "call",
    "bet",
    "raise",
  ]),
  // All amounts are chips. `amount` is the additional contribution, not raise-to.
  amount: chips,
  streetTotal: chips,
  totalCommitted: chips,
  toCall: chips,
  highestBefore: chips,
  minRaiseBefore: chips.positive(),
  potBefore: chips,
  potAfter: chips,
  activePlayersBefore: z.number().int().min(2).max(9),
});
export const handEventSchema = z.discriminatedUnion("kind", [
  playerActionSchema,
  z.object({
    kind: z.literal("street"),
    sequence,
    street: z.union([z.literal(3), z.literal(4), z.literal(5)]),
    // null means the caller did not supply board context, never an inferred board.
    board: z.array(z.number().int().min(0).max(51)).max(5).nullable(),
  }),
  z.object({
    kind: z.literal("handEnd"),
    sequence,
    street,
    reason: z.enum(["allOthersFolded", "showdown"]),
    winner: seat.nullable(),
    pot: chips,
  }),
]);
export type PlayerAction = z.infer<typeof playerActionSchema>;
export type HandEvent = z.infer<typeof handEventSchema>;
type History = { events: HandEvent[]; log: string[] };

export function playerActions(
  history: Pick<History, "events">,
  player: number,
): PlayerAction[] {
  return history.events.filter(
    (event): event is PlayerAction =>
      event.kind === "action" && event.player === player,
  );
}
export function actionsByPlayer(
  history: Pick<History, "events"> & { count: number },
): PlayerAction[][] {
  return Array.from({ length: history.count }, (_, player) =>
    playerActions(history, player),
  );
}
export function formatEvent(event: HandEvent): string {
  if (event.kind === "street") return `进入${streetName(event.street)}`;
  if (event.kind === "handEnd")
    return event.reason === "allOthersFolded" && event.winner !== null
      ? `${seatName(event.winner)} 赢得底池 ${event.pot}`
      : "河牌下注完成，可以摊牌";
  if (event.action === "smallBlind" || event.action === "bigBlind")
    return `${seatName(event.player)} ${event.action === "smallBlind" ? "小盲" : "大盲"} ${event.amount}`;
  const label =
    event.action === "fold"
      ? "弃牌"
      : event.action === "check"
        ? "过牌"
        : event.action === "call"
          ? `跟注 ${event.amount}`
          : `${event.action === "bet" ? "下注" : "加注"}至 ${event.streetTotal}（追加 ${event.amount}）`;
  return `${streetName(event.street)} · ${seatName(event.player)} ${label}`;
}
// `log` is only the unstructured prefix recovered from saves made before events existed.
export function gameLog(history: History): string[] {
  return [...history.log, ...history.events.map(formatEvent)];
}
