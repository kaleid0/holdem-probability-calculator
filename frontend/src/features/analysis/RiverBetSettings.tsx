import { useScenario } from "../../state";
import type { RiverBetDraft } from "../../riverBet";
import { riverReadiness } from "../../riverReadiness";
import s from "./AnalysisSettings.module.css";
import ui from "../../shared/ui/Shared.module.css";

export default function RiverBetSettings() {
  const { draft, game, dispatch } = useScenario();
  const value = draft.riverBet;
  const automatic = value.mode !== "manual";
  const readiness = riverReadiness(draft, game);
  const stack = readiness.effectiveStack;
  const patch = (change: Partial<RiverBetDraft>) =>
    dispatch({ type: "patch", patch: { riverBet: { ...value, ...change } } });
  const updateBet = (
    index: number,
    change: Partial<RiverBetDraft["bets"][number]>,
  ) =>
    patch({
      bets: value.bets.map((bet, i) =>
        i === index ? { ...bet, ...change } : bet,
      ),
    });
  return (
    <fieldset className={s.riverConfig}>
      <legend>河牌下注模型</legend>
      <label>
        参数来源
        <select
          aria-label="河牌策略参数来源"
          value={automatic ? "auto" : "manual"}
          onChange={(e) =>
            patch({
              mode: e.target.value as "auto" | "manual",
              ...(!value.effectiveStack && stack !== null && stack > 0
                ? { effectiveStack: String(stack) }
                : {}),
              checkClosesAction: value.checkClosesAction || readiness.ready,
            })
          }
        >
          <option value="auto">自动 · 根据牌局与本手历史</option>
          <option value="manual">手动 · 自定义响应假设</option>
        </select>
      </label>
      {automatic ? (
        <>
          <p className={ui.helper}>
            系统读取底池、双方剩余筹码和行动顺序，按历史推断对手范围，并估计各下注金额的弃牌率与跟注权益。
            自动比较 1/3、1/2、3/4、1、1.5 倍底池及全下；按有效筹码去重。
            同时检验偏紧、基准、偏松三种假设下建议是否一致。
          </p>
          <p className={readiness.ready ? ui.helper : ui.caution}>
            {game?.historyComplete && game.phase === "betting"
              ? `已记录 ${game.events.length} 个事件；${stack === null ? "缺少有效筹码记录" : `当前有效筹码 ${stack}`}。后端将重放历史验证适用条件。`
              : "当前缺少可用的完整本手记录；请使用逐步记录模式，或切换手动配置。"}
          </p>
          <div
            aria-label="河牌自动分析可用性"
            className={readiness.ready ? ui.helper : ui.caution}
          >
            {readiness.ready ? (
              "当前满足自动分析条件；后端将逐事件复核。"
            ) : (
              <ul>
                {readiness.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            )}
          </div>
          <details>
            <summary>翻前先验（可选）</summary>
            <label>
              自动推断的翻前先验
              <input
                aria-label="河牌自动推断翻前先验"
                value={value.preflopPrior ?? ""}
                placeholder="默认全组合等权；如 QQ+, AKs"
                maxLength={65536}
                onChange={(e) => patch({ preflopPrior: e.target.value })}
              />
            </label>
            <p className={ui.helper}>
              从先验逐街更新，避免把当前范围重复当作历史证据。已知对手明牌保持固定。
            </p>
          </details>
          <p className={ui.helper}>
            范围与响应为规则模型估计，尚未用真实对局校准。结果会列出数据来源与推断依据；不建立跨手对手画像。
          </p>
        </>
      ) : (
        <>
          <p className={ui.helper}>
            适用于河牌单挑、无需跟注。对手面对下注只会弃牌或跟注；每个金额独立配置响应假设。
          </p>
          <label>
            有效筹码
            <input
              type="number"
              min="1"
              step="1"
              placeholder="双方剩余筹码较小值"
              value={value.effectiveStack}
              onChange={(e) => patch({ effectiveStack: e.target.value })}
            />
          </label>
          <label className={s.riverCheck}>
            <input
              type="checkbox"
              checked={value.checkClosesAction}
              onChange={(e) => patch({ checkClosesAction: e.target.checked })}
            />
            确认过牌后直接摊牌（如对手已过牌，我最后行动）
          </label>
          {value.bets.map((bet, index) => (
            <fieldset key={index} className={s.riverOption}>
              <legend>下注方案 {index + 1}</legend>
              <div className={s.riverAmounts}>
                <label>
                  下注金额
                  <input
                    aria-label={`方案 ${index + 1} 下注金额`}
                    type="number"
                    min="1"
                    step="1"
                    value={bet.amount}
                    onChange={(e) =>
                      updateBet(index, { amount: e.target.value })
                    }
                  />
                </label>
                <label>
                  对手弃牌率（%）
                  <input
                    aria-label={`方案 ${index + 1} 弃牌率`}
                    type="number"
                    min="0"
                    max="100"
                    step="1"
                    value={bet.foldPercent}
                    onChange={(e) =>
                      updateBet(index, { foldPercent: e.target.value })
                    }
                  />
                </label>
              </div>
              <label>
                被跟注时的范围（可选）
                <input
                  aria-label={`方案 ${index + 1} 跟注范围`}
                  placeholder="留空沿用当前对手范围，如 AA, AKs"
                  value={bet.callingRange}
                  maxLength={65536}
                  onChange={(e) =>
                    updateBet(index, { callingRange: e.target.value })
                  }
                />
              </label>
              <button
                type="button"
                disabled={value.bets.length === 1}
                onClick={() =>
                  patch({ bets: value.bets.filter((_, i) => i !== index) })
                }
              >
                移除方案 {index + 1}
              </button>
            </fieldset>
          ))}
          <button
            type="button"
            disabled={value.bets.length >= 6}
            onClick={() => {
              const next =
                Math.max(...value.bets.map((b) => Number(b.amount) || 0)) + 50;
              patch({
                bets: [
                  ...value.bets,
                  { amount: String(next), foldPercent: "0", callingRange: "" },
                ],
              });
            }}
          >
            添加下注方案
          </button>
          <p className={ui.helper}>
            弃牌率由你假设，默认
            0%。留空跟注范围表示弃牌与手牌无关；指定跟注范围必须来自当前范围，并与弃牌率一致。最多比较
            6 个金额，不考虑对手加注。
          </p>
        </>
      )}
    </fieldset>
  );
}
