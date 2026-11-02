import type { AnalysisResult } from "../../api/client";
import s from "./QuickAnalysis.module.css";

export default function LimitedTreePanel({
  result,
}: {
  result: AnalysisResult;
}) {
  const tree = result.limited_tree;
  if (!tree) return null;
  const reference = result.candidates?.[0]?.action === "fold" ? "弃牌" : "过牌";
  return (
    <details className={s.details}>
      <summary>查看有限行动树与动作比较</summary>
      <p>{tree.horizon}</p>
      <p>
        下一街对手最多下注半池；我方按公开牌面特征和赔率固定跟注/弃牌，未求解最优后续策略。
      </p>
      <table aria-label="翻牌转牌候选动作">
        <thead>
          <tr>
            <th>动作</th>
            <th>模型 EV</th>
            <th>较{reference}</th>
            <th>三情景范围</th>
          </tr>
        </thead>
        <tbody>
          {result.candidates?.map((c) => (
            <tr key={`${c.action}-${c.amount}`}>
              <td>
                {c.action === "fold"
                  ? "弃牌"
                  : c.action === "check"
                    ? "过牌"
                    : `${c.action === "call" ? "跟注" : "下注"} ${c.amount}`}
              </td>
              <td>
                {c.ev?.toFixed(2)} ±{" "}
                {((c.ev_standard_error ?? 0) * 1.96).toFixed(2)}
              </td>
              <td>{c.ev_delta?.toFixed(2)}</td>
              <td>
                {c.ev_min?.toFixed(2)} ～ {c.ev_max?.toFixed(2)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul>
        {tree.scenarios.map((s) => (
          <li key={s.id}>
            {s.name}：{s.best_actions.join(" / ")}
          </li>
        ))}
      </ul>
      <p>
        EV 是从当前决策起的净收益；± 为约 95%
        抽样误差幅度，三情景范围为模型假设包络，两者均不包含未建模行为。每情景{" "}
        {tree.sample_count_per_scenario.toLocaleString()} 次，共用样本比较动作。
      </p>
      <p>范围与响应为未校准启发式；结果属于有限树，不是完整行动 EV 或 GTO。</p>
    </details>
  );
}
