import type { components } from "../../api/generated/schema";
import s from "./Analysis.module.css";
import ui from "../../shared/ui/Shared.module.css";
type Outcome = components["schemas"]["StrategyOutcome"];
const statuses = {
  ok: "已完成",
  unsupported: "不适用",
  "insufficient-data": "信息不足",
  error: "失败",
};
export default function Comparison({
  outcomes,
  active,
  onSelect,
  strategies,
}: {
  outcomes: Outcome[];
  active: string;
  onSelect: (id: string) => void;
  strategies: components["schemas"]["StrategyManifest"][];
}) {
  if (
    !outcomes.length ||
    (outcomes.length === 1 && outcomes[0].status === "ok")
  )
    return null;
  return (
    <div className={s.comparison}>
      <h3>策略对照</h3>
      <p className={ui.helper}>
        固定同一牌局；各策略的响应假设与 EV
        基准可能不同，请查看候选动作和计算依据，不跨口径排名。
      </p>
      {outcomes.map((item) => (
        <article key={item.strategy_id}>
          <div>
            <strong>
              {item.result?.strategy.name ??
                strategies.find((strategy) => strategy.id === item.strategy_id)
                  ?.name ??
                item.strategy_id}
            </strong>
            <span>{statuses[item.status]}</span>
          </div>
          <p>
            {item.result?.recommendation ??
              (item.status === "ok"
                ? "仅提供条件下的参考结果"
                : item.reasons?.join("；"))}
          </p>
          {item.result && (
            <div>
              <span>
                权益{" "}
                {item.result.equity === null
                  ? "未提供"
                  : (item.result.equity * 100).toFixed(2) + "%"}{" "}
                · 跟注参考 EV{" "}
                {item.result.call_ev === null
                  ? "未提供"
                  : item.result.call_ev.toFixed(2)}
              </span>
              <button
                aria-pressed={active === item.strategy_id}
                onClick={() => onSelect(item.strategy_id)}
              >
                查看详情
              </button>
            </div>
          )}
        </article>
      ))}
    </div>
  );
}
