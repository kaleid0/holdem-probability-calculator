import { useEffect, useRef, useState } from "react";
import { cardLabel, ranks, suits, suitNames, usedCards } from "../../model";
import type { Draft } from "../../model";
import type { CardTarget } from "./types";
import s from "./Cards.module.css";
import ui from "../ui/Shared.module.css";

function currentSuitForTarget(draft: Draft, target: CardTarget) {
  const value =
    target.group === "hero"
      ? draft.hero[target.index]
      : target.group === "board"
        ? draft.board[target.index]
        : target.group === "opponent"
          ? (() => {
              const opponent = draft.opponents[target.player];
              return opponent.kind === "exact"
                ? opponent.cards[target.index]
                : null;
            })()
          : null;
  return value === null || value === undefined ? 0 : value % 4;
}
export function CardPicker({
  draft,
  target,
  onSelect,
  onClose,
}: {
  draft: Draft;
  target: CardTarget;
  onSelect: (value: number) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  const [activeSuit, setActiveSuit] = useState(
    currentSuitForTarget(draft, target),
  );
  const originalFocus = useRef(document.activeElement);
  const current =
    target.group === "hero"
      ? draft.hero[target.index]
      : target.group === "board"
        ? draft.board[target.index]
        : target.group === "opponent"
          ? (() => {
              const o = draft.opponents[target.player];
              return o.kind === "exact" ? o.cards[target.index] : null;
            })()
          : null;
  const occupied = new Set(usedCards(draft));
  const title =
    target.group === "hero"
      ? "选择我的手牌"
      : target.group === "board"
        ? "选择公共牌"
        : target.group === "opponent"
          ? `选择对手 ${target.player + 1} 的手牌`
          : "选择已知死牌";
  useEffect(() => {
    const before = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const previous = originalFocus.current;
    return () => {
      document.body.style.overflow = before;
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);
  return (
    <div
      className={s.modalBackdrop}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className={s.picker}
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="picker-title"
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
          if (event.key === "Tab") {
            const buttons = dialog.current?.querySelectorAll<HTMLButtonElement>(
              "button:not(:disabled)",
            );
            if (!buttons?.length) return;
            const first = buttons[0],
              last = buttons[buttons.length - 1];
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first.focus();
            }
          }
        }}
      >
        <div className={s.pickerHeading}>
          <div>
            <span className={ui.eyebrow}>THE DECK · 52 CARDS</span>
            <h2 id="picker-title">
              {title}
              {target.group !== "dead" ? ` · 第 ${target.index + 1} 张` : ""}
            </h2>
          </div>
          <button
            className={s.closeButton}
            onClick={onClose}
            aria-label="关闭选牌器"
          >
            ×
          </button>
        </div>
        <p className={ui.helper}>
          已使用的牌不可重复选择。
          {target.group === "dead"
            ? "可连续选择，点击已选死牌可取消。"
            : "选择牌面后自动进入下一空位，或返回牌桌。"}
        </p>
        <div className={s.suitTabs} role="tablist" aria-label="选择花色">
          {suits.map((suit, suitIndex) => (
            <button
              key={suit}
              type="button"
              role="tab"
              aria-selected={activeSuit === suitIndex}
              className={`${s.suitTab} ${suitIndex % 2 === 1 ? ui.red : ""} ${activeSuit === suitIndex ? s.activeSuit : ""}`}
              onClick={() => setActiveSuit(suitIndex)}
            >
              <span>{suit}</span>
              {suitNames[suitIndex]}
            </button>
          ))}
        </div>
        <div className={s.deck}>
          <div
            className={s.rankScroller}
            aria-label={`${suitNames[activeSuit]}牌号`}
          >
            <div className={s.rankRow}>
              {Array.from(ranks).map((rank, rankIndex) => {
                const value = rankIndex * 4 + activeSuit;
                const selected =
                  target.group === "dead"
                    ? draft.deadCards.includes(value)
                    : current === value;
                return (
                  <button
                    key={value}
                    className={`${s.deckCard} ${activeSuit % 2 === 1 ? ui.red : ""} ${selected ? s.selectedCard : ""}`}
                    disabled={occupied.has(value) && !selected}
                    onClick={() => onSelect(value)}
                    aria-label={cardLabel(value)}
                    aria-pressed={selected}
                  >
                    <span>{rank}</span>
                    <small>{suits[activeSuit]}</small>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        <div className={s.pickerFooter}>
          <span>选择花色，再点选牌号 · 已使用的牌会自动禁用</span>
          <button className={s.textButton} onClick={onClose}>
            完成选牌 →
          </button>
        </div>
      </div>
    </div>
  );
}
