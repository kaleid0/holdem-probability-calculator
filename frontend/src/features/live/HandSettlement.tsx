import { useState } from "react";
import { gamePots, seatName } from "../../liveGame";
import type { LiveGame } from "../../liveGame";
import { signedChips } from "../../bankroll";
import { useScenario } from "../../state";
import s from "./LiveTable.module.css";

export default function HandSettlement({ game }: { game: LiveGame }) {
  const { dispatch } = useScenario();
  const [winners, setWinners] = useState<number[][]>([]);
  const pots = gamePots(game);
  if (game.payouts)
    return (
      <section className={s.settlement} aria-label="本手结算">
        <h3>本手已结算</h3>
        {game.total.map((total, i) => (
          <p key={i}>
            {seatName(i)} · 投入 {total} · 收回 {game.payouts![i]} · 本手盈亏{" "}
            <b>{signedChips(game.payouts![i] - total)}</b>
            {game.stacks &&
              ` · 结余 ${game.stacks[i] - total + game.payouts![i]}`}
          </p>
        ))}
      </section>
    );
  return (
    <section className={s.settlement} aria-label="确认摊牌结算">
      <h3>确认底池赢家</h3>
      <p>按实际摊牌结果选择，每个底池可多选以平分。确认后记入筹码账本。</p>
      {pots.map((pot, index) => (
        <fieldset key={index}>
          <legend>
            {index === 0 ? "主池" : `边池 ${index}`} · {pot.amount} 筹码
          </legend>
          {pot.refund !== undefined ? (
            <p>未被跟注，退回 {seatName(pot.refund)}</p>
          ) : pot.eligible.length === 1 ? (
            <p>{seatName(pot.eligible[0])} 自动获得</p>
          ) : (
            <div className={s.winners}>
              {pot.eligible.map((seat) => (
                <label key={seat}>
                  <input
                    type="checkbox"
                    checked={winners[index]?.includes(seat) ?? false}
                    onChange={(e) =>
                      setWinners((previous) => {
                        const updated = [...previous];
                        updated[index] = e.target.checked
                          ? [...(previous[index] ?? []), seat]
                          : previous[index].filter((n) => n !== seat);
                        return updated;
                      })
                    }
                  />
                  {seatName(seat)}
                </label>
              ))}
            </div>
          )}
        </fieldset>
      ))}
      <button
        className={s.primary}
        disabled={pots.some(
          (pot, i) =>
            pot.refund === undefined &&
            pot.eligible.length > 1 &&
            !winners[i]?.length,
        )}
        onClick={() => dispatch({ type: "settle", winners })}
      >
        确认结算筹码
      </button>
    </section>
  );
}
