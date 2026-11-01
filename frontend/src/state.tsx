import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type { Dispatch, ReactNode } from "react";
import type { Draft } from "./model";
import { sessionReducer } from "./session";
import type { SessionAction, Session } from "./session";
import { loadSession, saveSession } from "./sessionStorage";

const ScenarioContext = createContext<{
  draft: Draft;
  game: Session["game"];
  history: Session["history"];
  mode: Session["mode"];
  dispatch: Dispatch<SessionAction>;
} | null>(null);
export function ScenarioProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState(() =>
    loadSession({
      getItem: (key) => localStorage.getItem(key),
    }),
  );
  const current = useRef(session);
  const persist = useCallback((value: Session) => {
    saveSession(
      { setItem: (key, text) => localStorage.setItem(key, text) },
      value,
    );
  }, []);
  const dispatch = useCallback(
    (action: SessionAction) => {
      const next = sessionReducer(current.current, action);
      current.current = next;
      // Persist in the action handler: a phone may suspend before React's effects run.
      persist(next);
      setSession(next);
    },
    [persist],
  );
  useEffect(() => {
    const flush = () => persist(current.current);
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", flush);
    };
  }, [persist]);
  return (
    <ScenarioContext value={{ ...session, dispatch }}>
      {children}
    </ScenarioContext>
  );
}
export function useScenario() {
  const context = useContext(ScenarioContext);
  if (!context) throw new Error("ScenarioProvider is required");
  return context;
}
