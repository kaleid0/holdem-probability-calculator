import { useState } from "react";
import { bankrollFor, signedChips } from "../../bankroll";
import { seatName } from "../../liveGame";
import { useScenario } from "../../state";
import s from "./TableSettings.module.css";

export default function ChipLedger() {
  const { draft, game, dispatch } = useScenario();
  const book = bankrollFor(draft);
  const [inputs, setInputs] = useState<string[] | null>(null);
  const [error, setError] = useState("");
  const [resetting, setResetting] = useState(false);
  const editable =
    resetting || (!book.hands.length && (!game || game.phase === "hand"));
  const inProgress = !!game?.stacks && game.phase !== "hand" && !game.payouts;
  return (
    <section className={s.chipSection} aria-label="筹码账本">
      <h3>
        玩家筹码{" "}
        <small>
          {resetting
            ? "填写新一场的初始筹码"
            : editable
              ? "每位玩家可分别设置初始筹码"
              : "结算后自动带入下一手"}
        </small>
      </h3>
      {resetting && (
        <p className={s.resetNotice}>
          确认后将清空本场行动、牌面、每手输赢记录及累计盈亏，并按下方金额重新分配筹码。牌桌人数、庄位和盲注保留；无筹码的庄位会顺延。
        </p>
      )}
      <div className={s.chipGrid}>
        {book.initial.map((initial, i) => {
          const balance = book.balances[i];
          const remaining = inProgress
            ? game!.stacks![i] - game!.total[i]
            : balance;
          return (
            <div className={s.chipSeat} key={i}>
              <strong>{seatName(i)}</strong>
              <label>
                初始筹码
                <input
                  aria-label={`${seatName(i)}初始筹码`}
                  inputMode="numeric"
                  disabled={!editable}
                  value={inputs?.[i] ?? initial}
                  onChange={(e) => {
                    const values = book.initial.map(
                      (n, j) => inputs?.[j] ?? String(n),
                    );
                    values[i] = e.target.value;
                    setInputs(values);
                    setError("");
                  }}
                />
              </label>
              <span>
                剩余 <b>{remaining}</b> · 累计盈亏{" "}
                {signedChips(balance - initial)}
              </span>
              {inProgress && <span>本手已投入 {game!.total[i]} · 待结算</span>}
              {remaining === 0 && (
                <span>
                  {inProgress && !game!.folded[i]
                    ? "已全下"
                    : "无筹码，下一手暂不参与"}
                </span>
              )}
            </div>
          );
        })}
      </div>
      {editable && inputs && (
        <button
          type="button"
          onClick={() => {
            const amounts = book.initial.map((n, i) => Number(inputs[i] ?? n));
            if (
              inputs.some((v) => !/^\d+$/.test(v)) ||
              amounts.some((n) => !Number.isSafeInteger(n) || n < 0) ||
              amounts.filter((n) => n > 0).length < 2 ||
              amounts.reduce((a, b) => a + b, 0) > 1_000_000_000
            ) {
              setError(
                "请填写非负整数筹码，至少两位玩家有筹码，全桌总额最多 1,000,000,000。",
              );
              return;
            }
            dispatch({
              type: resetting ? "reset-session" : "initial-chips",
              amounts,
            });
            setResetting(false);
            setInputs(null);
            setError("");
          }}
        >
          {resetting ? "确认重置并分配筹码" : "保存初始筹码"}
        </button>
      )}
      <button
        type="button"
        className={s.resetButton}
        onClick={() => {
          setInputs(resetting ? null : book.initial.map(String));
          setResetting(!resetting);
          setError("");
        }}
      >
        {resetting ? "取消重置" : "重置全局对局"}
      </button>
      {error && (
        <p className={s.error} role="alert">
          {error}
        </p>
      )}
      <p className={s.fieldHint}>
        累计盈亏按已结算牌局计算。下注扣除剩余筹码，摊牌需确认底池赢家；撤销结算会同步恢复筹码。
      </p>
      {book.hands.length > 0 && (
        <details className={s.ledger}>
          <summary>每手输赢记录 · 已结算 {book.hands.length} 手</summary>
          <div className={s.ledgerScroll}>
            <table>
              <thead>
                <tr>
                  <th>牌局</th>
                  {book.initial.map((_, i) => (
                    <th key={i}>{seatName(i)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...book.hands].reverse().map((hand) => (
                  <tr key={hand.number}>
                    <th>第 {hand.number} 手</th>
                    {hand.balances.map((balance, i) => (
                      <td key={i}>
                        {signedChips(hand.payouts[i] - hand.committed[i])}
                        <small>结余 {balance}</small>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </section>
  );
}
