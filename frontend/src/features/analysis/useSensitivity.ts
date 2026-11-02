import { useEffect, useRef, useState } from "react";
import { activeTask, ApiError, request } from "../../api/client";
import type { TaskCreated } from "../../api/client";
import type { SensitivityRequest, SensitivityTask } from "../../sensitivity";

export function useSensitivity() {
  const [task, setTask] = useState<SensitivityTask | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const submitted = useRef<{
    input: SensitivityRequest;
    fingerprint: string;
  } | null>(null);
  const generation = useRef(0);
  const id = task?.task_id;
  useEffect(() => {
    if (!id) return;
    const version = generation.current;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let failures = 0;
    async function poll() {
      try {
        const next = await request<SensitivityTask>(
          `/api/v1/sensitivity-analyses/${id}`,
          { signal: controller.signal },
        );
        if (controller.signal.aborted || version !== generation.current) return;
        setTask(next);
        setError("");
        failures = 0;
        if (activeTask(next.status)) timer = setTimeout(poll, 450);
      } catch (e) {
        if (controller.signal.aborted || version !== generation.current) return;
        setError(e instanceof Error ? e.message : "查询任务失败");
        if (
          (e instanceof ApiError && [404, 410].includes(e.status)) ||
          ++failures >= 5
        ) {
          setTask((old) => (old ? { ...old, status: "expired" } : old));
        } else timer = setTimeout(poll, 2000);
      }
    }
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [id]);
  async function calculate(input: SensitivityRequest, fingerprint: string) {
    const version = ++generation.current;
    setSubmitting(true);
    setError("");
    try {
      const created = await request<TaskCreated>(
        "/api/v1/sensitivity-analyses",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        },
      );
      if (version !== generation.current) return;
      submitted.current = { input, fingerprint };
      setTask({ ...created, progress: 0, completion: "none" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "提交失败");
    } finally {
      setSubmitting(false);
    }
  }
  async function cancel() {
    if (!id) return;
    try {
      const next = await request<SensitivityTask>(
        `/api/v1/sensitivity-analyses/${id}/cancel`,
        { method: "POST" },
      );
      // The poll may already have received a terminal response.
      setTask((old) => (old && activeTask(old.status) ? next : old));
    } catch (e) {
      setError(e instanceof Error ? e.message : "取消失败");
    }
  }
  return {
    task,
    error,
    setError,
    submitted,
    calculate,
    cancel,
    busy: submitting || activeTask(task?.status),
  };
}
