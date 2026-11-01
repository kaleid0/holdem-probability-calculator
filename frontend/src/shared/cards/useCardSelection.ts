import { useState } from "react";
import type { Draft } from "../../model";
import type { CardTarget } from "./types";
export function useCardSelection(
  draft: Draft,
  patch: (value: Partial<Draft>) => void,
) {
  const [picker, setPicker] = useState<CardTarget | null>(null);
  function setCard(value: number) {
    if (!picker) return;
    if (picker.group === "dead") {
      patch({
        deadCards: draft.deadCards.includes(value)
          ? draft.deadCards.filter((card) => card !== value)
          : [...draft.deadCards, value],
      });
      return;
    }
    if (picker.group === "hero") {
      const hero = [...draft.hero] as Draft["hero"];
      hero[picker.index] = value;
      patch({ hero });
    } else if (picker.group === "board") {
      const board = [...draft.board];
      board[picker.index] = value;
      patch({ board });
    } else if (picker.group === "opponent") {
      const player = picker.player;
      const cardIndex = picker.index;
      const opponents = draft.opponents.map((o, i) => {
        if (i !== player || o.kind !== "exact") return o;
        const cards = [...o.cards] as [number | null, number | null];
        cards[cardIndex] = value;
        return { ...o, cards };
      });
      patch({ opponents });
    }
    // Keep the picker open for the next empty slot: this makes entering a
    // two-card hand a single uninterrupted flow on touch screens.
    if (
      picker.group === "hero" &&
      picker.index === 0 &&
      draft.hero[1] === null
    ) {
      setPicker({ group: "hero", index: 1 });
    } else if (
      picker.group === "board" &&
      picker.index < draft.boardSize - 1 &&
      draft.board[picker.index + 1] == null
    ) {
      setPicker({ group: "board", index: picker.index + 1 });
    } else if (picker.group === "opponent" && picker.index === 0) {
      const opponent = draft.opponents[picker.player];
      if (opponent.kind === "exact" && opponent.cards[1] === null) {
        setPicker({ group: "opponent", player: picker.player, index: 1 });
      } else {
        setPicker(null);
      }
    } else {
      setPicker(null);
    }
  }

  return { picker, setPicker, setCard };
}
