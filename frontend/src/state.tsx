import { createContext, useContext, useEffect, useReducer } from "react";
import type { Dispatch, ReactNode } from "react";
import { emptyDraft, parseSaved } from "./model";
import type { Draft } from "./model";
import { sessionReducer } from "./session";
import type { SessionAction, Session } from "./session";

const storageKey = "holdem-lab:scenario:v3";
function loadDraft(): Draft {
  try {
    const saved =
      localStorage.getItem(storageKey) ??
      localStorage.getItem("holdem-lab:scenario:v2") ??
      localStorage.getItem("holdem-lab:scenario:v1");
    return saved ? parseSaved(saved) : emptyDraft();
  } catch {
    return emptyDraft();
  }
}
const ScenarioContext = createContext<{
  draft: Draft;
  game: Session["game"];
  history: Session["history"];
  dispatch: Dispatch<SessionAction>;
} | null>(null);
export function ScenarioProvider({ children }: { children: ReactNode }) {
  const [session, dispatch] = useReducer(
    sessionReducer,
    undefined,
    (): Session => ({ draft: loadDraft(), game: null, history: [] }),
  );
  const { draft } = session;
  useEffect(() => {
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify({ schemaVersion: 3, draft }),
      );
    } catch {
      /* Session remains usable when browser storage is unavailable. */
    }
  }, [draft]);
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
