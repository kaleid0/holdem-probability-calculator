import type { RefObject } from "react";
import { activeTask } from "../../api/client";
import type { Strategy } from "../../api/client";
import Comparison from "./Comparison";
import Results from "./AnalysisResults";
import type { useDetailedAnalysis } from "./useDetailedAnalysis";
import s from "./Analysis.module.css";
import ui from "../../shared/ui/Shared.module.css";
const statusText = {
  queued: "排队等待计算",
  running: "正在模拟牌局",
  cancelling: "正在取消",
  succeeded: "计算完成",
  failed: "计算失败",
  cancelled: "已取消计算",
  expired: "任务已失效",
};
type Props = {
  analysis: ReturnType<typeof useDetailedAnalysis>;
  strategies: Strategy[];
  resultPanel: RefObject<HTMLElement | null>;
};
export default function AnalysisPanel({
  analysis,
  strategies,
  resultPanel,
}: Props) {
  const {
    task,
    completed,
    activeStrategy,
    setActiveStrategy,
    networkError,
    submittedInput,
    fingerprint,
    busy,
    calculate,
    cancel,
  } = analysis;
  return (
    <section
      ref={resultPanel}
      tabIndex={-1}
      className={ui.resultPanel}
      aria-label="计算结果"
    >
      <div className={s.resultHeading}>
        <div>
          <span className={ui.eyebrow}>INSIGHTS / 02</span>
          <h2>牌局分析</h2>
        </div>
        <span className={ui.liveBadge}>
          <i />
          按需分析
        </span>
      </div>
      <section
        className={s.fineAnalysis}
        aria-label="精细分析"
        aria-busy={busy}
      >
        <div className={s.quickHeading}>
          <h3>精细分析</h3>
          <span>按需执行 · 高级策略</span>
        </div>
        <p className={ui.helper}>
          使用上方分析设置中的精度和策略，仅在你点击后运行。
        </p>
        <button
          className={ui.calculateButton}
          disabled={busy}
          onClick={() => void calculate()}
        >
          {busy ? "精细分析进行中" : "执行精细分析"}
        </button>
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
                  {Math.round(task.progress * 100)}% · 所有策略共享计算预算
                </small>
              </>
            )}
            {task.error && <p className={ui.red}>{task.error}</p>}
            {networkError && <p className={ui.red}>{networkError} 正在重连…</p>}
            {busy && submittedInput.current !== fingerprint && (
              <p className={ui.caution}>
                输入已修改，此任务仍在计算提交时的牌局。
              </p>
            )}
          </div>
        )}
        <Comparison
          strategies={strategies}
          outcomes={
            task?.outcomes?.length ? task.outcomes : (completed?.outcomes ?? [])
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
          <p className={ui.helper}>
            尚未执行精细分析。快速分析会随牌局操作自动更新。
          </p>
        )}
      </section>
    </section>
  );
}
