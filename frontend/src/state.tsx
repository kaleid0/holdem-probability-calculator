import { createContext, useContext, useEffect, useReducer } from "react";
import type { Dispatch, ReactNode } from "react";
import { emptyDraft, parseSaved } from "./model";
import type { Draft } from "./model";

type Action =
  { type: "replace"; draft: Draft } | { type: "patch"; patch: Partial<Draft> };
export function reducer(state: Draft, action: Action): Draft {
  return action.type === "replace"
    ? action.draft
    : { ...state, ...action.patch };
}
const storageKey = "holdem-lab:scenario:v1";
function loadDraft(): Draft {
  try {
    const saved = localStorage.getItem(storageKey);
    return saved ? parseSaved(saved) : emptyDraft();
  } catch {
    return emptyDraft();
  }
}
const ScenarioContext = createContext<{
  draft: Draft;
  dispatch: Dispatch<Action>;
} | null>(null);
export function ScenarioProvider({ children }: { children: ReactNode }) {
  const [draft, dispatch] = useReducer(reducer, undefined, loadDraft);
  useEffect(() => {
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify({ schemaVersion: 1, draft }),
      );
    } catch {
      /* Session remains usable when browser storage is unavailable. */
    }
  }, [draft]);
  return (
    <ScenarioContext value={{ draft, dispatch }}>{children}</ScenarioContext>
  );
}
export function useScenario() {
  const context = useContext(ScenarioContext);
  if (!context) throw new Error("ScenarioProvider is required");
  return context;
}
