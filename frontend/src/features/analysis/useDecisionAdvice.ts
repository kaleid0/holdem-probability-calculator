import { useEffect, useState } from "react";
import { request } from "../../api/client";
import type { components } from "../../api/generated/schema";

export type DecisionAdviceRequest =
  components["schemas"]["DecisionAdviceRequest"];
export type DecisionAdviceResponse =
  components["schemas"]["DecisionAdviceResponse"];
export type ResponseModel = Required<components["schemas"]["ResponseModel"]>;

export function useDecisionAdvice(
  input: DecisionAdviceRequest | null,
  identity: string,
) {
  const [model, setModel] = useState<ResponseModel>();
  const [retry, setRetry] = useState(0);
  const body = input ? JSON.stringify({ ...input, response_model: model }) : "";
  const key = JSON.stringify([body, identity, retry]);
  const [snapshot, setSnapshot] = useState<{
    key: string;
    response?: DecisionAdviceResponse;
    error?: string;
  }>();

  useEffect(() => {
    if (!body) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void request<DecisionAdviceResponse>("/api/v1/decision-advice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: controller.signal,
      }).then(
        (response) => {
          if (!controller.signal.aborted) setSnapshot({ key, response });
        },
        (error: unknown) => {
          if (!controller.signal.aborted)
            setSnapshot({
              key,
              error:
                error instanceof Error ? error.message : "行动建议暂不可用。",
            });
        },
      );
    }, 100);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [body, key]);

  const current = body && snapshot?.key === key ? snapshot : undefined;
  return {
    response: current?.response,
    error: current?.error,
    pending: !!body && !current,
    model: model ?? current?.response?.response_model,
    setModel,
    retry: () => setRetry((value) => value + 1),
  };
}
