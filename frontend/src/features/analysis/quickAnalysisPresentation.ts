import type { useQuickAnalysis } from "./useQuickAnalysis";

export type QuickAnalysisState = ReturnType<typeof useQuickAnalysis>;

export function quickAnalysisPresentation(analysis: QuickAnalysisState) {
  const result = analysis.history.result ?? analysis.result;
  const response = !analysis.unavailable
    ? analysis.decision.response
    : undefined;
  const advice = response?.advice ?? null;
  const openingAdvice = response?.opening_advice ?? null;
  const fallback = response?.fallback ?? null;
  return { result, advice, openingAdvice, fallback };
}
