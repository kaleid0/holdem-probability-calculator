import { useQuickAnalysis } from "./useQuickAnalysis";
import s from "./QuickAnalysis.module.css";
import { quickAdvice } from "../../quickAdvice";
import { preflopAdvice } from "../../preflopAdvice";
import { continuationAdvice } from "../../continuationAdvice";
import { postflopReady, treeAdvice } from "../../postflopTree";
import LimitedTreePanel from "./LimitedTreePanel";
import ActionEvPanel from "./ActionEvPanel";
const percent = (value: number | null) =>
  value === null ? "—" : `${(value * 100).toFixed(2)}%`;

export default function QuickAnalysis({ retryKey }: { retryKey: number }) {
  const {
    unavailable,
    current,
    result: baselineResult,
    pending,
    retry,
    river,
    readiness,
    draft,
    game,
    retryRiver,
    history,
    retryHistory,
    tree,
    retryTree,
  } = useQuickAnalysis(retryKey);
  const result = history.result ?? baselineResult;
  const openingAdvice = !unavailable ? preflopAdvice(draft, game) : null;
  const evaluated = quickAdvice(draft, result, game, river.result);
  const fallback = !unavailable
    ? continuationAdvice(draft, result, game)
    : null;
  const advice = unavailable
    ? null
    : (treeAdvice(tree.result) ??
      (river.result ? evaluated : null) ??
      (openingAdvice && !openingAdvice.title.includes("需复核")
        ? openingAdvice
        : null) ??
      (evaluated &&
      !["暂不给跟注结论", "当前无需跟注"].includes(evaluated.title)
        ? evaluated
        : null) ??
      fallback ??
      openingAdvice ??
      evaluated);
  return (
    <section
      className={s.quickAnalysis}
      aria-label="快速分析"
      aria-busy={pending}
    >
      <div className={s.quickSummary}>
        <h3 title="蒙特卡洛模拟 10,000 次，随牌局自动更新">快速分析</h3>
        <p
          className={s.quickStatus}
          role="status"
          title={unavailable || current?.error || undefined}
        >
          {unavailable ||
            current?.error ||
            (pending ? "更新中…" : "已更新至当前牌局")}
        </p>
      </div>
      <div className={s.quickMetrics}>
        <div>
          <span>{history.result ? "行动修正权益" : "底池权益"}</span>
          <strong aria-label="快速底池权益百分比">
            {percent(result?.equity ?? null)}
          </strong>
        </div>
        <div>
          <span title="基于直接摊牌、无后续投入的假设">跟注参考 EV</span>
          <strong title={result?.call_ev?.toFixed(2)}>
            {result?.call_ev == null
              ? "—"
              : `${result.call_ev > 0 ? "+" : ""}${result.call_ev.toFixed(2)}`}
          </strong>
        </div>
      </div>
      {current?.error && (
        <button
          className={s.quickRetry}
          aria-label="重试快速分析"
          title="重试快速分析"
          onClick={retry}
        >
          ↻
        </button>
      )}
      {!unavailable && game?.phase === "betting" && game.actor === 0 && (
        <ActionEvPanel
          draft={draft}
          result={result}
          game={game}
          advanced={!!tree.result || !!river.result}
        />
      )}
      {advice && (
        <div className={s.advice} aria-label="快速行动建议">
          <strong>{advice.title}</strong>
          <span className={s.stability}>{advice.stability}</span>
          <p>{advice.reason}</p>
          {tree.pending && (
            <p role="status">正在比较翻牌/转牌有限行动树；现有权益已可查看…</p>
          )}
          {tree.current?.error && (
            <p role="status">
              有限树分析暂不可用，现有结果保留。
              <button onClick={retryTree}>重试有限树</button>
            </p>
          )}
          {tree.result && <LimitedTreePanel result={tree.result} />}
          {history.pending && (
            <p role="status">正在根据本手行动更新对手范围；基础结果已可查看…</p>
          )}
          {history.result && (
            <p>已按本手行动更新随机对手范围，手动范围与明牌保持不变。</p>
          )}
          {history.current?.error && (
            <p role="status">
              行动范围更新暂不可用。
              <button onClick={retryHistory}>重试行动范围</button>
            </p>
          )}
          {river.pending && (
            <p role="status">正在自动比较河牌下注；基础权益已更新…</p>
          )}
          {river.current?.error && (
            <p role="status">
              河牌分析暂不可用，基础结果仍可查看。
              <button onClick={retryRiver}>重试河牌分析</button>
            </p>
          )}
          <details className={s.details}>
            <summary>查看依据与适用条件</summary>
            {[3, 4].includes(draft.boardSize) &&
              !postflopReady(draft, game) && (
                <p>
                  翻牌/转牌有限树仅适用于完整记录的开局单挑、自己为庄位后位，且本次行动能闭合当前街。此限制针对行动树；多人及边池在跟注后行动闭合、无后续投入且无自己的未跟注退回时，也可计算直接摊牌跟注
                  EV。
                </p>
              )}
            <p>
              {history.result
                ? "当前权益已应用行动推断范围；采用未校准的基准行为模型，未检验范围稳定性。"
                : "基础权益按当前对手设置计算；模拟误差不包含范围假设的误差。"}
            </p>
            {openingAdvice && (
              <p>
                翻前采用项目自定位置范围与筹码尺度规则，不使用模拟权益决定开池；20
                BB 以下、已有多次加注或全下的局面需单独复核。
              </p>
            )}
            {advice === fallback && (
              <p>
                后续行动参考适用于记录完整且轮到你的局面。它使用当前范围权益、底池赔率及固定保守余量，不是完整策略求解；免费行动默认过牌，全下及边池不套用单一门槛。有限行动树和河牌候选比较完成后优先显示其结果。
              </p>
            )}
            {history.result && (
              <ul aria-label="行动范围摘要">
                {history.result.history_ranges?.map((r) => (
                  <li key={r.seat}>
                    玩家 {r.seat + 1}：{r.observed_actions} 次行动，{r.combos}{" "}
                    个合法组合，有效组合 {r.effective_combos.toFixed(1)}
                    ；价值类占比 {(r.value_share * 100).toFixed(1)}%。
                  </li>
                ))}
              </ul>
            )}
            {history.result && (
              <p>
                有效组合为合法组合的权重之和；价值类占比是行为模型的分类比例，不等于对手领先你的概率。
              </p>
            )}
            {history.current?.error && <p>{history.current.error}</p>}
            {river.result ? (
              <>
                <p>
                  河牌建议使用本手行动推断的范围，与上方基础权益的模型可能不同。对手响应为未校准的规则估计；假设只弃牌或跟注，不加注。
                </p>
                <table aria-label="快速河牌候选动作">
                  <thead>
                    <tr>
                      <th>动作</th>
                      <th>参考 EV</th>
                      <th>较过牌</th>
                    </tr>
                  </thead>
                  <tbody>
                    {river.result.candidates?.map((c) => (
                      <tr key={`${c.action}-${c.amount}`}>
                        <td>
                          {c.action === "check" ? "过牌" : `下注 ${c.amount}`}
                        </td>
                        <td>{c.ev?.toFixed(2) ?? "—"}</td>
                        <td>
                          {c.ev_delta == null
                            ? "—"
                            : `${c.ev_delta >= 0 ? "+" : ""}${c.ev_delta.toFixed(2)}`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p>EV 为从当前决策起的净筹码收益，只比较候选金额。</p>
                <ul>
                  {river.result.inference?.scenarios?.map((scenario) => (
                    <li key={scenario.id}>
                      {scenario.name}：
                      {scenario.status === "ok"
                        ? (scenario.best_amounts ?? [])
                            .map((amount) =>
                              amount === 0 ? "过牌" : `下注 ${amount}`,
                            )
                            .join(" / ")
                        : "信息不足"}
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <>
                <p>
                  {tree.result
                    ? "当前未比较加注或树外的后续动作。"
                    : "当前未评估加注或后续行动树。精细分析可降低抽样误差，但不会自动补全不支持的行动树，也不能消除范围假设误差。"}
                </p>
                {draft.boardSize === 5 &&
                  Number(draft.call) === 0 &&
                  !readiness.ready && (
                    <p>自动河牌比较尚需：{readiness.reasons.join(" ")}</p>
                  )}
              </>
            )}
            {river.current?.error && <p>{river.current.error}</p>}
          </details>
        </div>
      )}
    </section>
  );
}
