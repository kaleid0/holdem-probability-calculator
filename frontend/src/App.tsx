import { useEffect, useRef, useState } from "react";
import type { CSSProperties, ChangeEvent } from "react";
import { useScenario } from "./state";
import {
  cardLabel,
  emptyDraft,
  exampleDraft,
  parseSaved,
  ranks,
  suits,
  suitNames,
  toRequest,
  usedCards,
  validateDraft,
} from "./model";
import type { Draft } from "./model";
import { activeTask, ApiError, request } from "./api/client";
import type {
  AnalysisResult,
  AnalysisTask,
  Strategy,
  TaskCreated,
} from "./api/client";
import s from "./App.module.css";

type CardTarget =
  | { group: "hero" | "board" | "dead"; index: number }
  | { group: "opponent"; index: number; player: number };
const statusText = {
  queued: "排队等待计算",
  running: "正在模拟牌局",
  cancelling: "正在取消",
  succeeded: "计算完成",
  failed: "计算失败",
  cancelled: "已取消计算",
  expired: "任务已失效",
};
const percent = (value: number) => `${(value * 100).toFixed(2)}%`;

function Card({
  value,
  onClick,
  onRemove,
  label,
  small = false,
}: {
  value: number | null;
  onClick?: () => void;
  onRemove?: () => void;
  label: string;
  small?: boolean;
}) {
  return (
    <div className={`${s.cardWrap} ${small ? s.smallCard : ""}`}>
      <button
        type="button"
        className={`${s.card} ${value === null ? s.emptyCard : ""} ${value !== null && value % 2 === 1 ? s.redCard : ""}`}
        aria-label={
          value === null ? `选择${label}` : `更换${label}：${cardLabel(value)}`
        }
        onClick={onClick}
      >
        {value === null ? (
          <>
            <span className={s.cardPlus}>＋</span>
            <span className={s.cardHint}>{label}</span>
          </>
        ) : (
          <>
            <span className={s.corner}>
              {ranks[Math.floor(value / 4)]}
              <small>{suits[value % 4]}</small>
            </span>
            <span className={s.cardSuit}>{suits[value % 4]}</span>
            <span className={s.cardBottom}>{ranks[Math.floor(value / 4)]}</span>
          </>
        )}
      </button>
      {value !== null && onRemove && (
        <button
          type="button"
          className={s.removeCard}
          onClick={onRemove}
          aria-label={`移除${label}：${cardLabel(value)}`}
        >
          ×
        </button>
      )}
    </div>
  );
}

