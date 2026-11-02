import type { useQuickAnalysis } from "./useQuickAnalysis";
import { quickAdvice } from "../../quickAdvice";
import { preflopAdvice } from "../../preflopAdvice";
import { continuationAdvice } from "../../continuationAdvice";
import { treeAdvice } from "../../postflopTree";

export type QuickAnalysisState = ReturnType<typeof useQuickAnalysis>;

export function quickAnalysisPresentation(analysis: QuickAnalysisState) {
  const {
    history,
    result: baselineResult,
    unavailable,
    draft,
    game,
    river,
    tree,
  } = analysis;
  const result = history.result ?? baselineResult;
  const openingAdvice = !unavailable ? preflopAdvice(draft, game) : null;
  const evaluated = quickAdvice(draft, result, game, river.result);
  const fallback = !unavailable
    ? continuationAdvice(draft, result, game)
    : null;
  const advice = unavailable
    ? null
    : (treeAdvice(tree.result) ??
      (river.result ? evaluated : null) ??
      (openingAdvice && !openingAdvice.title.includes("需复核")
        ? openingAdvice
        : null) ??
      (evaluated &&
      !["暂不给跟注结论", "当前无需跟注"].includes(evaluated.title)
        ? evaluated
        : null) ??
      fallback ??
      openingAdvice ??
      evaluated);
  return { result, advice, openingAdvice, fallback };
}
