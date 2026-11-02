import { useEffect, useState } from "react";
import { useScenario } from "../../state";
import { cardLabel } from "../../model";
import {
  expandClass,
  handClass,
  matrixLabel,
  serializeCombos,
} from "../../ranges";
import {
  defaultScenarios,
  downloadSensitivity,
  sensitivityRequest,
} from "../../sensitivity";
import type { Scenario, SensitivityRequest } from "../../sensitivity";
import { useSensitivity } from "./useSensitivity";
import s from "./SensitivityPanel.module.css";
import ui from "../../shared/ui/Shared.module.css";

const archiveKey = "river-lab:sensitivity:last:v1";
const labels: Record<string, string> = {
  ok: "完成",
  "insufficient-data": "输入不足",
  unsupported: "不支持",
  error: "失败",
  "timed-out": "超时",
  cancelled: "已取消",
  queued: "排队中",
  running: "计算中",
  cancelling: "取消中",
  succeeded: "计算完成",
  failed: "计算失败",
  expired: "任务失效",
  check: "过牌",
  call: "跟注",
  bet: "下注",
  raise: "加注",
  fold: "弃牌",
};
const pct = (v?: number | null) =>
  v == null ? "—" : `${(v * 100).toFixed(2)}%`;
const delta = (v?: number | null) =>
  v == null ? "—" : `${v > 0 ? "+" : ""}${(v * 100).toFixed(2)} pp`;
const money = (v?: number | null) => (v == null ? "未提供" : v.toFixed(2));
const composition = (c: Record<string, number>) =>
  `价值 ${pct(c.value)} / 听牌 ${pct(c.draw)} / 其他 ${pct(c.other)}`;

function archiveInput(text: string): SensitivityRequest {
  const value = JSON.parse(text) as {
    schemaVersion?: unknown;
    input?: SensitivityRequest;
  };
  if (
    value.schemaVersion !== 1 ||
    !value.input ||
    value.input.model_version !== "history-rules-v1" ||
    !value.input.base_analysis ||
    !Array.isArray(value.input.scenarios)
  )
    throw new Error(
      "不支持的敏感性分析存档版本。旧结果可保留为历史记录，请使用兼容版本重算。",
    );
  // Imported requests are revalidated by the server; imported results are never trusted/rendered.
  return value.input;
}

