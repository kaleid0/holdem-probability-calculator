import { useEffect, useRef, useState } from "react";
import { activeTask, ApiError, request } from "../../api/client";
import type {
  AnalysisResult,
  AnalysisTask,
  TaskCreated,
} from "../../api/client";
import { useScenario } from "../../state";
import { toRequest, validateDraft } from "../../model";
import type { Draft } from "../../model";

export function useDetailedAnalysis(onStart: () => void, onOnline: () => void) {
  const { draft, game } = useScenario();
  const [task, setTask] = useState<AnalysisTask | null>(null);
  const [completed, setCompleted] = useState<{
    result: AnalysisResult;
    outcomes: NonNullable<AnalysisTask["outcomes"]>;
    input: string;
  } | null>(null);
  const [activeStrategy, setActiveStrategy] = useState("pot-odds");
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [networkError, setNetworkError] = useState("");
  const submittedInput = useRef("");
  const fingerprint = JSON.stringify(toRequest(draft));
  const busy = submitting || activeTask(task?.status);
  const taskId = task?.task_id;
  useEffect(() => {
    if (!taskId) return;
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
        onOnline();
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
  }, [taskId, onOnline]);

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
    setNetworkError("");
    submittedInput.current = JSON.stringify(toRequest(scene));
    onStart();
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

  return {
    task,
    completed,
    activeStrategy,
    setActiveStrategy,
    errors,
    setErrors,
    networkError,
    submittedInput,
    fingerprint,
    busy,
    calculate,
    cancel,
  };
}
