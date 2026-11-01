import { cardLabel, ranks, suits } from "../../model";
import s from "./Cards.module.css";

export function Card({
  value,
  onClick,
  onRemove,
  label,
  small = false,
}: {
  value: number | null;
  onClick?: () => void;
  onRemove?: () => void;
  label: string;
  small?: boolean;
}) {
  return (
    <div className={`${s.cardWrap} ${small ? s.smallCard : ""}`}>
      <button
        type="button"
        className={`${s.card} ${value === null ? s.emptyCard : ""} ${value !== null && value % 2 === 1 ? s.redCard : ""}`}
        aria-label={
          value === null ? `选择${label}` : `更换${label}：${cardLabel(value)}`
        }
        onClick={onClick}
        disabled={!onClick}
      >
        {value === null ? (
          <>
            <span className={s.cardPlus}>＋</span>
            <span className={s.cardHint}>{label}</span>
          </>
        ) : (
          <>
            <span className={s.corner}>
              {ranks[Math.floor(value / 4)]}
              <small>{suits[value % 4]}</small>
            </span>
            <span className={s.cardSuit}>{suits[value % 4]}</span>
            <span className={s.cardBottom}>{ranks[Math.floor(value / 4)]}</span>
          </>
        )}
      </button>
      {value !== null && onRemove && (
        <button
          type="button"
          className={s.removeCard}
          onClick={onRemove}
          aria-label={`移除${label}：${cardLabel(value)}`}
        >
          ×
        </button>
      )}
    </div>
  );
}
