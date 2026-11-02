import type { ComponentProps, ComponentType, CSSProperties } from "react";
import { useState } from "react";
import type { Draft } from "../../model";
import { cardLabel, ranks, suits } from "../../model";
import { seatName, streetName } from "../../liveGame";
import type { LiveGame } from "../../liveGame";
import type { Card } from "../../shared/cards/Card";
import { tableSeats } from "./tablePresentation";
import s from "./VisualPokerTable.module.css";

type CardTarget = { group: "hero" | "board"; index: number };

// Compact seats leave a clear middle band for the entire community area.
const compactPositions: Record<number, [number, number][]> = {
  2: [
    [50, 86],
    [50, 14],
  ],
  3: [
    [50, 86],
    [24, 14],
    [76, 14],
  ],
  4: [
    [50, 90],
    [17, 76],
    [50, 11],
    [83, 76],
  ],
  5: [
    [50, 90],
    [17, 76],
    [24, 11],
    [76, 11],
    [83, 76],
  ],
  6: [
    [50, 91.5],
    [17, 80],
    [17, 28],
    [50, 8.5],
    [83, 28],
    [83, 80],
  ],
  7: [
    [50, 91.5],
    [17, 80],
    [17, 28],
    [34, 8.5],
    [66, 8.5],
    [83, 28],
    [83, 80],
  ],
  8: [
    [50, 93],
    [17, 81],
    [17, 66],
    [17, 24],
    [50, 7.5],
    [83, 24],
    [83, 66],
    [83, 81],
  ],
  9: [
    [50, 93],
    [17, 81],
    [17, 66],
    [17, 24],
    [34, 7.5],
    [66, 7.5],
    [83, 24],
    [83, 66],
    [83, 81],
  ],
};

