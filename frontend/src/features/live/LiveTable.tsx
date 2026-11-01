import { useState } from "react";
import type { ComponentProps, ComponentType } from "react";
import type { Draft } from "../../model";
import { useScenario } from "../../state";
import {
  act,
  gameLog,
  nextStreet,
  seatName,
  startGame,
  streetName,
  remainingChips,
  canRaise,
} from "../../liveGame";
import type { LiveGame, Street } from "../../liveGame";
import type { Card } from "../../shared/cards/Card";
import type { CardPicker } from "../../shared/cards/CardPicker";
import s from "./LiveTable.module.css";
import HandSettlement from "./HandSettlement";

type Target = { group: "hero" | "board"; index: number };
type Snapshot = { game: LiveGame; draft: Draft };
export default function LiveTable({
  CardView,
  Picker,
  onAnalyze,
  analyzing = false,
}: {
  CardView: ComponentType<ComponentProps<typeof Card>>;
  Picker: ComponentType<ComponentProps<typeof CardPicker>>;
  onAnalyze: (draft: Draft) => void;
  analyzing?: boolean;
}) {
  const { draft, game: recordedGame, history, dispatch } = useScenario();
  const [picker, setPicker] = useState<Target | null>(null);
  const [raiseExtra, setRaiseExtra] = useState(0);
  const [showRaise, setShowRaise] = useState(false);
  if (!recordedGame)
    return (
      <section className={s.table} aria-label="逐步记录">
        <div className={s.heading}>
          <div>
            <span className={s.caption}>共用当前局面</span>
            <h2>当前局面未记录行动历史</h2>
          </div>
          <div className={s.pot}>
            底池<strong>{draft.pot}</strong>
          </div>
        </div>
        <div className={s.cards}>
          {draft.hero.map((card, i) => (
            <CardView key={i} value={card} label={`手牌 ${i + 1}`} />
          ))}
        </div>
        <div className={s.startActions}>
          <button
            className={s.primary}
            onClick={() => dispatch({ type: "new-hand" })}
          >
            开始记录新一手 →
          </button>
        </div>
      </section>
    );
  const game = recordedGame;
  const log = gameLog(game);
  const state = { game, draft };
  const pot = game.total.reduce((a, b) => a + b, 0);
  const nextSize = (game.street === 0 ? 3 : game.street + 1) as Street;
  const available = remainingChips(game, game.actor);
  const maximum = Number.isFinite(available)
    ? game.paid[game.actor] + available
    : game.highest + game.minRaise + 1000;
  const minimum = Math.min(game.highest + game.minRaise, maximum);
  const raiseTo = Math.min(minimum + raiseExtra, maximum);
  const due = game.highest - game.paid[game.actor];
  const callAmount = Math.min(due, available);
  const dealSize = game.phase === "deal" ? nextSize : game.street;
  const heroReady = draft.hero.every((card) => card !== null);
  const boardReady = Array.from(
    { length: nextSize },
    (_, i) => draft.board[i],
  ).every((card) => card != null);
  const remaining = game.folded.filter((f) => !f).length;
  function save(value: Snapshot) {
    dispatch({ type: "record", ...value });
    setRaiseExtra(0);
    setShowRaise(false);
  }
  function newHand() {
    dispatch({ type: "new-hand" });
    setPicker(null);
    setRaiseExtra(0);
    setShowRaise(false);
  }
  function selectCard(value: number) {
    if (!picker) return;
    const updated = {
      ...draft,
      hero: [...draft.hero] as Draft["hero"],
      board: [...draft.board],
    };
    if (picker.group === "hero") updated.hero[picker.index] = value;
    else updated.board[picker.index] = value;
    save({ game, draft: updated });
    const limit = picker.group === "hero" ? 2 : dealSize;
    const cards = picker.group === "hero" ? updated.hero : updated.board;
    setPicker(
      picker.index + 1 < limit && cards[picker.index + 1] == null
        ? { ...picker, index: picker.index + 1 }
        : null,
    );
  }
  function analyze() {
    onAnalyze(draft);
  }
  return (
    <section className={s.table} aria-label="真实牌局">
      <div className={s.heading}>
        <div>
          {game.phase === "hand" ? (
            <h2 className={s.preparationTitle}>准备牌局</h2>
          ) : (
            <>
              <span className={s.caption}>
                {remaining} 人在局 · 盲注 {game.smallBlind} / {game.bigBlind}
              </span>
              <h2>
                {game.phase === "finished"
                  ? "本手结束"
                  : `${streetName(game.street)} · ${game.phase === "deal" ? "等待发公共牌" : `${seatName(game.actor)} 行动`}`}
              </h2>
            </>
          )}
        </div>
        <div className={s.pot}>
          底池<strong>{pot}</strong>
        </div>
      </div>
      <ol className={s.steps}>
        {["手牌", "翻前", "翻牌", "转牌", "河牌"].map((label, index) => (
          <li
            key={label}
            aria-current={
              (game.phase === "hand"
                ? 0
                : game.street === 0
                  ? 1
                  : game.street - 1) === index
                ? "step"
                : undefined
            }
          >
            {label}
          </li>
        ))}
      </ol>
      <div className={s.cardArea}>
        <div>
          <h3>我的手牌</h3>
          <div className={s.cards}>
            {draft.hero.map((card, index) => (
              <CardView
                key={index}
                value={card}
                small={game.phase !== "hand"}
                label={`手牌 ${index + 1}`}
                onClick={
                  game.phase === "hand"
                    ? () => setPicker({ group: "hero", index })
                    : undefined
                }
              />
            ))}
          </div>
        </div>
        {dealSize > 0 && (
          <div>
            <h3>
              {game.phase === "deal" ? `选择${streetName(nextSize)}` : "公共牌"}
            </h3>
            <div className={s.cards}>
              {Array.from({ length: dealSize }, (_, index) => (
                <CardView
                  key={index}
                  small
                  value={draft.board[index] ?? null}
                  label={`公共牌 ${index + 1}`}
                  onClick={
                    game.phase === "deal" && index >= game.street
                      ? () =>
                          setPicker({
                            group: "board",
                            index: Math.min(index, draft.board.length),
                          })
                      : undefined
                  }
                />
              ))}
            </div>
          </div>
        )}
      </div>
      {game.phase === "hand" &&
        (game.folded.filter((f) => !f).length < 2 ? (
          <p className={s.note}>
            仅剩一位玩家有筹码，本桌已结束。可在「局面录入」中重置牌局，重新设置初始筹码。
          </p>
        ) : (
          <button
            className={s.primary}
            disabled={!heroReady || game.folded.filter((f) => !f).length < 2}
            onClick={() => save({ game: startGame(game), draft })}
          >
            开始牌局 →
          </button>
        ))}
      {game.phase === "deal" && (
        <button
          className={s.primary}
          disabled={!boardReady}
          onClick={() =>
            save({
              game: nextStreet(game, draft.board),
              draft: { ...draft, boardSize: nextSize },
            })
          }
        >
          确认{streetName(nextSize)}，
          {game.folded.filter((f, i) => !f && remainingChips(game, i) > 0)
            .length > 1
            ? "继续下注"
            : "继续发牌"}{" "}
          →
        </button>
      )}
      {game.phase === "betting" && (
        <div className={s.actions}>
          <p className={s.actionHint}>
            {due
              ? `已投入 ${game.paid[game.actor]}，${callAmount < due ? `剩余 ${callAmount}，跟注将全下。` : `再跟 ${due} 即可跟齐。`}`
              : "无人加注，可以过牌。"}
            {game.folded[0] ? " 你已弃牌，可继续记录其他玩家。" : ""}
          </p>
          <div className={s.buttons}>
            <button
              className={s.fold}
              onClick={() => save({ ...state, game: act(game, "fold") })}
            >
              弃牌
            </button>
            <button
              className={s.primary}
              onClick={() => save({ ...state, game: act(game, "call") })}
            >
              {due
                ? `${callAmount < due ? "全下跟注" : "跟注"} ${callAmount}`
                : "过牌"}
            </button>
            <button
              aria-expanded={showRaise}
              aria-controls="live-raise"
              disabled={!canRaise(game)}
              onClick={() => setShowRaise((value) => !value)}
            >
              {showRaise ? "收起" : game.highest ? "加注" : "下注"}
            </button>
          </div>
          {showRaise && (
            <div className={s.raisePanel} id="live-raise">
              <label className={s.slider}>
                {game.highest ? "本轮加注至" : "本轮下注"}
                <strong>{raiseTo}</strong>
                <input
                  type="range"
                  min={minimum}
                  max={maximum}
                  step={1}
                  value={raiseTo}
                  onChange={(e) =>
                    setRaiseExtra(Number(e.target.value) - minimum)
                  }
                  aria-label="下注或加注总额"
                />
              </label>
              <div className={s.raiseFooter}>
                <span>本次追加 {raiseTo - game.paid[game.actor]}</span>
                <button
                  className={s.primary}
                  onClick={() =>
                    save({ ...state, game: act(game, "raise", raiseTo) })
                  }
                >
                  确认{game.highest ? "加注" : "下注"} {raiseTo}
                </button>
              </div>
            </div>
          )}
          {game.actor === 0 && (
            <button
              className={s.analyze}
              disabled={analyzing}
              onClick={analyze}
            >
              {analyzing ? "精细分析进行中…" : "精细分析当前决策 ↗"}
            </button>
          )}
        </div>
      )}
      {game.phase === "finished" && (
        <div className={s.finished}>
          <h3>{remaining === 1 ? log.at(-1) : "河牌下注完成，可以摊牌"}</h3>
          {!game.folded[0] && remaining > 1 && (
            <button
              className={s.analyze}
              disabled={analyzing}
              onClick={analyze}
            >
              精细分析摊牌权益 ↗
            </button>
          )}
          <HandSettlement key={game.events.length} game={game} />
          <button
            className={s.primary}
            disabled={!!game.stacks && !game.payouts}
            onClick={newHand}
          >
            开始新一手 →
          </button>
        </div>
      )}
      {log.length > 0 && (
        <p className={s.lastAction} role="status">
          {log.at(-1)}
        </p>
      )}
      <div className={s.toolbar}>
        <button
          disabled={!history.length}
          onClick={() => {
            const previous = history.at(-1);
            if (previous) {
              dispatch({ type: "undo" });
              setRaiseExtra(0);
              setShowRaise(false);
            }
          }}
        >
          撤销上一步
        </button>
        {game.phase !== "hand" && game.phase !== "finished" && (
          <button onClick={newHand}>放弃本手并重开</button>
        )}
      </div>
      <details className={s.details}>
        <summary>
          牌桌详情 <span>玩家投入 · 行动记录</span>
        </summary>
        <div className={s.seats}>
          {game.total.map((total, i) => (
            <div
              key={i}
              className={`${s.seat} ${game.phase === "betting" && game.actor === i ? s.active : ""} ${game.folded[i] ? s.folded : ""}`}
            >
              <strong>
                {seatName(i)} {i === game.dealer ? "D" : ""}
              </strong>
              <span>
                {game.stacks &&
                  `剩余 ${remainingChips(game, i) + (game.payouts?.[i] ?? 0)} · `}
                {game.folded[i]
                  ? `已弃牌 · 投入 ${total}`
                  : `本轮 ${game.paid[i]} · 累计 ${total}`}
              </span>
            </div>
          ))}
        </div>
        {log.length > 0 && (
          <ol className={s.history}>
            {log.map((entry, i) => (
              <li key={i}>{entry}</li>
            ))}
          </ol>
        )}
        {!game.historyComplete && (
          <p className={s.note}>
            旧版行动仅保留文字，结构化行动序列从升级后开始记录。
          </p>
        )}
      </details>
      {picker && (
        <Picker
          draft={draft}
          target={picker}
          onSelect={selectCard}
          onClose={() => setPicker(null)}
        />
      )}
    </section>
  );
}
