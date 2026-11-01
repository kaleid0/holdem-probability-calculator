import { useEffect, useState } from "react";
import { activeTask, request } from "../../api/client";
import type {
  AnalysisResult,
  AnalysisTask,
  TaskCreated,
} from "../../api/client";
import { useScenario } from "../../state";
import { toRequest, validateDraft } from "../../model";
type Snapshot = {
  input: string;
  result?: AnalysisResult;
  error?: string;
};

export function useQuickAnalysis(retryKey: number) {
  const { draft, game } = useScenario();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [retry, setRetry] = useState(0);
  // Quick analysis is independent of the user's precision and advanced strategies.
  const quickDraft = {
    ...draft,
    samples: 10000 as const,
    strategyId: "pot-odds",
    strategyIds: ["pot-odds"],
  };
  const validation = validateDraft(quickDraft);
  const unavailable = game?.folded[0]
    ? "你已弃牌，本手不再参与底池权益分析。"
    : validation.join(" ");
  const input = unavailable
    ? ""
    : JSON.stringify({ ...toRequest(quickDraft), equity_method: "monteCarlo" });
  // Checks and undo can change the decision without changing the request's cards or pot.
  const actions = JSON.stringify(game);
  const identity = JSON.stringify([input, actions, retry, retryKey]);

  useEffect(() => {
    if (!input) return;
    const controller = new AbortController();
    let stopped = false;
    let taskId: string | undefined;
    let finished = false;
    let timer: ReturnType<typeof setTimeout>;
    const cancel = (id: string) =>
      request(`/api/v1/analyses/${id}/cancel`, { method: "POST" }).catch(
        () => undefined,
      );
    async function poll() {
      try {
        const task = await request<AnalysisTask>(`/api/v1/analyses/${taskId}`, {
          signal: controller.signal,
        });
        if (stopped) return;
        if (activeTask(task.status)) {
          timer = setTimeout(() => void poll(), 250);
          return;
        }
        finished = true;
        setSnapshot({
          input: identity,
          result: task.result ?? undefined,
          error: task.result
            ? undefined
            : (task.error ?? "快速分析未完成，请重试。"),
        });
      } catch (error) {
        if (stopped) return;
        if (taskId) void cancel(taskId);
        setSnapshot({
          input: identity,
          error:
            error instanceof Error ? error.message : "快速分析失败，请重试。",
        });
      }
    }
    async function submit() {
      setSnapshot({ input: identity });
      try {
        // Keep the submission alive until its id arrives so cleanup can cancel it.
        const created = await request<TaskCreated>("/api/v1/analyses", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: input,
        });
        taskId = created.task_id;
        if (stopped) {
          void cancel(taskId);
          return;
        }
        void poll();
      } catch (error) {
        if (!stopped)
          setSnapshot({
            input: identity,
            error:
              error instanceof Error ? error.message : "快速分析提交失败。",
          });
      }
    }
    // Coalesce rapid edits without delaying normal table actions noticeably.
    timer = setTimeout(() => void submit(), 150);
    return () => {
      stopped = true;
      controller.abort();
      clearTimeout(timer);
      if (taskId && !finished) void cancel(taskId);
    };
  }, [input, identity]);

  const current = input && snapshot?.input === identity ? snapshot : null;
  const result = current?.result;
  const pending = !!input && !result && !current?.error;
  return {
    unavailable,
    current,
    result,
    pending,
    retry: () => setRetry((n) => n + 1),
  };
}
