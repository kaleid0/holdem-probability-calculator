import { useQuickAnalysis } from "./useQuickAnalysis";
import s from "./QuickAnalysis.module.css";
const percent = (value: number | null) =>
  value === null ? "—" : `${(value * 100).toFixed(2)}%`;

export default function QuickAnalysis({ retryKey }: { retryKey: number }) {
  const { unavailable, current, result, pending, retry } =
    useQuickAnalysis(retryKey);
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
          <span>底池权益</span>
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
    </section>
  );
}