export default function VisualPokerTable({
  game,
  draft,
  dealSize,
  CardView,
  onPick,
}: {
  game: LiveGame;
  draft: Draft;
  dealSize: number;
  CardView: ComponentType<ComponentProps<typeof Card>>;
  onPick: (target: CardTarget) => void;
}) {
  const [selectedSeat, setSelectedSeat] = useState<number | null>(null);
  const seats = tableSeats(game);
  const followingActor = selectedSeat === null || selectedSeat >= game.count;
  const detailSeat =
    seats[
      followingActor
        ? game.phase === "betting"
          ? game.actor
          : 0
        : selectedSeat
    ];
  const pot = game.total.reduce((sum, value) => sum + value, 0);
  const phase =
    game.phase === "hand"
      ? "选择手牌，准备开局"
      : game.phase === "betting"
        ? `${seatName(game.actor)} 行动`
        : game.phase === "deal"
          ? `等待发${streetName(dealSize as 3 | 4 | 5)}`
          : game.payouts
            ? "本手已结算"
            : "本手结束 · 等待结算";

  return (
    <section className={s.visual} aria-label="可视化牌桌">
      <div className={s.topline}>
        <span>{game.count} 人桌 · 顺时针排列</span>
        <span>
          盲注 {game.smallBlind} / {game.bigBlind}
        </span>
      </div>
      <div
        className={`${s.actionBanner} ${game.phase === "betting" ? s.actionBannerActive : ""}`}
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        <span className={s.actionDot} aria-hidden="true" />
        {game.phase === "betting" ? `轮到 ${seatName(game.actor)} 行动` : phase}
      </div>
      <div className={s.frame} data-count={game.count}>
        <div className={s.rail} aria-hidden="true">
          <div className={s.felt} />
        </div>
        <div className={s.community} role="group" aria-label="公共牌区域">
          <span className={s.tableBrand}>RIVER LAB</span>
          <div className={s.pot} aria-label={`牌桌底池 ${pot}`}>
            <span className={s.chip} aria-hidden="true" />
            {game.payouts ? "本手底池" : "底池"} <strong>{pot}</strong>
          </div>
          <div className={s.boardCards} role="group" aria-label="公共牌">
            {Array.from({ length: 5 }, (_, index) =>
              index < dealSize ? (
                <CardView
                  key={index}
                  small
                  value={draft.board[index] ?? null}
                  label={`公共牌 ${index + 1}`}
                  onClick={
                    game.phase === "deal" && index >= game.street
                      ? () =>
                          onPick({
                            group: "board",
                            index: Math.min(index, draft.board.length),
                          })
                      : undefined
                  }
                />
              ) : (
                <div
                  key={index}
                  className={s.unseenCard}
                  role="img"
                  aria-label={`公共牌 ${index + 1} 未发`}
                >
                  <span aria-hidden="true">♠</span>
                </div>
              ),
            )}
          </div>
          <span className={s.street}>
            {game.phase === "hand"
              ? "等待开局"
              : game.phase === "deal"
                ? `待确认${streetName(dealSize as 3 | 4 | 5)}`
                : streetName(game.street)}
          </span>
        </div>
        {seats.map((seat) => {
          const angle = Math.PI / 2 + (seat.index * Math.PI * 2) / game.count;
          const [compactX, compactY] = compactPositions[game.count][seat.index];
          const position = {
            "--seat-x": `${50 + Math.cos(angle) * 42}%`,
            "--seat-y": `${50 + Math.sin(angle) * 37}%`,
            "--compact-x": `${compactX}%`,
            "--compact-y": `${compactY}%`,
          } as CSSProperties;
          return (
            <article
              key={seat.index}
              aria-label={seat.name}
              aria-current={seat.active ? "true" : undefined}
              className={`${s.seat} ${seat.active ? s.active : ""} ${game.folded[seat.index] ? s.folded : ""} ${seat.index === 0 ? s.hero : ""}`}
              style={position}
            >
              <button
                type="button"
                className={s.compactSeat}
                aria-label={`查看${seat.name}详情`}
                aria-pressed={detailSeat.index === seat.index}
                aria-controls="visual-seat-details"
                aria-describedby={`visual-seat-${seat.index}-description`}
                onClick={() => setSelectedSeat(seat.index)}
              >
                <span
                  id={`visual-seat-${seat.index}-description`}
                  className={s.srOnly}
                >
                  本轮下注 {game.paid[seat.index]}；剩余筹码{" "}
                  {seat.balance === null ? "未设上限" : seat.balance}；
                  {seat.status}；{seat.roles.join("，")}
                </span>
                <span className={s.compactName}>
                  <span>{seat.index === 0 ? "我" : seat.name}</span>
                  <span className={s.compactRoles}>
                    {seat.roles.map((role) => (
                      <span key={role} title={role}>
                        {role.split(" ")[1]}
                      </span>
                    ))}
                  </span>
                </span>
                <strong
                  className={s.compactBet}
                  title={`本轮下注 ${game.paid[seat.index]}`}
                >
                  <small>下注</small>
                  {compactChips(game.paid[seat.index])}
                </strong>
                <span className={s.compactStatus}>{seat.status}</span>
              </button>
              <div className={s.seatContent}>
                <div className={s.seatHeading}>
                  <span className={s.avatar} aria-hidden="true">
                    {seat.index === 0
                      ? "我"
                      : String(seat.index + 1).padStart(2, "0")}
                  </span>
                  <strong>
                    {seat.index === 0 ? "玩家 1（我）" : seat.name}
                  </strong>
                </div>
                <div className={s.roles}>
                  {seat.roles.length ? (
                    seat.roles.map((role) => <span key={role}>{role}</span>)
                  ) : (
                    <span className={s.seatNumber}>
                      座位 {String(seat.index + 1).padStart(2, "0")}
                    </span>
                  )}
                </div>
                <div className={s.balance}>
                  剩余筹码{" "}
                  <b>{seat.balance === null ? "未设上限" : seat.balance}</b>
                </div>
                <div className={s.contribution}>
                  本轮投入 {game.paid[seat.index]}
                  <br />
                  累计投入 {game.total[seat.index]}
                </div>
                <div className={s.seatBottom}>
                  <span className={s.status}>{seat.status}</span>
                  <SeatCards draft={draft} seat={seat.index} />
                </div>
                {seat.lastAction && (
                  <span className={s.lastAction}>{seat.lastAction}</span>
                )}
              </div>
            </article>
          );
        })}
      </div>
      <section
        className={s.seatDetails}
        id="visual-seat-details"
        aria-label="座位详情"
      >
        <div className={s.detailHeading}>
          <h3>{detailSeat.name}</h3>
          {game.phase === "betting" ? (
            <button
              type="button"
              className={s.followActor}
              aria-pressed={followingActor}
              onClick={() => setSelectedSeat(null)}
            >
              跟随行动
            </button>
          ) : (
            <span>点击座位查看详情</span>
          )}
        </div>
        <div className={s.detailStats}>
          <span>
            剩余筹码{" "}
            <b>
              {detailSeat.balance === null ? "未设上限" : detailSeat.balance}
            </b>
          </span>
          <span>
            本轮投入 <b>{game.paid[detailSeat.index]}</b>
          </span>
          <span>
            累计投入 <b>{game.total[detailSeat.index]}</b>
          </span>
        </div>
        <div className={s.detailFooter}>
          <div>
            <span>
              {detailSeat.roles.join(" · ") || `座位 ${detailSeat.index + 1}`}
            </span>
            <strong>
              {detailSeat.status}
              {detailSeat.lastAction ? ` · ${detailSeat.lastAction}` : ""}
            </strong>
          </div>
          <SeatCards draft={draft} seat={detailSeat.index} />
        </div>
      </section>
      <div className={s.handArea}>
        <div className={s.heroCards} role="group" aria-label="我的手牌">
          {draft.hero.map((card, index) => (
            <CardView
              key={index}
              small
              value={card}
              label={`手牌 ${index + 1}`}
              onClick={
                game.phase === "hand"
                  ? () => onPick({ group: "hero", index })
                  : undefined
              }
            />
          ))}
        </div>
        <div className={s.handHint}>
          <strong>{phase}</strong>
          <span>
            {game.phase === "hand"
              ? "点击左侧卡牌选择我的手牌"
              : "在下方记录行动，牌桌同步更新"}
          </span>
        </div>
      </div>
      <p className={s.legend}>
        D 庄家 · SB 小盲 · BB 大盲<span>对手未知底牌以牌背显示</span>
      </p>
    </section>
  );
}

function compactChips(amount: number): string | number {
  if (amount >= 100_000_000)
    return `${Number((amount / 100_000_000).toFixed(1))}亿`;
  if (amount >= 10_000) return `${Number((amount / 10_000).toFixed(1))}万`;
  return amount;
}

function SeatCards({ draft, seat }: { draft: Draft; seat: number }) {
  const opponent = draft.opponents[seat - 1];
  const cards =
    seat === 0
      ? draft.hero
      : opponent?.kind === "exact"
        ? opponent.cards
        : [null, null];
  return (
    <div
      className={s.holeCards}
      role="group"
      aria-label={`${seatName(seat)}的底牌`}
    >
      {cards.map((card, index) => (
        <span
          key={index}
          className={`${s.miniCard} ${card === null ? s.cardBack : ""} ${card !== null && card % 2 === 1 ? s.red : ""}`}
          role="img"
          aria-label={card === null ? "未知底牌" : cardLabel(card)}
        >
          {card === null
            ? ""
            : `${ranks[Math.floor(card / 4)]}${suits[card % 4]}`}
        </span>
      ))}
    </div>
  );
}