function CardPicker({
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
            <span className={s.eyebrow}>THE DECK · 52 CARDS</span>
            <h2 id="picker-title">{title}</h2>
          </div>
          <button
            className={s.closeButton}
            onClick={onClose}
            aria-label="关闭选牌器"
          >
            ×
          </button>
        </div>
        <p className={s.helper}>
          已使用的牌不可重复选择。
          {target.group === "dead"
            ? "可连续选择，点击已选死牌可取消。"
            : "选择一张牌后返回牌桌。"}
        </p>
        <div className={s.deck}>
          {suits.map((suit, suitIndex) => (
            <div className={s.suitRow} key={suit}>
              <span
                className={`${s.suitLabel} ${suitIndex % 2 === 1 ? s.red : ""}`}
                aria-label={suitNames[suitIndex]}
              >
                {suit}
              </span>
              <div className={s.rankRow}>
                {Array.from(ranks).map((rank, rankIndex) => {
                  const value = rankIndex * 4 + suitIndex;
                  const selected =
                    target.group === "dead"
                      ? draft.deadCards.includes(value)
                      : current === value;
                  return (
                    <button
                      key={value}
                      className={`${s.deckCard} ${suitIndex % 2 === 1 ? s.red : ""} ${selected ? s.selectedCard : ""}`}
                      disabled={occupied.has(value) && !selected}
                      onClick={() => onSelect(value)}
                      aria-label={cardLabel(value)}
                      aria-pressed={selected}
                    >
                      <span>{rank}</span>
                      <small>{suit}</small>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        <div className={s.pickerFooter}>
          <span>♠ ♣ 为黑色花色 · ♥ ♦ 为红色花色</span>
          <button className={s.textButton} onClick={onClose}>
            完成选牌 →
          </button>
        </div>
      </div>
    </div>
  );
}

function Results({
  result,
  stale,
}: {
  result: AnalysisResult;
  stale: boolean;
}) {
  const error = result.equity_standard_error;
  const equity =
    result.equity === null ? null : Math.max(0, Math.min(1, result.equity));
  const hasProbabilities =
    result.win_probability !== null &&
    result.tie_probability !== null &&
    result.lose_probability !== null;
  return (
    <>
      {stale && (
        <div className={s.stale} role="status">
          牌局已修改，以下为上一次计算结果。请重新计算。
        </div>
      )}
      {equity !== null ? (
        <div className={s.equityArea}>
          <div
            className={s.equityRing}
            style={{ "--equity": `${equity * 100}%` } as CSSProperties}
          >
            <div>
              <span>我的底池权益</span>
              <strong>
                {(equity * 100).toFixed(2)}
                <small>%</small>
              </strong>
              <span>预期分得的底池份额</span>
            </div>
          </div>
          <div className={s.equityCaption}>
            <span className={s.methodBadge}>
              {result.method === "exact" ? "精确枚举" : "蒙特卡洛模拟"}
            </span>
            <span>
              {result.sample_count.toLocaleString("zh-CN")} 个
              {result.method === "exact" ? "状态" : "样本"} ·{" "}
              {(result.elapsed_ms / 1000).toFixed(2)} 秒
            </span>
            {error !== null && result.method !== "exact" && (
              <span>
                近似 95% 抽样误差 ±{(1.96 * error * 100).toFixed(2)} 个百分点
              </span>
            )}
          </div>
        </div>
      ) : (
        <div className={s.noEquity}>
          <span>♠</span>
          <p>此策略未计算摊牌权益</p>
          <small>请根据策略依据与适用条件理解建议。</small>
        </div>
      )}
      {hasProbabilities && (
        <>
          <div className={s.probabilities}>
            {[
              ["独赢", result.win_probability, s.win],
              ["平局", result.tie_probability, s.tie],
              ["输牌", result.lose_probability, s.loss],
            ].map(([label, value, color]) => (
              <div key={String(label)}>
                <span>
                  <i className={String(color)} />
                  {label}
                </span>
                <strong>{percent(Number(value))}</strong>
              </div>
            ))}
          </div>
          <div
            className={s.probabilityBar}
            aria-label={`独赢 ${percent(result.win_probability!)}，平局 ${percent(result.tie_probability!)}，输牌 ${percent(result.lose_probability!)}`}
          >
            <span
              className={s.win}
              style={{ width: `${result.win_probability! * 100}%` }}
            />
            <span
              className={s.tie}
              style={{ width: `${result.tie_probability! * 100}%` }}
            />
            <span
              className={s.loss}
              style={{ width: `${result.lose_probability! * 100}%` }}
            />
          </div>
          <p className={s.resultHint}>
            权益包含平局时分得的份额，因此与独赢概率不同。
          </p>
        </>
      )}
      <div className={s.oddsGrid}>
        <div>
          <span>底池赔率</span>
          <strong>{result.pot_odds_ratio ?? "无需跟注"}</strong>
          <small>当前底池 : 追加跟注额</small>
        </div>
        <div>
          <span>盈亏平衡权益</span>
          <strong>
            {result.break_even_equity === null
              ? "—"
              : percent(result.break_even_equity)}
          </strong>
          <small>跟注额 ÷ 跟注后的底池</small>
        </div>
      </div>
      <div className={s.evBox}>
        <div>
          <span>
            跟注期望收益 <b>EV</b>
          </span>
          <strong
            className={
              result.call_ev !== null && result.call_ev < 0 ? s.red : ""
            }
          >
            {result.call_ev === null
              ? "—"
              : `${result.call_ev > 0 ? "+" : ""}${result.call_ev.toFixed(2)}`}
            <small>{result.call_ev === null ? "" : " 筹码"}</small>
          </strong>
        </div>
        <p>
          {result.recommendation ||
            "此场景不输出行动建议，请结合计算假设理解结果。"}
        </p>
      </div>
      <details className={s.assumptions} open>
        <summary>
          计算假设与适用条件 <span>＋</span>
        </summary>
        <ul>
          {result.assumptions.map((assumption, index) => (
            <li key={index}>{assumption}</li>
          ))}
        </ul>
        <p>
          策略：{result.strategy.name} · v{result.strategy.version}
          。抽样误差不包含对手范围假设带来的不确定性。
        </p>
      </details>
    </>
  );
}

export default function App() {
  const { draft, dispatch } = useScenario();
  const [picker, setPicker] = useState<CardTarget | null>(null);
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [connection, setConnection] = useState<
    "loading" | "online" | "offline"
  >("loading");
  const [connectionAttempt, setConnectionAttempt] = useState(0);
  const [task, setTask] = useState<AnalysisTask | null>(null);
  const [completed, setCompleted] = useState<{
    result: AnalysisResult;
    input: string;
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [networkError, setNetworkError] = useState("");
  const submittedInput = useRef("");
  const fileInput = useRef<HTMLInputElement>(null);
  const fingerprint = JSON.stringify(toRequest(draft));
  const busy = submitting || activeTask(task?.status);
  const patch = (value: Partial<Draft>) => {
    dispatch({ type: "patch", patch: value });
    setErrors([]);
    setMessage("");
  };

  useEffect(() => {
    const controller = new AbortController();
    request<{ strategies: Strategy[] }>("/api/v1/strategies", {
      signal: controller.signal,
    })
      .then((data) => {
        setStrategies(data.strategies);
        setConnection("online");
      })
      .catch(() => {
        if (!controller.signal.aborted) setConnection("offline");
      });
    return () => controller.abort();
  }, [connectionAttempt]);

  useEffect(() => {
    if (!task?.task_id) return;
    const taskId = task.task_id;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    let consecutiveErrors = 0;
    async function poll() {
      try {
        const next = await request<AnalysisTask>(`/api/v1/analyses/${taskId}`, {
          signal: controller.signal,
        });
        if (controller.signal.aborted || stopped) return;
        consecutiveErrors = 0;
        setTask(next);
        setNetworkError("");
        setConnection("online");
        if (next.status === "succeeded" && next.result)
          setCompleted({ result: next.result, input: submittedInput.current });
        if (activeTask(next.status)) timer = setTimeout(poll, 450);
      } catch (error) {
        if (controller.signal.aborted || stopped) return;
        const text = error instanceof Error ? error.message : "查询任务失败。";
        if (
          error instanceof ApiError &&
          (error.status === 404 || error.status === 410)
        ) {
          setTask((previous) =>
            previous
              ? {
                  ...previous,
                  status: "expired",
                  error: "任务已失效，计算服务可能已重启。请重新计算。",
                }
              : previous,
          );
          setNetworkError("");
          return;
        }
        consecutiveErrors += 1;
        if (consecutiveErrors >= 5) {
          setTask((previous) =>
            previous
              ? {
                  ...previous,
                  status: "failed",
                  error:
                    "暂时无法获取任务状态。可重新提交计算；原任务如仍在运行，将按预算自动结束。",
                }
              : previous,
          );
          setNetworkError("");
          return;
        }
        setNetworkError(text);
        timer = setTimeout(poll, 2500);
      }
    }
    void poll();
    return () => {
      stopped = true;
      controller.abort();
      clearTimeout(timer);
    };
    // Polling lifecycle belongs to the task id; incoming progress must not restart it.
  }, [task?.task_id]);

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
        return { kind: "exact" as const, cards };
      });
      patch({ opponents });
    }
    setPicker(null);
  }

  async function calculate() {
    const validation = validateDraft(draft);
    if (validation.length) {
      setErrors(validation);
      return;
    }
    setSubmitting(true);
    setErrors([]);
    setMessage("");
    setNetworkError("");
    submittedInput.current = fingerprint;
    try {
      const created = await request<TaskCreated>("/api/v1/analyses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toRequest(draft)),
      });
      setTask({
        ...created,
        progress: 0,
        completed_samples: 0,
        total_samples: draft.samples,
        result: null,
        error: null,
      });
    } catch (error) {
      setErrors([
        error instanceof Error ? error.message : "提交失败，请稍后重试。",
      ]);
    } finally {
      setSubmitting(false);
    }
  }

  async function cancel() {
    if (!task) return;
    try {
      await request(`/api/v1/analyses/${task.task_id}/cancel`, {
        method: "POST",
      });
      setTask((previous) =>
        previous && activeTask(previous.status)
          ? { ...previous, status: "cancelling" }
          : previous,
      );
    } catch (error) {
      setErrors([error instanceof Error ? error.message : "取消失败。"]);
    }
  }

  function exportScene() {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify({ schemaVersion: 1, draft }, null, 2)], {
        type: "application/json",
      }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "holdem-scenario.json";
    anchor.click();
    URL.revokeObjectURL(url);
    setMessage("牌局已导出，可在下次分析时重新导入。");
  }
  async function importScene(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      if (file.size > 128 * 1024) throw new Error("牌局文件应小于 128 KB。");
      const scene = parseSaved(await file.text());
      dispatch({ type: "replace", draft: scene });
      setErrors([]);
      setMessage("已导入牌局。");
    } catch (error) {
      setErrors([
        error instanceof Error &&
        !(error instanceof SyntaxError) &&
        !("issues" in error)
          ? error.message
          : "文件格式不正确，请导入由本应用导出的 JSON 牌局。",
      ]);
    }
  }

  function reset(example: boolean) {
    dispatch({
      type: "replace",
      draft: example ? exampleDraft() : emptyDraft(),
    });
    setErrors([]);
    setMessage(
      example ? "已载入同花顺听牌示例，点击计算查看结果。" : "已重置牌局。",
    );
  }

  return (
    <div className={s.app}>
      <header className={s.header}>
        <a href="#" className={s.brand} aria-label="河牌实验室首页">
          <span className={s.brandIcon}>♠</span>
          <span>
            河牌实验室<small>RIVER LAB</small>
          </span>
        </a>
        <div className={s.headerRight}>
          <span className={s.version}>HOLD’EM / v0.1</span>
          <button
            className={s.connection}
            onClick={() => {
              setConnection("loading");
              setConnectionAttempt((value) => value + 1);
            }}
            title="点击重新检查计算服务"
          >
            <i
              className={
                connection === "online"
                  ? s.online
                  : connection === "loading"
                    ? s.connecting
                    : s.offline
              }
            />
            {connection === "online"
              ? "计算服务已连接"
              : connection === "loading"
                ? "连接计算服务"
                : "服务未连接 · 重试"}
          </button>
        </div>
      </header>
      <main className={s.main}>
        <section className={s.intro}>
          <div>
            <p className={s.eyebrow}>TEXAS HOLD’EM · EQUITY & ODDS</p>
            <h1>
              每一次决策，<span>都有依据。</span>
            </h1>
            <p className={s.introText}>
              还原你的牌局，计算摊牌权益与跟注成本。
            </p>
          </div>
          <div className={s.introNote}>
            <span>01 — 配置牌局</span>
            <span>02 — 选择策略</span>
            <span>03 — 理解结果</span>
          </div>
        </section>
        <div className={s.workspace}>
          <section className={s.inputPanel} aria-label="牌局设置">
            <div className={s.panelHeading}>
              <div>
                <span className={s.eyebrow}>THE SCENARIO</span>
                <h2>构建你的牌局</h2>
              </div>
              <button className={s.exampleButton} onClick={() => reset(true)}>
                载入示例 ↗
              </button>
            </div>
            <section className={s.section}>
              <div className={s.sectionHeading}>
                <h3>
                  <span>01</span> 我的手牌
                </h3>
                <span className={s.sectionMeta}>仅对你可见</span>
              </div>
              <div className={s.heroRow}>
                <div className={s.cards}>
                  {draft.hero.map((card, index) => (
                    <Card
                      key={index}
                      value={card}
                      label={`手牌 ${index + 1}`}
                      onClick={() => setPicker({ group: "hero", index })}
                      onRemove={() => {
                        const hero = [...draft.hero] as Draft["hero"];
                        hero[index] = null;
                        patch({ hero });
                      }}
                    />
                  ))}
                </div>
                <div className={s.heroNote}>
                  <span className={s.noteSuit}>♠</span>
                  <p>
                    点击牌面选择手牌
                    <br />
                    <small>已使用的牌自动排除</small>
                  </p>
                </div>
              </div>
            </section>
            <section className={s.section}>
              <div className={s.sectionHeading}>
                <h3>
                  <span>02</span> 公共牌
                </h3>
                <span className={s.sectionMeta}>
                  {["翻前", "", "", "翻牌", "转牌", "河牌"][draft.boardSize]}
                </span>
              </div>
              <div className={s.segmented} aria-label="选择牌局阶段">
                {(
                  [
                    { size: 0, label: "翻前" },
                    { size: 3, label: "翻牌" },
                    { size: 4, label: "转牌" },
                    { size: 5, label: "河牌" },
                  ] as const
                ).map((stage) => (
                  <button
                    key={stage.size}
                    aria-pressed={draft.boardSize === stage.size}
                    className={
                      draft.boardSize === stage.size ? s.segmentActive : ""
                    }
                    onClick={() =>
                      patch({
                        boardSize: stage.size,
                        board: draft.board.slice(0, stage.size),
                      })
                    }
                  >
                    {stage.label}
                    <small>{stage.size === 0 ? "—" : `${stage.size} 张`}</small>
                  </button>
                ))}
              </div>
              <div className={`${s.cards} ${s.boardCards}`}>
                {Array.from({ length: 5 }, (_, index) =>
                  index < draft.boardSize ? (
                    <Card
                      key={index}
                      small
                      value={draft.board[index] ?? null}
                      label={
                        index < 3
                          ? `翻牌 ${index + 1}`
                          : index === 3
                            ? "转牌"
                            : "河牌"
                      }
                      onClick={() =>
                        setPicker({
                          group: "board",
                          index: Math.min(index, draft.board.length),
                        })
                      }
                      onRemove={() =>
                        patch({
                          board: draft.board.filter((_, i) => i !== index),
                        })
                      }
                    />
                  ) : (
                    <div key={index} className={s.unrevealed}>
                      <span>♠</span>
                      <small>
                        {index < 3 ? "FLOP" : index === 3 ? "TURN" : "RIVER"}
                      </small>
                    </div>
                  ),
                )}
              </div>
            </section>
            <section className={s.section}>
              <div className={s.sectionHeading}>
                <h3>
                  <span>03</span> 对手设置
                </h3>
                <span className={s.sectionMeta}>
                  含我共 {draft.opponents.length + 1} 人
                </span>
              </div>
              <div className={s.playerCount}>
                <label htmlFor="opponent-count">在局对手</label>
                <div>
                  <button
                    onClick={() =>
                      patch({ opponents: draft.opponents.slice(0, -1) })
                    }
                    disabled={draft.opponents.length <= 1}
                    aria-label="减少一名对手"
                  >
                    −
                  </button>
                  <output id="opponent-count">{draft.opponents.length}</output>
                  <button
                    onClick={() =>
                      patch({
                        opponents: [...draft.opponents, { kind: "random" }],
                      })
                    }
                    disabled={draft.opponents.length >= 8}
                    aria-label="增加一名对手"
                  >
                    ＋
                  </button>
                </div>
              </div>
              <div className={s.opponents}>
                {draft.opponents.map((opponent, player) => (
                  <div className={s.opponent} key={player}>
                    <div className={s.opponentLine}>
                      <span>
                        <i>{String(player + 1).padStart(2, "0")}</i> 对手{" "}
                        {player + 1}
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
                                  ? { kind: "random" }
                                  : { kind: "exact", cards: [null, null] },
                            ),
                          })
                        }
                      >
                        <option value="random">随机手牌</option>
                        <option value="exact">指定手牌</option>
                      </select>
                    </div>
                    {opponent.kind === "exact" && (
                      <div className={`${s.cards} ${s.opponentCards}`}>
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
                                  if (i !== player || o.kind !== "exact")
                                    return o;
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
              <p className={s.helper}>
                随机手牌对所有合法组合等概率取样；不从下注金额推断对手范围。
              </p>
              <details className={s.deadDetails}>
                <summary>
                  已知死牌 <span>{draft.deadCards.length} 张</span>
                </summary>
                <p className={s.helper}>
                  仅添加明确知道且不会再出现的牌。未知弃牌无需填写。
                </p>
                <div className={s.deadCards}>
                  {draft.deadCards.map((card) => (
                    <button
                      key={card}
                      className={card % 2 === 1 ? s.red : ""}
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
            </section>
            <section className={s.section}>
              <div className={s.sectionHeading}>
                <h3>
                  <span>04</span> 底池与策略
                </h3>
                <span className={s.sectionMeta}>单底池 · 无抽水</span>
              </div>
              <div className={s.moneyGrid}>
                <label>
                  当前底池 <span>P</span>
                  <div>
                    <input
                      inputMode="numeric"
                      value={draft.pot}
                      onChange={(event) => patch({ pot: event.target.value })}
                      aria-label="当前底池"
                    />
                    <small>筹码</small>
                  </div>
                </label>
                <label>
                  需要跟注 <span>C</span>
                  <div>
                    <input
                      inputMode="numeric"
                      value={draft.call}
                      onChange={(event) => patch({ call: event.target.value })}
                      aria-label="需要跟注"
                    />
                    <small>筹码</small>
                  </div>
                </label>
              </div>
              <p className={s.helper}>
                底池包含对手当前下注，不包含你这次需要追加的跟注额。
              </p>
              <label className={s.checkbox}>
                <input
                  type="checkbox"
                  checked={!draft.futureBetting}
                  onChange={(event) =>
                    patch({ futureBetting: !event.target.checked })
                  }
                />
                <span>跟注后直接摊牌，后续无需追加筹码</span>
              </label>
              {draft.futureBetting && (
                <p className={s.caution}>
                  后续仍可下注：EV 仅作“无后续投入”假设下的参考。
                </p>
              )}
              <div className={s.field}>
                <label htmlFor="strategy">分析策略</label>
                <select
                  id="strategy"
                  value={draft.strategyId}
                  onChange={(event) =>
                    patch({ strategyId: event.target.value })
                  }
                >
                  {strategies.length ? (
                    strategies.map((strategy) => (
                      <option key={strategy.id} value={strategy.id}>
                        {strategy.name}
                      </option>
                    ))
                  ) : (
                    <option value="pot-odds">
                      底池赔率基线 · 等待服务连接
                    </option>
                  )}
                  {strategies.length > 0 &&
                    !strategies.some(
                      (strategy) => strategy.id === draft.strategyId,
                    ) && (
                      <option value={draft.strategyId}>
                        不可用策略：{draft.strategyId}
                      </option>
                    )}
                </select>
                <p className={s.helper}>
                  {strategies.find(
                    (strategy) => strategy.id === draft.strategyId,
                  )?.description ||
                    "基于摊牌权益与跟注成本分析，更多策略将通过插件接入。"}
                </p>
              </div>
              <div className={s.computeSettings}>
                <label htmlFor="samples">模拟精度</label>
                <select
                  id="samples"
                  value={draft.samples}
                  onChange={(event) =>
                    patch({
                      samples: Number(event.target.value) as Draft["samples"],
                    })
                  }
                >
                  <option value="10000">快速 · 10,000 次</option>
                  <option value="50000">标准 · 50,000 次</option>
                  <option value="100000">精细 · 100,000 次</option>
                </select>
                <span>小规模状态自动精确枚举</span>
              </div>
            </section>
            <div className={s.inputActions}>
              {errors.length > 0 && (
                <div className={s.errorBox} role="alert">
                  {errors.map((error) => (
                    <p key={error}>{error}</p>
                  ))}
                </div>
              )}
              {message && (
                <p className={s.message} role="status">
                  {message}
                </p>
              )}
              <button
                className={s.calculateButton}
                disabled={busy}
                onClick={() => void calculate()}
              >
                <span>{busy ? "计算任务进行中" : "计算当前牌局"}</span>
                <span>{busy ? "◌" : "→"}</span>
              </button>
              <div className={s.scenarioTools}>
                <span>◦ 牌局自动保存在此浏览器</span>
                <div>
                  <button onClick={() => reset(false)}>重置</button>
                  <button onClick={() => fileInput.current?.click()}>
                    导入
                  </button>
                  <button onClick={exportScene}>导出</button>
                </div>
              </div>
              <input
                ref={fileInput}
                type="file"
                accept="application/json,.json"
                hidden
                onChange={(event) => void importScene(event)}
              />
            </div>
          </section>
          <aside className={s.resultColumn}>
            <section
              className={s.resultPanel}
              aria-label="计算结果"
              aria-busy={busy}
            >
              <div className={s.resultHeading}>
                <div>
                  <span className={s.eyebrow}>THE ANALYSIS</span>
                  <h2>牌局分析</h2>
                </div>
                <span className={s.liveBadge}>
                  <i />
                  {busy ? "计算中" : completed ? "已计算" : "等待计算"}
                </span>
              </div>
              {task && (
                <div className={s.taskProgress} role="status">
                  <div>
                    <span>{statusText[task.status]}</span>
                    {activeTask(task.status) && (
                      <button
                        onClick={() => void cancel()}
                        disabled={task.status === "cancelling"}
                      >
                        {task.status === "cancelling" ? "取消中…" : "取消任务"}
                      </button>
                    )}
                  </div>
                  {activeTask(task.status) && (
                    <>
                      <progress
                        max="1"
                        value={Math.max(0, Math.min(1, task.progress))}
                      />
                      <small>
                        {Math.round(task.progress * 100)}% ·{" "}
                        {task.completed_samples.toLocaleString("zh-CN")} /{" "}
                        {task.total_samples.toLocaleString("zh-CN")}
                      </small>
                    </>
                  )}
                  {task.error && <p className={s.red}>{task.error}</p>}
                  {networkError && (
                    <p className={s.red}>{networkError} 正在重连…</p>
                  )}
                  {busy && submittedInput.current !== fingerprint && (
                    <p className={s.caution}>
                      输入已修改，此任务仍在计算提交时的牌局。
                    </p>
                  )}
                </div>
              )}
              {completed ? (
                <Results
                  result={completed.result}
                  stale={completed.input !== fingerprint}
                />
              ) : (
                <div className={s.emptyResult}>
                  <div className={s.emptyIllustration}>
                    <span>♠</span>
                    <i />
                    <i />
                  </div>
                  <h3>先选好你的牌</h3>
                  <p>
                    填入手牌、公共牌与底池信息，
                    <br />
                    让每个概率都有清晰的来处。
                  </p>
                  <div className={s.emptyMetrics}>
                    <div>
                      <span>底池权益</span>
                      <strong>
                        — <small>%</small>
                      </strong>
                    </div>
                    <div>
                      <span>跟注 EV</span>
                      <strong>—</strong>
                    </div>
                  </div>
                  <button className={s.textButton} onClick={() => reset(true)}>
                    用一个示例牌局开始 →
                  </button>
                </div>
              )}
            </section>
            <section className={s.readingNote}>
              <span>♣</span>
              <div>
                <h3>读懂概率，也读懂假设。</h3>
                <p>
                  胜率取决于已知牌和对手范围。赔率衡量跟注的成本，不能单独决定后续所有行动。
                </p>
                <p>当前支持单底池筹码分析；边池、抽水与锦标赛 ICM 尚未纳入。</p>
              </div>
            </section>
            <div className={s.systemNote}>
              <span>52 张牌</span>
              <i />
              <span>2–9 人</span>
              <i />
              <span>标准德州扑克</span>
            </div>
          </aside>
        </div>
        <footer className={s.footer}>
          <span>
            河牌实验室 <b>RIVER LAB</b>
          </span>
          <span>用于学习与复盘 · 结果取决于输入与模型假设</span>
        </footer>
      </main>
      {picker && (
        <CardPicker
          draft={draft}
          target={picker}
          onSelect={setCard}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  );
}
