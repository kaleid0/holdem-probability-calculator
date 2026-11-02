import type { AnalysisResult } from "../../api/client";
import s from "./Analysis.module.css";
import ui from "../../shared/ui/Shared.module.css";

type Inference = NonNullable<AnalysisResult["inference"]>;
const percent = (v: number) => `${(v * 100).toFixed(2)}%`;
const action = (amount: number) => (amount === 0 ? "过牌" : `下注 ${amount}`);

export default function RiverInferencePanel({
  inference,
}: {
  inference: Inference;
}) {
  const classes = inference.range_classes ?? [];
  const top = classes.slice(0, 12);
  const remainder = Math.max(
    0,
    1 - top.reduce((sum, c) => sum + c.probability, 0),
  );
  const scenarios = inference.scenarios ?? [];
  return (
    <section className={s.signals} aria-label="系统推断依据">
      <h3>系统推断依据</h3>
      <p>
        来源：{inference.source}；有效筹码 {inference.effective_stack}。
      </p>
      <p>
        已记录对手 {inference.observed_actions} 次行动；当前范围{" "}
        {inference.posterior_combos} 个有效组合。
        {inference.effective_combos != null &&
          ` 按权重折算为 ${inference.effective_combos.toFixed(1)} 个等权组合。`}
      </p>
      {!!scenarios.length && (
        <section className={s.candidates} aria-label="自动策略稳定性">
          <h3>三情景对照</h3>
          <p
            className={
              inference.stable_amounts?.length ? ui.helper : ui.caution
            }
          >
            {inference.sensitivity_summary}
          </p>
          <div className={s.tableScroll}>
            <table aria-label="自动策略三情景对照">
              <thead>
                <tr>
                  <th>假设</th>
                  <th>权益 / 过牌 EV</th>
                  <th>最高候选 EV / 动作</th>
                </tr>
              </thead>
              <tbody>
                {scenarios.map((scenario) => (
                  <tr key={scenario.id}>
                    <td>{scenario.name}</td>
                    <td>
                      {scenario.equity == null
                        ? "未完成"
                        : percent(scenario.equity)}
                      <small className={s.candidateMetric}>
                        {scenario.check_ev?.toFixed(2) ?? "—"}
                      </small>
                    </td>
                    <td>
                      {scenario.best_ev?.toFixed(2) ?? "—"}
                      <small className={s.candidateMetric}>
                        {scenario.status === "insufficient-data"
                          ? scenario.reasons?.join("；")
                          : scenario.best_amounts?.map(action).join("、")}
                      </small>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className={ui.helper}>
            偏紧与偏松同时改变历史诈唬权重和跟注意愿。结果范围是这三种假设的包络，不是置信区间；建议一致也不表示模型已校准。
          </p>
        </section>
      )}
      {!!classes.length && (
        <details>
          <summary>查看后验范围摘要</summary>
          <div className={s.tableScroll}>
            <table aria-label="后验范围摘要">
              <thead>
                <tr>
                  <th>手牌类别</th>
                  <th>后验概率</th>
                  <th>合法组合数</th>
                </tr>
              </thead>
              <tbody>
                {top.map((item) => (
                  <tr key={item.hand}>
                    <td>{item.hand}</td>
                    <td>{percent(item.probability)}</td>
                    <td>{item.combos}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className={ui.helper}>
            按后验概率列出前 {top.length} 类，其他类别合计 {percent(remainder)}
            。概率按组合权重归一化，组合数已剔除已知牌阻断。
          </p>
          {inference.clipped_mass > 0 && (
            <p className={ui.helper}>
              协议精度裁剪质量：{percent(inference.clipped_mass)}。
            </p>
          )}
        </details>
      )}
      <details>
        <summary>查看历史与环境依据</summary>
        <ul>
          {inference.evidence.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      </details>
      <details>
        <summary>模型适用条件</summary>
        <ul>
          {inference.warnings.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      </details>
    </section>
  );
}
