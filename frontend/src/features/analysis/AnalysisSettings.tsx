import { useState } from "react";
import { useScenario } from "../../state";
import type { Strategy } from "../../api/client";
import type { Draft } from "../../model";
import s from "./AnalysisSettings.module.css";
import ui from "../../shared/ui/Shared.module.css";

export default function AnalysisSettings({
  strategies,
}: {
  strategies: Strategy[];
}) {
  const [expanded, setExpanded] = useState(true);
  const { draft, dispatch } = useScenario();
  const patch = (value: Partial<Draft>) =>
    dispatch({ type: "patch", patch: value });
  return (
    <section className={ui.resultPanel} aria-label="共同分析设置">
      <details
        className={ui.optionalSettings}
        open={expanded}
        onToggle={(event) => setExpanded(event.currentTarget.open)}
      >
        <summary>
          分析设置 <span>精细分析 · {draft.strategyIds.length} 项策略</span>
        </summary>
        <fieldset className={s.strategyChoices}>
          <legend>精细分析策略</legend>
          {(strategies.length
            ? strategies
            : [
                {
                  id: "pot-odds",
                  name: "底池赔率基线",
                  description: "等待计算服务连接",
                },
              ]
          ).map((strategy) => (
            <label key={strategy.id}>
              <input
                type="checkbox"
                checked={draft.strategyIds.includes(strategy.id)}
                onChange={(e) =>
                  patch({
                    strategyIds: e.target.checked
                      ? [...draft.strategyIds, strategy.id]
                      : draft.strategyIds.filter((id) => id !== strategy.id),
                  })
                }
              />
              <span>
                <strong>{strategy.name}</strong>
                <small>{strategy.description}</small>
              </span>
            </label>
          ))}
          {draft.strategyIds
            .filter((id) => !strategies.some((s) => s.id === id))
            .map((id) => (
              <p key={id} className={ui.helper}>
                已保存策略：{id}（尚未发现或已不可用）
              </p>
            ))}
          {draft.strategyIds.includes("equity-rules") && (
            <label className={s.ruleConfig}>
              权益安全余量（百分点）
              <input
                aria-label="权益安全余量（百分点）"
                type="number"
                min="0"
                max="50"
                step="1"
                value={draft.ruleMargin * 100}
                onChange={(e) => {
                  const value = Number(e.target.value);
                  if (Number.isFinite(value))
                    patch({
                      ruleMargin: Math.max(0, Math.min(0.5, value / 100)),
                    });
                }}
              />
            </label>
          )}
        </fieldset>
        <div className={s.computeSettings}>
          <label htmlFor="shared-samples">精细分析模拟精度</label>
          <select
            id="shared-samples"
            value={draft.samples}
            onChange={(e) =>
              patch({ samples: Number(e.target.value) as Draft["samples"] })
            }
          >
            <option value="10000">快速 · 10,000 次</option>
            <option value="50000">标准 · 50,000 次</option>
            <option value="100000">精细 · 100,000 次</option>
          </select>
        </div>
        <p className={ui.helper}>
          快速分析固定模拟 10,000
          次；以上设置仅用于手动执行的精细分析。规则策略仅适用于跟注后直接摊牌，安全余量不改变数学
          EV。
        </p>
      </details>
    </section>
  );
}