export default function SensitivityPanel() {
  const { draft, game, dispatch } = useScenario();
  const [mode, setMode] = useState<"history" | "manual">("history");
  const [target, setTarget] = useState(1);
  const [prior, setPrior] = useState("");
  const [scenarios, setScenarios] = useState<Scenario[]>(defaultScenarios);
  const [ranges, setRanges] = useState([
    "TT+,AQs+,AKo",
    "QQ+,AKs",
    "88+,ATs+,KQs,AJo+",
  ]);
  const analysis = useSensitivity();
  const { task, error, setError, submitted, calculate, cancel, busy } =
    analysis;
  const fingerprint = JSON.stringify({
    draft,
    game,
    target,
    mode,
    prior,
    scenarios,
    ranges,
  });
  const stale =
    !!task?.result && submitted.current?.fingerprint !== fingerprint;
  const result = task?.result;
  const snapshot = submitted.current;
  useEffect(() => {
    if (result && snapshot) {
      try {
        localStorage.setItem(
          archiveKey,
          JSON.stringify({ schemaVersion: 1, input: snapshot.input, result }),
        );
      } catch {
        /* Analysis remains usable if browser storage is full. */
      }
    }
  }, [result, snapshot]);
  async function run() {
    try {
      const configured = scenarios.map((scene, i) => ({
        ...scene,
        current_range:
          mode === "manual"
            ? { kind: "range" as const, text: ranges[i] }
            : null,
      }));
      await calculate(
        sensitivityRequest(draft, game, target, mode, prior, configured),
        fingerprint,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "输入不完整");
    }
  }
  async function restore(text: string) {
    try {
      await calculate(archiveInput(text), "imported-snapshot");
    } catch (e) {
      setError(e instanceof Error ? e.message : "存档格式错误");
    }
  }
  const available = draft.opponents.flatMap((o, i) =>
    !o.folded && o.kind !== "exact" ? [i + 1] : [],
  );
  return (
    <section className={s.panel} aria-label="范围敏感性分析" aria-busy={busy}>
      <h3>范围敏感性分析</h3>
      <p className={ui.helper}>
        根据本手行动推断范围，比较不同价值牌与诈唬假设。启发式模型尚未经过真实牌局校准。
      </p>
      <div className={s.controls}>
        <label>
          目标对手
          <select
            aria-label="敏感性目标对手"
            value={target}
            onChange={(e) => setTarget(Number(e.target.value))}
          >
            {!available.includes(target) && (
              <option value={target}>请选择在局对手</option>
            )}
            {available.map((seat) => (
              <option key={seat} value={seat}>
                对手 {seat}（玩家 {seat + 1}）
              </option>
            ))}
          </select>
        </label>
        <label>
          分析方式
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as typeof mode)}
          >
            <option value="history">根据本手行动自动推断</option>
            <option value="manual">手动比较当前范围</option>
          </select>
        </label>
      </div>
      {mode === "history" ? (
        <>
          <p className={ui.helper}>
            历史：
            {game?.historyComplete
              ? `${game.events.length} 个事件 · 当前公共牌 ${game.street} 张`
              : "缺少完整记录，请使用逐步记录模式新开一手"}
            。仅使用截止当前的行动。
          </p>
          <label>
            翻前先验（留空表示全组合等权）
            <textarea
              aria-label="翻前先验"
              value={prior}
              maxLength={65536}
              placeholder="例如 TT+,AQs+,AKo；不要粘贴已经按本手行动调整过的当前范围"
              onChange={(e) => setPrior(e.target.value)}
            />
          </label>
          <p className={ui.helper}>
            默认不读取对手编辑器的当前范围。模型：history-rules-v1。各场景从同一先验重新推断。
          </p>
        </>
      ) : (
        <p className={ui.helper}>
          直接使用下方当前范围，不应用任何行动历史。适用于局面录入和历史不完整的牌局。
        </p>
      )}
      <div className={s.controls}>
        {scenarios.map((scene, i) => (
          <label key={scene.id}>
            {scene.name}
            {mode === "history" ? " · 诈唬偏置" : " · 当前范围"}
            {mode === "history" ? (
              <input
                type="number"
                aria-label={`${scene.name}诈唬偏置`}
                min={-3}
                max={3}
                step={0.1}
                value={scene.bluff_bias ?? 0}
                onChange={(e) => {
                  const bias = Number(e.target.value);
                  if (Number.isFinite(bias))
                    setScenarios((old) =>
                      old.map((item, n) =>
                        n === i ? { ...item, bluff_bias: bias } : item,
                      ),
                    );
                }}
              />
            ) : (
              <textarea
                aria-label={`${scene.name}当前范围`}
                maxLength={65536}
                value={ranges[i]}
                onChange={(e) =>
                  setRanges((old) =>
                    old.map((item, n) => (n === i ? e.target.value : item)),
                  )
                }
              />
            )}
          </label>
        ))}
      </div>
      <p className={ui.helper}>
        每场景目标 {draft.samples.toLocaleString()}{" "}
        个样本；三个场景共享后端总时限。参数修改后重新计算，不自动覆盖原范围。
      </p>
      <div className={s.actions}>
        <button
          className={ui.calculateButton}
          disabled={busy || !available.includes(target)}
          onClick={() => void run()}
        >
          {busy ? "敏感性分析进行中" : "执行范围敏感性分析"}
        </button>
        {busy && task && (
          <button
            onClick={() => void cancel()}
            disabled={task.status === "cancelling"}
          >
            取消敏感性任务
          </button>
        )}
        <button
          disabled={busy}
          onClick={() => {
            try {
              const saved = localStorage.getItem(archiveKey);
              if (!saved) throw new Error("尚无已保存分析。");
              void restore(saved);
            } catch (e) {
              setError(e instanceof Error ? e.message : "无法恢复存档");
            }
          }}
        >
          恢复上次分析并重算
        </button>
      </div>
      <label className={s.file}>
        导入分析快照并重算{" "}
        <input
          type="file"
          accept="application/json,.json"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            if (file.size > 2 * 1024 * 1024) {
              setError("分析存档不能超过 2 MB。");
              return;
            }
            void file
              .text()
              .then(restore)
              .catch(() => setError("读取分析存档失败"));
          }}
        />
      </label>
      {error && (
        <p role="alert" className={s.error}>
          {error}
        </p>
      )}
      {task && (
        <p role="status">
          {labels[task.status]} · {Math.round(task.progress * 100)}%
          {task.completion === "partial" ? " · 部分完成" : ""}
          {task.error ? ` · ${task.error}` : ""}
        </p>
      )}
      {busy && submitted.current?.fingerprint !== fingerprint && (
        <p className={ui.caution}>输入已修改，正在计算提交时的牌局快照。</p>
      )}
      {result && (
        <>
          {stale && (
            <p className={ui.caution}>
              历史快照：当前输入已变化或结果来自导入，请重新分析当前牌局。此结果不能应用到当前对手。
            </p>
          )}
          <p>
            目标：玩家 {result.target_seat + 1} · {result.prior_source} ·{" "}
            {result.model_version} · {result.elapsed_ms.toFixed(0)} ms
          </p>
          <p>{result.summary}</p>
          <button
            disabled={
              busy || stale || result.outcomes.some((o) => o.status !== "ok")
            }
            onClick={() => {
              setMode("manual");
              setTarget(result.target_seat);
              setScenarios(
                result.outcomes.map((o) => ({
                  id: o.id,
                  name: o.name,
                  bluff_bias: o.bluff_bias,
                })),
              );
              setRanges(
                result.outcomes.map((o) => serializeCombos(o.combos ?? [])),
              );
            }}
          >
            编辑已推断场景的当前范围
          </button>
          <div className={s.scroll}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th>场景</th>
                  <th>有效组合</th>
                  <th>权益 ± 标准误</th>
                  <th>较基准</th>
                  <th>跟注 EV / 差值（筹码）</th>
                  <th>状态</th>
                </tr>
              </thead>
              <tbody>
                {result.outcomes.map((o) => (
                  <tr key={o.id}>
                    <td>{o.name}</td>
                    <td>{o.combos?.length ?? 0}</td>
                    <td>
                      {pct(o.result?.equity)} ±{" "}
                      {pct(o.result?.equity_standard_error)}
                    </td>
                    <td>{delta(o.equity_delta)}</td>
                    <td>
                      {money(o.result?.call_ev)} / {money(o.ev_delta)}
                    </td>
                    <td>{labels[o.status]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {result.outcomes.map((o) => {
            const totals = new Map<string, number>();
            for (const c of o.combos ?? [])
              totals.set(
                handClass(c.cards),
                (totals.get(handClass(c.cards)) ?? 0) + c.weight,
              );
            return (
              <details key={o.id}>
                <summary>
                  {o.name}：范围与推断依据
                  {o.bluff_bias ? `（诈唬偏置 ${o.bluff_bias}）` : ""}
                </summary>
                {o.reasons?.map((reason) => (
                  <p className={s.error} key={reason}>
                    {reason}
                  </p>
                ))}
                <p>
                  {composition(o.composition ?? {})}
                  。按具体组合归一化质量统计；价值/听牌为模型粗分类。
                </p>
                <p className={ui.helper}>
                  矩阵颜色表示类内平均相对权重，包含阻断后的零权重组合；悬停查看具体值。逐组合权重保留花色差异。
                </p>
                <div className={s.matrix} aria-label={`${o.name}范围矩阵`}>
                  {Array.from({ length: 169 }, (_, i) => {
                    const name = matrixLabel(Math.floor(i / 13), i % 13);
                    const average =
                      (totals.get(name) ?? 0) / expandClass(name).length;
                    return (
                      <span
                        key={name}
                        title={`${name}：平均相对权重 ${average.toFixed(6)}`}
                        style={{
                          background: `rgba(91,183,136,${0.05 + average * 0.8})`,
                        }}
                      >
                        {name}
                      </span>
                    );
                  })}
                </div>
                <details>
                  <summary>查看具体组合（{o.combos?.length ?? 0}）</summary>
                  <div className={s.combos}>
                    {o.combos?.map((c) => (
                      <div key={c.cards.join(",")}>
                        {c.cards.map(cardLabel).join(" / ")}：
                        {c.weight.toPrecision(8)}
                      </div>
                    ))}
                  </div>
                </details>
                {o.traces?.map((trace) => (
                  <div className={s.trace} key={trace.sequence}>
                    <strong>
                      #{trace.sequence} ·{" "}
                      {trace.street === 0 ? "翻前" : `${trace.street} 张公共牌`}{" "}
                      · {labels[trace.action] ?? trace.action}
                    </strong>
                    <p>
                      {trace.board.map(cardLabel).join(" / ") || "无公共牌"} ·{" "}
                      {trace.context}
                    </p>
                    <p>
                      更新前：{composition(trace.before)}
                      <br />
                      更新后：{composition(trace.after)}
                    </p>
                    <small>规则：{trace.rule_id}</small>
                  </div>
                ))}
                {o.result && (
                  <p className={ui.helper}>
                    {o.result.method === "exact"
                      ? "精确枚举"
                      : `蒙特卡洛 ${o.result.sample_count} 样本`}{" "}
                    · 种子 {o.result.seed} · 裁剪概率质量 {pct(o.clipped_mass)}
                  </p>
                )}
                {o.result?.pots?.map((pot, i) => (
                  <p key={i}>
                    池 {i + 1}：金额 {pot.amount} · 预期所得{" "}
                    {pot.expected_return.toFixed(2)}
                    {pot.is_refund ? "（退回）" : ""}
                  </p>
                ))}
                {o.status === "ok" && (
                  <button
                    disabled={stale || busy}
                    onClick={() => {
                      const text = serializeCombos(o.combos ?? []);
                      dispatch({
                        type: "patch",
                        patch: {
                          opponents: draft.opponents.map((p, i) =>
                            i + 1 === result.target_seat
                              ? {
                                  kind: "range",
                                  folded: p.folded,
                                  text,
                                  rangeSource: "current",
                                }
                              : p,
                          ),
                        },
                      });
                    }}
                  >
                    应用{o.name}到当前对手范围
                  </button>
                )}
              </details>
            );
          })}
          <details>
            <summary>假设与误差说明</summary>
            {result.warnings.map((warning) => (
              <p key={warning}>{warning}</p>
            ))}
          </details>
          {snapshot && (
            <button onClick={() => downloadSensitivity(snapshot.input, result)}>
              导出分析快照与结果
            </button>
          )}
        </>
      )}
    </section>
  );
}
