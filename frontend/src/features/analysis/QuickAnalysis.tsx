import { quickAnalysisPresentation } from "./quickAnalysisPresentation";
import type { QuickAnalysisState } from "./quickAnalysisPresentation";
import s from "./QuickAnalysis.module.css";
const percent = (value: number | null) =>
  value === null ? "—" : `${(value * 100).toFixed(2)}%`;

export default function QuickAnalysis({
  analysis,
}: {
  analysis: QuickAnalysisState;
}) {
  const { unavailable, current, pending, retry, history } = analysis;
  const { result, advice } = quickAnalysisPresentation(analysis);
  return (
    <section
      className={s.quickAnalysis}
      aria-label="快速分析"
      aria-busy={pending}
    >
      <div className={s.quickSummary}>
        <h3>快速分析</h3>
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
          <span>跟注参考 EV</span>
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
      {advice && (
        <div className={s.advice} aria-label="快速行动建议">
          <strong>{advice.title}</strong>
          <p aria-label="建议依据">{advice.reason}</p>
          <p aria-label="建议可靠程度">{advice.stability}</p>
        </div>
      )}
      {analysis.decision.error && (
        <div role="status">
          行动建议暂不可用：{analysis.decision.error}
          <button onClick={analysis.decision.retry}>重试行动建议</button>
        </div>
      )}
    </section>
  );
}
