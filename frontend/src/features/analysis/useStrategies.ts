import { useCallback, useEffect, useState } from "react";
import { request } from "../../api/client";
import type { Strategy } from "../../api/client";
export function useStrategies() {
  const markOnline = useCallback(() => setConnection("online"), []);
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [connection, setConnection] = useState<
    "loading" | "online" | "offline"
  >("loading");
  const [connectionAttempt, setConnectionAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    request<{ strategies: Strategy[] }>("/api/v1/strategies", {
      signal: controller.signal,
    })
      .then((data) => {
        setStrategies(data.strategies);
        setConnection("online");
      })
      .catch(() => {
        if (!controller.signal.aborted) setConnection("offline");
      });
    return () => controller.abort();
  }, [connectionAttempt]);

  return {
    markOnline,
    strategies,
    connection,
    connectionAttempt,
    retryConnection: () => {
      setConnection("loading");
      setConnectionAttempt((n) => n + 1);
    },
  };
}
