import { useEffect, useState } from "react";
import { activeTask, request } from "../../api/client";
import type {
  AnalysisResult,
  AnalysisTask,
  TaskCreated,
} from "../../api/client";
import { useScenario } from "../../state";
import { validateDraft } from "../../model";
import { toRequest } from "../../analysisRequest";
import { riverReadiness } from "../../riverReadiness";
import { defaultRiverBet } from "../../riverBet";
import { postflopReady } from "../../postflopTree";
import { useDecisionAdvice } from "./useDecisionAdvice";
type Snapshot = {
  input: string;
  taskId?: string;
  result?: AnalysisResult;
  error?: string;
};

export function useQuickAnalysis(retryKey: number) {
  const { draft, game } = useScenario();
  const [retry, setRetry] = useState(0);
  const [riverRetry, setRiverRetry] = useState(0);
  const [historyRetry, setHistoryRetry] = useState(0);
  const [treeRetry, setTreeRetry] = useState(0);
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
    : JSON.stringify({
        ...toRequest(quickDraft, game),
        equity_method: "monteCarlo",
      });
  // Checks and undo can change the decision without changing the request's cards or pot.
  const actions = JSON.stringify(game);
  const identity = JSON.stringify([input, actions, retry, retryKey]);
  const baseline = useQuickTask(input, identity);
  const readiness = riverReadiness(draft, game);
  // The baseline completes first; advanced analysis never holds up its display.
  const riverInput =
    !unavailable && readiness.ready && baseline.result
      ? JSON.stringify({
          ...toRequest(
            {
              ...quickDraft,
              strategyId: "river-bet",
              strategyIds: ["river-bet"],
              riverBet: defaultRiverBet(),
            },
            game,
          ),
          equity_method: "monteCarlo",
        })
      : "";
  const river = useQuickTask(
    riverInput,
    JSON.stringify([riverInput, identity, riverRetry]),
  );
  const historyReady =
    !unavailable &&
    !readiness.ready &&
    game?.phase === "betting" &&
    game.actor === 0 &&
    game.historyComplete &&
    !!game.stacks &&
    game.events.some(
      (e) =>
        e.kind === "action" &&
        e.player > 0 &&
        draft.opponents[e.player - 1]?.kind === "random" &&
        !game.folded[e.player] &&
        !["smallBlind", "bigBlind"].includes(e.action),
    );
  const historyInput =
    historyReady && baseline.result
      ? JSON.stringify({
          ...toRequest(
            {
              ...quickDraft,
              strategyId: "history-ranges",
              strategyIds: ["history-ranges"],
            },
            game,
          ),
          equity_method: "monteCarlo",
        })
      : "";
  const history = useQuickTask(
    historyInput,
    JSON.stringify([historyInput, identity, historyRetry]),
  );
  const treeReady = !unavailable && postflopReady(draft, game);
  const treeInput =
    treeReady &&
    baseline.result &&
    (!historyReady || history.result || history.current?.error)
      ? JSON.stringify({
          ...toRequest(
            {
              ...quickDraft,
              strategyId: "postflop-tree",
              strategyIds: ["postflop-tree"],
            },
            game,
          ),
          equity_method: "monteCarlo",
        })
      : "";
  const tree = useQuickTask(
    treeInput,
    JSON.stringify([treeInput, identity, treeRetry]),
  );
  const historyContext =
    game?.historyComplete &&
    game.stacks &&
    input &&
    toRequest(quickDraft, game).pot_context
      ? {
          schema_version: 1 as const,
          hand_id: game.handId ?? "legacy-recording",
          cutoff_sequence: game.events.length,
          complete: game.historyComplete,
          count: game.count,
          opening_seats:
            game.openingSeats ??
            game.stacks.flatMap((n, i) => (n > 0 ? [i] : [])),
          dealer: game.dealer,
          small_blind: game.smallBlind,
          big_blind: game.bigBlind,
          stacks: game.stacks,
          events: game.events,
        }
      : null;
  const decision = useDecisionAdvice(
    input
      ? {
          base_analysis: {
            ...toRequest(quickDraft, game),
            equity_method: "monteCarlo",
          },
          recorded: !!game,
          history_context: historyContext,
          opponent_seats: draft.opponents.flatMap((o, i) =>
            o.folded ? [] : [i + 1],
          ),
          sources: {
            baseline: baseline.current?.taskId,
            history: history.current?.taskId,
            river: river.current?.taskId,
            tree: tree.current?.taskId,
          },
        }
      : null,
    identity,
  );
  return {
    ...baseline,
    unavailable,
    river,
    history,
    tree,
    readiness,
    decision,
    draft,
    game,
    retry: () => setRetry((n) => n + 1),
    retryRiver: () => setRiverRetry((n) => n + 1),
    retryHistory: () => setHistoryRetry((n) => n + 1),
    retryTree: () => setTreeRetry((n) => n + 1),
  };
}

function useQuickTask(input: string, identity: string) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);

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
          taskId: task.result ? taskId : undefined,
          result: task.result ?? undefined,
          error: task.result
            ? undefined
            : (task.error ??
              (task.outcomes?.flatMap((o) => o.reasons).join("；") ||
                "快速分析未完成，请重试。")),
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
    current,
    result,
    pending,
  };
}
