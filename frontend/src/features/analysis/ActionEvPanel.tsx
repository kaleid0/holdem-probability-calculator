import type { useDecisionAdvice } from "./useDecisionAdvice";
import s from "./QuickAnalysis.module.css";

export default function ActionEvPanel({
  decision,
}: {
  decision: ReturnType<typeof useDecisionAdvice>;
}) {
  const { response, model, setModel } = decision;
  const comparison = response?.comparison;
  const advanced = response?.advanced;
  return (
    <div className={s.actionEv} aria-label="当前行动 EV 比较">
      <strong>当前行动 EV · 有限模型估计</strong>
      {!comparison ? (
        <p role="status">{decision.error ?? "正在更新行动 EV…"}</p>
      ) : comparison.reason ? (
        <p role="status">{comparison.reason}</p>
      ) : (
        <>
          <p>
            {advanced
              ? "优先参考上方行动树／河牌分析；以下为简化模型对照。"
              : `基准候选：${comparison.best?.join(" / ")}。`}
            {comparison.stable?.length
              ? `三种假设下共同候选：${comparison.stable.join(" / ")}（含抽样容差）。`
              : "候选排序对模型假设敏感。"}
          </p>
          <div className={s.evScroll}>
            <table>
              <caption>从当前决策起的净筹码收益；此前投入不计入成本</caption>
              <thead>
                <tr>
                  <th>动作</th>
                  <th>本次追加</th>
                  {comparison.scenarios?.map((x) => (
                    <th key={x.name}>{x.name} EV</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {comparison.rows?.map((row) => (
                  <tr key={row.label}>
                    <th scope="row">{row.label}</th>
                    <td>{row.additional}</td>
                    {row.values.map((value, i) => (
                      <td
                        key={i}
                        title={`权益抽样误差传播约 ±${row.errors[i].toFixed(2)}，不含模型误差`}
                      >
                        {value > 0 ? "+" : ""}
                        {value.toFixed(2)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {model && (
        <details>
          <summary>调整响应假设与查看计算边界</summary>
          <div className={s.evInputs}>
            {(
              [
                ["fold", "面对下注／加注弃牌率"],
                ["raise", "面对下注／加注再加注率"],
                ["probe", "后续试探下注率"],
              ] as const
            ).map(([key, label]) => (
              <label key={key}>
                {label}
                <input
                  aria-label={label}
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={Math.round((model[key] ?? 0) * 100)}
                  onChange={(event) => {
                    const value = Number(event.target.value) / 100;
                    setModel({
                      ...model,
                      [key]: value,
                      ...(key === "fold"
                        ? { raise: Math.min(model.raise ?? 0, 1 - value) }
                        : key === "raise"
                          ? { fold: Math.min(model.fold ?? 0, 1 - value) }
                          : {}),
                    });
                  }}
                />
                {Math.round((model[key] ?? 0) * 100)}%
              </label>
            ))}
          </div>
          <p>
            这些是可调整的假设，不是从对手数据校准的概率；适用于所有候选尺度。跟注率为
            1 − 弃牌率 − 再加注率；面对再加注固定弃牌，全下后再加注率为零。
          </p>
          <p>
            允许后续下注且尚未到河牌时，匹配当前投入后最多模拟一次对手半底池下注，金额受双方剩余筹码限制；你按模型收益选择跟注或弃牌，然后直接摊牌。其余分支直接摊牌；过牌后当前街的主动下注也不单独展开。不是整手牌完整
            EV。
          </p>
          <p>
            响应概率与手牌、牌面独立，各响应分支复用同一摊牌权益，没有重建对手跟注／再加注范围；强牌更易继续等相关性未建模，尤其不能据此认定大额下注最优。明牌对手仍使用同一假设模型。
          </p>
          <p>
            有利／不利假设将权益上／下移至少 8
            个百分点，同时改变响应概率；这只是情景压力测试，并非重新计算范围后的权益。模型误差不包含在抽样容差中。无抽样误差数据时使用
            3 个百分点的保守误差参考。
          </p>
          {comparison?.scenarios?.map((x) => (
            <p key={x.name}>
              {x.name}：权益 {(x.equity * 100).toFixed(1)}%，弃牌{" "}
              {(x.fold * 100).toFixed(0)}%，再加注 {(x.raise * 100).toFixed(0)}
              %，试探 {(x.probe * 100).toFixed(0)}%。
            </p>
          ))}
        </details>
      )}
    </div>
  );
}
