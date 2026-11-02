import type { ComponentType, ComponentProps } from "react";
import type { Card as CardComponent } from "../../shared/cards/Card";
import { useScenario } from "../../state";
import type { Draft } from "../../model";
import { usedCards, ranks, suits, cardLabel } from "../../model";
import RangeEditor from "./RangeEditor";
import s from "./OpponentSettings.module.css";
import ui from "../../shared/ui/Shared.module.css";
type Target =
  | { group: "opponent"; player: number; index: number }
  | { group: "dead"; index: number };
export default function OpponentSettings({
  CardView: Card,
  onPick: setPicker,
}: {
  CardView: ComponentType<ComponentProps<typeof CardComponent>>;
  onPick: (target: Target) => void;
}) {
  const { draft, dispatch } = useScenario();
  const patch = (value: Partial<Draft>) =>
    dispatch({ type: "patch", patch: value });
  return (
    <section className={ui.section}>
      <div className={ui.sectionHeading}>
        <h3>对手信息与范围</h3>
        <span className={ui.sectionMeta}>
          {draft.opponents.filter((o) => !o.folded).length} 名在局对手 ·{" "}
          {draft.opponents.length + 1} 人桌
        </span>
      </div>
      <details
        className={ui.optionalSettings}
        open={
          draft.opponents.some((o) => o.kind !== "random") ||
          draft.deadCards.length > 0 ||
          undefined
        }
      >
        <summary>指定对手手牌或范围</summary>
        <div className={s.opponents}>
          {draft.opponents.map((opponent, player) => (
            <div className={s.opponent} key={player}>
              <div className={s.opponentLine}>
                <label>
                  <input
                    type="checkbox"
                    aria-label={`对手 ${player + 1} 在局`}
                    checked={!opponent.folded}
                    onChange={(e) =>
                      patch({
                        opponents: draft.opponents.map((o, i) =>
                          i === player
                            ? { ...o, folded: !e.target.checked }
                            : o,
                        ),
                      })
                    }
                  />
                  在局
                </label>
                <span>
                  <i>{String(player + 1).padStart(2, "0")}</i> 对手 {player + 1}
                </span>
                <select
                  aria-label={`对手 ${player + 1} 手牌模式`}
                  value={opponent.kind}
                  onChange={(event) =>
                    patch({
                      opponents: draft.opponents.map((o, i) =>
                        i !== player
                          ? o
                          : event.target.value === "random"
                            ? { kind: "random", folded: o.folded }
                            : event.target.value === "range"
                              ? {
                                  kind: "range",
                                  folded: o.folded,
                                  text: "TT+,AJs+,KQo:0.5",
                                }
                              : {
                                  kind: "exact",
                                  cards: [null, null],
                                  folded: o.folded,
                                },
                      ),
                    })
                  }
                >
                  <option value="random">随机手牌</option>
                  <option value="exact">指定手牌</option>
                  <option value="range">加权手牌范围</option>
                </select>
              </div>
              {opponent.kind === "range" && (
                <>
                  {opponent.rangeSource === "current" && (
                    <p className={ui.helper}>
                      此范围来自敏感性分析，表示当前后验范围。不要将它作为同一手牌的翻前先验。
                    </p>
                  )}
                  <RangeEditor
                    value={opponent.text}
                    player={player}
                    knownCards={usedCards(draft)}
                    onChange={(text) =>
                      patch({
                        opponents: draft.opponents.map((item, index) =>
                          index === player
                            ? {
                                ...item,
                                kind: "range",
                                text,
                                rangeSource: "manual",
                              }
                            : item,
                        ),
                      })
                    }
                  />
                </>
              )}
              {opponent.kind === "exact" && (
                <div className={`${ui.cards} ${s.opponentCards}`}>
                  {opponent.cards.map((card, index) => (
                    <Card
                      key={index}
                      value={card}
                      small
                      label={`对手 ${player + 1} 手牌 ${index + 1}`}
                      onClick={() =>
                        setPicker({ group: "opponent", player, index })
                      }
                      onRemove={() =>
                        patch({
                          opponents: draft.opponents.map((o, i) => {
                            if (i !== player || o.kind !== "exact") return o;
                            const cards = [...o.cards] as [
                              number | null,
                              number | null,
                            ];
                            cards[index] = null;
                            return { ...o, cards };
                          }),
                        })
                      }
                    />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
        <details className={s.deadDetails}>
          <summary>
            已知死牌 <span>{draft.deadCards.length} 张</span>
          </summary>
          <p className={ui.helper}>
            仅添加明确知道且不会再出现的牌。未知弃牌无需填写。
          </p>
          <div className={s.deadCards}>
            {draft.deadCards.map((card) => (
              <button
                key={card}
                className={card % 2 === 1 ? ui.red : ""}
                onClick={() =>
                  patch({
                    deadCards: draft.deadCards.filter((v) => v !== card),
                  })
                }
                aria-label={`移除死牌${cardLabel(card)}`}
              >
                {ranks[Math.floor(card / 4)]}
                {suits[card % 4]} <small>×</small>
              </button>
            ))}
            <button
              className={s.addDead}
              onClick={() => setPicker({ group: "dead", index: 0 })}
            >
              ＋ 添加
            </button>
          </div>
        </details>
      </details>
    </section>
  );
}
