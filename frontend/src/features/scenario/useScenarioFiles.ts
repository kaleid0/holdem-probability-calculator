import { useRef, useState } from "react";
import type { ChangeEvent, Dispatch, SetStateAction } from "react";
import { useScenario } from "../../state";
import { emptyDraft, exampleDraft, parseSaved } from "../../model";
export function useScenarioFiles(
  setErrors: Dispatch<SetStateAction<string[]>>,
) {
  const { draft, dispatch } = useScenario();
  const [message, setMessage] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  function exportScene() {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify({ schemaVersion: 3, draft }, null, 2)], {
        type: "application/json",
      }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "holdem-scenario.json";
    anchor.click();
    URL.revokeObjectURL(url);
    setMessage("牌局已导出，可在下次分析时重新导入。");
  }
  async function importScene(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      if (file.size > 128 * 1024) throw new Error("牌局文件应小于 128 KB。");
      const scene = parseSaved(await file.text());
      dispatch({ type: "replace", draft: scene });
      setErrors([]);
      setMessage("已导入牌局。");
    } catch (error) {
      setErrors([
        error instanceof Error &&
        !(error instanceof SyntaxError) &&
        !("issues" in error)
          ? error.message
          : "文件格式不正确，请导入由本应用导出的 JSON 牌局。",
      ]);
    }
  }

  function reset(example: boolean) {
    dispatch({
      type: "replace",
      draft: {
        ...(example ? exampleDraft() : emptyDraft()),
        table: draft.table,
        ...(example ? { bankroll: draft.bankroll } : {}),
        opponents: draft.opponents.map(() => ({ kind: "random" as const })),
      },
    });
    setErrors([]);
    setMessage(
      example ? "已载入同花顺听牌示例，快速分析将自动更新。" : "已重置牌局。",
    );
  }

  return { message, setMessage, fileInput, exportScene, importScene, reset };
}
