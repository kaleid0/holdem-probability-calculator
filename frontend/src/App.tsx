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
import Comparison from "./Comparison";
import LiveTable from "./LiveTable";
import TableSettings from "./TableSettings";
import AnalysisSettings from "./AnalysisSettings";
import OpponentSettings from "./OpponentSettings";

type CardTarget =
  | { group: "hero" | "board" | "dead"; index: number }
  | { group: "opponent"; index: number; player: number };
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

export function Card({
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
        disabled={!onClick}
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
            <span className={s.eyebrow}>THE DECK · 52 CARDS</span>
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
        <p className={s.helper}>
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
              className={`${s.suitTab} ${suitIndex % 2 === 1 ? s.red : ""} ${activeSuit === suitIndex ? s.activeSuit : ""}`}
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
                    className={`${s.deckCard} ${activeSuit % 2 === 1 ? s.red : ""} ${selected ? s.selectedCard : ""}`}
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
              <strong aria-label="底池权益百分比">
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
            跟注参考收益 <b>EV</b>
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
      {(result.signals?.length ?? 0) > 0 && (
        <div className={s.signals}>
          <h3>规则触发依据</h3>
          <ul>
            {result.signals?.map((signal, index) => (
              <li key={index}>{signal}</li>
            ))}
          </ul>
        </div>
      )}
      {(result.candidates?.length ?? 0) > 0 && (
        <div className={s.candidates}>
          <h3>候选动作 · 同一摊牌假设</h3>
          <table>
            <thead>
              <tr>
                <th>动作</th>
                <th>追加筹码</th>
                <th>参考 EV</th>
              </tr>
            </thead>
            <tbody>
              {result.candidates?.map((item) => (
                <tr key={item.action}>
                  <td>{item.action === "fold" ? "弃牌" : "跟注"}</td>
                  <td>{item.amount ?? "—"}</td>
                  <td>
                    {item.ev === null || item.ev === undefined
                      ? "未提供"
                      : item.ev.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className={s.helper}>
            单位：筹码；基准：此刻弃牌。跟注参考值不包含后续投入。
          </p>
        </div>
      )}
      <details className={s.assumptions}>
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
          。模型版本：{result.model_version}。抽样误差不包含范围假设的不确定性。
          配置：{JSON.stringify(result.strategy_config ?? {})}
        </p>
      </details>
    </>
  );
}

export default function App() {
  const [mode, setMode] = useState<"snapshot" | "live">("snapshot");
  const { draft, dispatch, game } = useScenario();
  const [picker, setPicker] = useState<CardTarget | null>(null);
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [connection, setConnection] = useState<
    "loading" | "online" | "offline"
  >("loading");
  const [connectionAttempt, setConnectionAttempt] = useState(0);
  const [task, setTask] = useState<AnalysisTask | null>(null);
  const [completed, setCompleted] = useState<{
    result: AnalysisResult;
    outcomes: NonNullable<AnalysisTask["outcomes"]>;
    input: string;
  } | null>(null);
  const [activeStrategy, setActiveStrategy] = useState("pot-odds");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [networkError, setNetworkError] = useState("");
  const submittedInput = useRef("");
  const fileInput = useRef<HTMLInputElement>(null);
  const resultPanel = useRef<HTMLElement>(null);
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
        if (!activeTask(next.status) && next.result) {
          setCompleted({
            result: next.result,
            outcomes: next.outcomes ?? [],
            input: submittedInput.current,
          });
          setActiveStrategy(next.result.strategy.id);
        }
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

  async function calculate(scene: Draft = draft) {
    if (busy) return;
    if (game?.folded[0]) {
      setErrors(["你已弃牌，本手不再参与底池权益分析。"]);
      return;
    }
    const validation = validateDraft(scene);
    if (validation.length) {
      setErrors(validation);
      return;
    }
    setSubmitting(true);
    setErrors([]);
    setMessage("");
    setNetworkError("");
    submittedInput.current = JSON.stringify(toRequest(scene));
    requestAnimationFrame(() =>
      resultPanel.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      }),
    );
    try {
      const created = await request<TaskCreated>("/api/v1/analyses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toRequest(scene)),
      });
      setTask({
        ...created,
        progress: 0,
        completed_samples: 0,
        total_samples: scene.samples,
        result: null,
        error: null,
        completion: "none",
        outcomes: [],
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
      new Blob([JSON.stringify({ schemaVersion: 3, draft }, null, 2)], {
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
      draft: {
        ...(example ? exampleDraft() : emptyDraft()),
        table: draft.table,
        opponents: draft.opponents.map(() => ({ kind: "random" as const })),
      },
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
          <span className={s.version}>HOLD’EM / v0.2</span>
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
            <h1>
              还原牌局，<span>看清胜算。</span>
            </h1>
          </div>
        </section>
        <TableSettings />
        <div className={s.modeSwitch} role="group" aria-label="牌局交互模式">
          <button
            aria-pressed={mode === "snapshot"}
            onClick={() => setMode("snapshot")}
          >
            局面录入 <small>直接填写当前状态</small>
          </button>
          <button
            aria-pressed={mode === "live"}
            onClick={() => setMode("live")}
          >
            逐步记录 <small>按发牌与下注顺序推进</small>
          </button>
        </div>
        <div className={s.workspace}>
          <div style={{ display: mode === "live" ? undefined : "none" }}>
            <LiveTable
              CardView={Card}
              Picker={CardPicker}
              analyzing={busy}
              onAnalyze={(scene) => {
                if (busy) return;
                setErrors([]);
                void calculate(scene);
              }}
            />
          </div>
          <section
            className={s.inputPanel}
            aria-label="牌局设置"
            style={{ display: mode === "snapshot" ? undefined : "none" }}
          >
            <div className={s.panelHeading}>
              <div>
                <h2>当前局面</h2>
              </div>
              <button className={s.exampleButton} onClick={() => reset(true)}>
                载入示例 ↗
              </button>
            </div>
            {game && (
              <p className={s.caution}>
                当前与逐步记录共用同一手牌。直接修改牌面、阶段或底池后，行动历史将不再适用。
              </p>
            )}
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
                    aria-label={`${stage.label}${stage.size ? ` ${stage.size} 张` : ""}`}
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
                {Array.from({ length: draft.boardSize }, (_, index) => (
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
                ))}
              </div>
            </section>
            <section className={s.section}>
              <div className={s.sectionHeading}>
                <h3>
                  <span>03</span> 底池与跟注
                </h3>
                <span className={s.sectionMeta}>单底池 · 无抽水</span>
              </div>
              <div className={s.moneyGrid}>
                <label>
                  当前底池
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
                  需要跟注
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
                底池包含桌面上已投入的筹码；无需跟注时填 0。
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
              <details className={s.optionalSettings}>
                <summary>
                  牌局工具 <span>自动保存 · 导入 / 导出</span>
                </summary>
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
              </details>
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
            <div className={s.resultPanel}>
              <OpponentSettings CardView={Card} onPick={setPicker} />
            </div>
            <AnalysisSettings strategies={strategies} />
            {mode === "live" && (
              <div className={s.inputActions}>
                {errors.length > 0 && (
                  <div className={s.errorBox} role="alert">
                    {errors.map((error) => (
                      <p key={error}>{error}</p>
                    ))}
                  </div>
                )}
                {message && <p role="status">{message}</p>}
                <div className={s.scenarioTools}>
                  <button onClick={exportScene}>导出当前局面</button>
                </div>
              </div>
            )}
            <section
              ref={resultPanel}
              className={s.resultPanel}
              aria-label="计算结果"
              aria-busy={busy}
            >
              <div className={s.resultHeading}>
                <div>
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
                    <span>
                      {statusText[task.status]}
                      {task.completion === "partial" ? " · 部分策略已完成" : ""}
                    </span>
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
                        {Math.round(task.progress * 100)}% ·
                        所有策略共享计算预算
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
              <Comparison
                strategies={strategies}
                outcomes={
                  task?.outcomes?.length
                    ? task.outcomes
                    : (completed?.outcomes ?? [])
                }
                active={activeStrategy}
                onSelect={setActiveStrategy}
              />
              {completed ? (
                <Results
                  result={
                    completed.outcomes.find(
                      (item) => item.strategy_id === activeStrategy,
                    )?.result ?? completed.result
                  }
                  stale={completed.input !== fingerprint}
                />
              ) : (
                <div className={s.emptyResult}>
                  <h3>选好手牌，就可以开始</h3>
                  <p>填写当前局面，点击“计算当前牌局”查看权益与跟注成本。</p>
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
                </div>
              )}
            </section>
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
