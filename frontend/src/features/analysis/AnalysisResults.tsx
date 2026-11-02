import type { CSSProperties } from "react";
import type { AnalysisResult } from "../../api/client";
import RiverInferencePanel from "./RiverInferencePanel";
import LimitedTreePanel from "./LimitedTreePanel";
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
  const riverBet = result.strategy.id === "river-bet";
  const tree = !!result.limited_tree;
  const bestEV =
    riverBet || tree
      ? Math.max(
          ...(result.candidates ?? []).flatMap((c) =>
            c.ev == null ? [] : [c.ev],
          ),
        )
      : result.call_ev;
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
            {result.inference && <span>历史推断范围 · 响应比例为模型估计</span>}
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
            {result.pots?.length
              ? "权益按各池金额和参赛资格加权；上方胜负概率为与全部在局对手比较牌力。"
              : "权益包含平局时分得的份额，因此与独赢概率不同。"}
          </p>
        </>
      )}
      {!!result.pots?.length && (
        <div className={s.candidates}>
          <h3>主池与边池 · 跟注后直接摊牌</h3>
          <p>
            预期可得筹码：{result.expected_return?.toFixed(2)}
            （含退回金额，未扣本次跟注）
          </p>
          <p className={ui.helper}>
            按当前投入加上本次跟注拆池，不预测其他玩家后续投入。参赛者编号对应本次分析中的在局玩家。
          </p>
          <table>
            <thead>
              <tr>
                <th>底池</th>
                <th>金额 / 参赛者</th>
                <th>我的权益 / 预期所得</th>
              </tr>
            </thead>
            <tbody>
              {result.pots.map((pot, i) => (
                <tr key={i}>
                  <td>
                    {pot.is_refund
                      ? "未跟注退回"
                      : i === 0
                        ? "主池"
                        : `边池 ${i}`}
                  </td>
                  <td>
                    {pot.amount} /{" "}
                    {pot.eligible
                      .map((p) => (p === 0 ? "我" : `在局对手 ${p}`))
                      .join("、") || "已弃牌玩家"}
                  </td>
                  <td>
                    {pot.eligible.includes(0) ? percent(pot.equity) : "无资格"}{" "}
                    / {pot.expected_return.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className={ui.helper}>
            总权益不包含未跟注退回；平局按等份计算，不含整数余筹分配。
          </p>
        </div>
      )}
      {!riverBet && !tree && (
        <div className={s.oddsGrid}>
          <div>
            <span>底池赔率</span>
            <strong>
              {result.pot_odds_ratio ??
                (result.pots?.length ? "—" : "无需跟注")}
            </strong>
            <small>
              {result.pots?.length
                ? "可争夺金额（扣本次跟注）: 跟注额"
                : "当前底池 : 追加跟注额"}
            </small>
          </div>
          <div>
            <span>盈亏平衡权益</span>
            <strong>
              {result.break_even_equity === null
                ? "—"
                : percent(result.break_even_equity)}
            </strong>
            <small>
              {result.pots?.length
                ? "跟注额 ÷ 全部争夺池；与总加权权益比较"
                : "跟注额 ÷ 跟注后的底池"}
            </small>
          </div>
        </div>
      )}
      <div className={ui.evBox}>
        <div>
          <span>
            {riverBet || tree ? "最高候选收益" : "跟注参考收益"} <b>EV</b>
          </span>
          <strong className={bestEV !== null && bestEV < 0 ? ui.red : ""}>
            {bestEV === null
              ? "—"
              : `${bestEV > 0 ? "+" : ""}${bestEV.toFixed(2)}`}
            <small>{bestEV === null ? "" : " 筹码"}</small>
          </strong>
        </div>
        <p>
          {result.recommendation ||
            "此场景不输出行动建议，请结合计算假设理解结果。"}
        </p>
      </div>
      {(result.signals?.length ?? 0) > 0 && (
        <div className={s.signals}>
          <h3>{riverBet ? "策略分析依据" : "规则触发依据"}</h3>
          <ul>
            {result.signals?.map((signal, index) => (
              <li key={index}>{signal}</li>
            ))}
          </ul>
        </div>
      )}
      {result.inference && <RiverInferencePanel inference={result.inference} />}
      {tree && <LimitedTreePanel result={result} />}
      {!tree && (result.candidates?.length ?? 0) > 0 && (
        <div className={s.candidates}>
          <h3>
            {riverBet ? "候选动作 · 河牌响应模型" : "候选动作 · 同一摊牌假设"}
          </h3>
          {result.inference && (
            <p className={s.tableHint}>左右滑动查看完整动作对照</p>
          )}
          <div className={s.tableScroll}>
            <table
              aria-label={riverBet ? "河牌候选动作" : "候选动作"}
              className={result.inference ? s.riverCandidates : undefined}
            >
              <thead>
                <tr>
                  <th>动作</th>
                  <th>追加筹码</th>
                  <th>参考 EV</th>
                  {riverBet && (
                    <th>
                      {result.inference ? "估计弃牌率" : "弃牌率"} / 摊牌权益
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {result.candidates?.map((item) => (
                  <tr key={`${item.action}-${item.amount}`}>
                    <td>
                      {
                        {
                          fold: "弃牌",
                          call: "跟注",
                          check: "过牌",
                          bet: "下注",
                        }[item.action]
                      }
                      {riverBet && (
                        <details>
                          <summary>计算依据</summary>
                          <p>{item.explanation}</p>
                        </details>
                      )}
                      {result.inference &&
                        item.amount != null &&
                        result.inference.stable_amounts?.includes(
                          item.amount,
                        ) && (
                          <small className={s.candidateMetric}>
                            三情景一致
                          </small>
                        )}
                    </td>
                    <td>{item.amount ?? "—"}</td>
                    <td>
                      {item.ev === null || item.ev === undefined
                        ? "未提供"
                        : item.ev.toFixed(2)}
                      {item.ev_delta != null && (
                        <small className={s.candidateMetric}>
                          较过牌 {item.ev_delta > 0 ? "+" : ""}
                          {item.ev_delta.toFixed(2)}
                        </small>
                      )}
                      {item.ev_min != null && item.ev_max != null && (
                        <small className={s.candidateMetric}>
                          情景 {item.ev_min.toFixed(2)}～
                          {item.ev_max.toFixed(2)}
                        </small>
                      )}
                      {item.fold_return != null && item.call_return != null && (
                        <details>
                          <summary>收益拆分</summary>
                          <p>
                            弃牌分支 {item.fold_return.toFixed(2)}；跟注分支{" "}
                            {item.call_return.toFixed(2)} 筹码。
                          </p>
                        </details>
                      )}
                    </td>
                    {riverBet && (
                      <td>
                        {item.fold_probability == null
                          ? "—"
                          : percent(item.fold_probability)}{" "}
                        /{" "}
                        {item.showdown_equity == null
                          ? "—"
                          : percent(item.showdown_equity)}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className={ui.helper}>
            单位：筹码；基准：
            {result.candidates?.[0]?.ev_baseline ?? "此刻弃牌"}。
            {riverBet
              ? "过牌行显示当前范围权益，下注行显示被跟注后的条件权益。"
              : "跟注参考值不包含后续投入。"}
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
