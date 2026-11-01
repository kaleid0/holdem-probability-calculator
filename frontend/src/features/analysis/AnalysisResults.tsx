import type { CSSProperties } from "react";
import type { AnalysisResult } from "../../api/client";
import s from "./Analysis.module.css";
import ui from "../../shared/ui/Shared.module.css";
const percent = (value: number) => `${(value * 100).toFixed(2)}%`;

export default function AnalysisResults({
  result,
  stale,
}: {
  result: AnalysisResult;
  stale: boolean;
}) {
  const error = result.equity_standard_error;
  const equity =
    result.equity === null ? null : Math.max(0, Math.min(1, result.equity));
  const hasProbabilities =
    result.win_probability !== null &&
    result.tie_probability !== null &&
    result.lose_probability !== null;
  return (
    <>
      {stale && (
        <div className={s.stale} role="status">
          牌局已修改，以下为上一次计算结果。请重新计算。
        </div>
      )}
      {equity !== null ? (
        <div className={s.equityArea}>
          <div
            className={s.equityRing}
            style={{ "--equity": `${equity * 100}%` } as CSSProperties}
          >
            <div>
              <span>我的底池权益</span>
              <strong aria-label="底池权益百分比">
                {(equity * 100).toFixed(2)}
                <small>%</small>
              </strong>
              <span>预期分得的底池份额</span>
            </div>
          </div>
          <div className={s.equityCaption}>
            <span className={s.methodBadge}>
              {result.method === "exact" ? "精确枚举" : "蒙特卡洛模拟"}
            </span>
            <span>
              {result.sample_count.toLocaleString("zh-CN")} 个
              {result.method === "exact" ? "状态" : "样本"} ·{" "}
              {(result.elapsed_ms / 1000).toFixed(2)} 秒
            </span>
            {error !== null && result.method !== "exact" && (
              <span>
                近似 95% 抽样误差 ±{(1.96 * error * 100).toFixed(2)} 个百分点
              </span>
            )}
          </div>
        </div>
      ) : (
        <div className={s.noEquity}>
          <span>♠</span>
          <p>此策略未计算摊牌权益</p>
          <small>请根据策略依据与适用条件理解建议。</small>
        </div>
      )}
      {hasProbabilities && (
        <>
          <div className={s.probabilities}>
            {[
              ["独赢", result.win_probability, s.win],
              ["平局", result.tie_probability, s.tie],
              ["输牌", result.lose_probability, s.loss],
            ].map(([label, value, color]) => (
              <div key={String(label)}>
                <span>
                  <i className={String(color)} />
                  {label}
                </span>
                <strong>{percent(Number(value))}</strong>
              </div>
            ))}
          </div>
          <div
            className={s.probabilityBar}
            aria-label={`独赢 ${percent(result.win_probability!)}，平局 ${percent(result.tie_probability!)}，输牌 ${percent(result.lose_probability!)}`}
          >
            <span
              className={s.win}
              style={{ width: `${result.win_probability! * 100}%` }}
            />
            <span
              className={s.tie}
              style={{ width: `${result.tie_probability! * 100}%` }}
            />
            <span
              className={s.loss}
              style={{ width: `${result.lose_probability! * 100}%` }}
            />
          </div>
          <p className={s.resultHint}>
            权益包含平局时分得的份额，因此与独赢概率不同。
          </p>
        </>
      )}
      <div className={s.oddsGrid}>
        <div>
          <span>底池赔率</span>
          <strong>{result.pot_odds_ratio ?? "无需跟注"}</strong>
          <small>当前底池 : 追加跟注额</small>
        </div>
        <div>
          <span>盈亏平衡权益</span>
          <strong>
            {result.break_even_equity === null
              ? "—"
              : percent(result.break_even_equity)}
          </strong>
          <small>跟注额 ÷ 跟注后的底池</small>
        </div>
      </div>
      <div className={ui.evBox}>
        <div>
          <span>
            跟注参考收益 <b>EV</b>
          </span>
          <strong
            className={
              result.call_ev !== null && result.call_ev < 0 ? ui.red : ""
            }
          >
            {result.call_ev === null
              ? "—"
              : `${result.call_ev > 0 ? "+" : ""}${result.call_ev.toFixed(2)}`}
            <small>{result.call_ev === null ? "" : " 筹码"}</small>
          </strong>
        </div>
        <p>
          {result.recommendation ||
            "此场景不输出行动建议，请结合计算假设理解结果。"}
        </p>
      </div>
      {(result.signals?.length ?? 0) > 0 && (
        <div className={s.signals}>
          <h3>规则触发依据</h3>
          <ul>
            {result.signals?.map((signal, index) => (
              <li key={index}>{signal}</li>
            ))}
          </ul>
        </div>
      )}
      {(result.candidates?.length ?? 0) > 0 && (
        <div className={s.candidates}>
          <h3>候选动作 · 同一摊牌假设</h3>
          <table>
            <thead>
              <tr>
                <th>动作</th>
                <th>追加筹码</th>
                <th>参考 EV</th>
              </tr>
            </thead>
            <tbody>
              {result.candidates?.map((item) => (
                <tr key={item.action}>
                  <td>{item.action === "fold" ? "弃牌" : "跟注"}</td>
                  <td>{item.amount ?? "—"}</td>
                  <td>
                    {item.ev === null || item.ev === undefined
                      ? "未提供"
                      : item.ev.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className={ui.helper}>
            单位：筹码；基准：此刻弃牌。跟注参考值不包含后续投入。
          </p>
        </div>
      )}
      <details className={s.assumptions}>
        <summary>
          计算假设与适用条件 <span>＋</span>
        </summary>
        <ul>
          {result.assumptions.map((assumption, index) => (
            <li key={index}>{assumption}</li>
          ))}
        </ul>
        <p>
          策略：{result.strategy.name} · v{result.strategy.version}
          。模型版本：{result.model_version}。抽样误差不包含范围假设的不确定性。
          配置：{JSON.stringify(result.strategy_config ?? {})}
        </p>
      </details>
    </>
  );
}
