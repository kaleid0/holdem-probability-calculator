import { useState } from "react";
import { useScenario } from "./state";
import { tableFor } from "./session";
import { tableSchema } from "./table";
import { createGame, startGame, seatName } from "./liveGame";
import s from "./TableSettings.module.css";

export default function TableSettings() {
  const { draft, game, dispatch } = useScenario();
  const table = tableFor(draft);
  const count = draft.opponents.length + 1;
  const locked = !!game && game.phase !== "hand" && game.phase !== "finished";
  const active =
    1 +
    draft.opponents.filter((o) => !o.folded).length -
    (game?.folded[0] ? 1 : 0);
  const preview = startGame(
    createGame(count, table.dealer, table.smallBlind, table.bigBlind),
  );
  const [blindInput, setBlindInput] = useState<{
    small: string;
    big: string;
  } | null>(null);
  const [error, setError] = useState("");
  const update = (nextCount = count, nextTable = table) => {
    dispatch({ type: "table", count: nextCount, table: nextTable });
    setBlindInput(null);
    setError("");
  };
  return (
    <section className={s.panel} aria-label="共同牌桌设置">
      <details open>
        <summary>
          <strong>
            <span className={s.tableIcon} aria-hidden="true">
              ♠
            </span>
            牌桌设置
          </strong>
          <span className={s.summaryPills}>
            <span>{count} 人桌</span>
            <span>{seatName(table.dealer)} 庄</span>
            <span>{locked ? "本手已锁定" : "两种录入方式共用"}</span>
          </span>
        </summary>
        <div className={s.fields}>
          <fieldset
            className={s.countField}
            disabled={locked}
            aria-label="牌桌人数"
          >
            <legend>
              牌桌人数 <small>包含自己</small>
            </legend>
            <div className={s.countOptions}>
              {Array.from({ length: 8 }, (_, i) => i + 2).map((n) => (
                <button
                  key={n}
                  type="button"
                  aria-label={`${n} 人`}
                  aria-pressed={count === n}
                  className={count === n ? s.selectedCount : ""}
                  onClick={() => update(n)}
                >
                  {n}
                </button>
              ))}
            </div>
            <p className={s.fieldHint}>按顺时针编号，玩家 1 是我</p>
          </fieldset>
          <fieldset
            className={s.dealerField}
            disabled={locked}
            aria-label="选择庄位"
          >
            <legend>
              谁是庄家 <small>点选一个座位</small>
            </legend>
            <div className={s.seatOptions}>
              {Array.from({ length: count }, (_, i) => (
                <button
                  key={i}
                  type="button"
                  aria-label={`${seatName(i)}坐庄`}
                  aria-pressed={table.dealer === i}
                  className={`${s.seat} ${table.dealer === i ? s.selectedSeat : ""}`}
                  onClick={() => update(count, { ...table, dealer: i })}
                >
                  <span className={s.avatar} aria-hidden="true">
                    {i + 1}
                  </span>
                  <span className={s.seatText}>
                    {i === 0 ? "我" : `玩家 ${i + 1}`}
                    <small>
                      {table.dealer === i
                        ? "庄家"
                        : `座位 ${String(i + 1).padStart(2, "0")}`}
                    </small>
                  </span>
                  {table.dealer === i && (
                    <span className={s.dealerChip} aria-hidden="true">
                      D
                    </span>
                  )}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset disabled={locked} className={s.blinds}>
            <legend>
              盲注 <small>筹码单位</small>
            </legend>
            <div className={s.blindPair}>
              <label>
                小盲
                <input
                  aria-label="小盲"
                  inputMode="numeric"
                  value={blindInput?.small ?? table.smallBlind}
                  onChange={(e) =>
                    setBlindInput({
                      small: e.target.value,
                      big: blindInput?.big ?? String(table.bigBlind),
                    })
                  }
                />
              </label>
              <span className={s.blindDivider} aria-hidden="true">
                /
              </span>
              <label>
                大盲
                <input
                  aria-label="大盲"
                  inputMode="numeric"
                  value={blindInput?.big ?? table.bigBlind}
                  onChange={(e) =>
                    setBlindInput({
                      big: e.target.value,
                      small: blindInput?.small ?? String(table.smallBlind),
                    })
                  }
                />
              </label>
            </div>
            {blindInput && (
              <button
                type="button"
                onClick={() => {
                  const result = tableSchema.safeParse({
                    ...table,
                    smallBlind: Number(blindInput.small),
                    bigBlind: Number(blindInput.big),
                  });
                  if (!result.success) {
                    setError(
                      "请填写正整数盲注，大盲须不小于小盲（小盲最多 1,000,000）。",
                    );
                    return;
                  }
                  update(count, result.data);
                }}
              >
                应用盲注
              </button>
            )}
          </fieldset>
        </div>
        {error && (
          <p role="alert" className={s.error}>
            {error}
          </p>
        )}
        <p className={s.hint}>
          <span className={s.statusDot} aria-hidden="true" />
          {count} 人坐席 · {active} 人在局。
          {locked
            ? "本手记录进行中；开始新一手后可修改牌桌。"
            : `${preview.log.join(" · ")}；翻前 ${seatName(preview.actor)} 先行动。`}
        </p>
      </details>
    </section>
  );
}
