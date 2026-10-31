import { useMemo, useState } from "react";
import {
  buildWidth,
  categoryOf,
  expandClass,
  handClass,
  matrixLabel,
  parseRange,
  rangeStats,
  serializeCombos,
} from "./ranges";
import type { RangeCategory, WeightedPair } from "./ranges";
import styles from "./RangeEditor.module.css";

export default function RangeEditor({
  value,
  knownCards,
  onChange,
  player,
}: {
  value: string;
  knownCards: number[];
  onChange: (text: string) => void;
  player: number;
}) {
  const parsed = useMemo(() => {
    try {
      return { combos: parseRange(value), error: "" };
    } catch (error) {
      return {
        combos: [] as WeightedPair[],
        error: error instanceof Error ? error.message : "范围格式错误",
      };
    }
  }, [value]);
  const stats = useMemo(
    () => rangeStats(parsed.combos, knownCards),
    [parsed.combos, knownCards],
  );
  const [brushWeight, setBrushWeight] = useState(100);
  const [mode, setMode] = useState("toggle");
  const [widthIntent, setWidthIntent] = useState<{
    source: string;
    percent: number;
  } | null>(null);
  const [weightIntent, setWeightIntent] = useState<{
    source: string;
    percent: number;
    basis: WeightedPair[];
  } | null>(null);
  const uniform =
    weightIntent?.source === value
      ? weightIntent.percent
      : parsed.combos.length
        ? Math.round(
            (parsed.combos.reduce((sum, c) => sum + c.weight, 0) /
              parsed.combos.length) *
              100,
          )
        : 100;
  const width =
    widthIntent?.source === value
      ? widthIntent.percent
      : Math.round(stats.coverage);
  const editable = !parsed.error;
  function emit(combos: WeightedPair[]) {
    const text = combos.length ? serializeCombos(combos) : "";
    onChange(text);
    return text;
  }
  function setWidth(percent: number) {
    const source = emit(
      buildWidth(percent).map((c) => ({
        ...c,
        weight: (uniform || 100) / 100,
      })),
    );
    setWidthIntent({ source, percent });
    setWeightIntent(null);
  }
  function setUniform(percent: number) {
    const basis =
      weightIntent?.source === value ? weightIntent.basis : parsed.combos;
    const source = emit(
      percent ? basis.map((c) => ({ ...c, weight: percent / 100 })) : [],
    );
    setWeightIntent({ source, percent, basis });
    setWidthIntent(null);
  }
  function setCategory(category: RangeCategory, percent: number) {
    emit([
      ...parsed.combos.filter(
        (c) => categoryOf(handClass(c.cards)) !== category,
      ),
      ...buildWidth(percent, category).map((c) => ({
        ...c,
        weight: (uniform || 100) / 100,
      })),
    ]);
    setWidthIntent(null);
    setWeightIntent(null);
  }
  function edit(label: string) {
    if (!editable) return;
    const exists = parsed.combos.some((c) => handClass(c.cards) === label);
    const remaining = parsed.combos.filter((c) => handClass(c.cards) !== label);
    if (mode !== "remove" && !(mode === "toggle" && exists) && brushWeight > 0)
      remaining.push(
        ...expandClass(label).map((cards) => ({
          cards,
          weight: brushWeight / 100,
        })),
      );
    emit(remaining);
    setWidthIntent(null);
    setWeightIntent(null);
  }
  return (
    <div className={styles.editor}>
      <div
        className={styles.primaryControls}
        role="group"
        aria-label={`对手 ${player + 1} 范围快捷滑块`}
      >
        <label htmlFor={`width-${player}`}>
          <span>范围宽度</span>
          <output>
            {widthIntent?.source === value
              ? `${width}%`
              : `${stats.coverage.toFixed(1)}% · 自定义`}
          </output>
        </label>
        <input
          id={`width-${player}`}
          aria-label={`对手 ${player + 1} 范围宽度`}
          type="range"
          min="0"
          max="100"
          step="1"
          value={width}
          onChange={(event) => setWidth(Number(event.target.value))}
        />
        <div className={styles.presets}>
          {[5, 15, 30, 50, 100].map((percent) => (
            <button key={percent} onClick={() => setWidth(percent)}>
              {percent}%
            </button>
          ))}
          <button
            onClick={() => {
              onChange("");
              setWidthIntent(null);
              setWeightIntent(null);
            }}
          >
            清空
          </button>
        </div>
        <p className={styles.hint}>
          按固定启发式顺序扩展，调整会替换自定义范围。仅用于快速选牌，不是胜率排名或策略建议；整组纳入，实际比例略有取整。
        </p>
        <label htmlFor={`uniform-${player}`}>
          <span>已选组合 · 统一权重</span>
          <output>{uniform}%</output>
        </label>
        <input
          id={`uniform-${player}`}
          aria-label={`对手 ${player + 1} 统一权重`}
          type="range"
          min="0"
          max="100"
          step="1"
          value={uniform}
          disabled={
            !!parsed.error ||
            (!parsed.combos.length && !weightIntent?.basis.length)
          }
          onChange={(event) => setUniform(Number(event.target.value))}
        />
        <p className={styles.hint}>
          拖动会统一所有已选组合的权重，混合权重显示平均值。原本等权时，整体缩放不改变胜率；调整不同牌组的相对权重才会改变分布。
        </p>
      </div>
      <div className={styles.summary} role="status">
        共 {stats.total} 组合 · 已知牌阻断 {stats.blocked} · 有效{" "}
        {stats.effective}
        <span>
          原始覆盖 {stats.coverage.toFixed(1)}% · 加权覆盖{" "}
          {stats.weightedCoverage.toFixed(1)}%
        </span>
      </div>
      {stats.total > 0 && stats.effective === 0 && (
        <p className={styles.error}>范围已被已知牌完全阻断，请修改。</p>
      )}
      {parsed.error && (
        <p className={styles.error} role="alert">
          {parsed.error}
        </p>
      )}
      <details className={styles.advanced}>
        <summary>细分滑块 · 文本与精确输入</summary>
        <div className={styles.categoryControls}>
          {(
            [
              ["pair", "对子", 78],
              ["suited", "同花", 312],
              ["offsuit", "非同花", 936],
            ] as const
          ).map(([category, name, total]) => {
            const count = parsed.combos.filter(
              (c) => categoryOf(handClass(c.cards)) === category,
            ).length;
            return (
              <div key={category}>
                <label htmlFor={`${category}-${player}`}>
                  {name}
                  <output>
                    {count} / {total}
                  </output>
                </label>
                <input
                  id={`${category}-${player}`}
                  aria-label={`对手 ${player + 1} ${name}范围`}
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={Math.round((count / total) * 100)}
                  disabled={!editable}
                  onChange={(e) =>
                    setCategory(category, Number(e.target.value))
                  }
                />
              </div>
            );
          })}
        </div>
        <p className={styles.hint}>
          细分滑块只替换对应类别，其他类别保持不变。
        </p>
        <label htmlFor={`range-${player}`}>对手 {player + 1} 的手牌范围</label>
        <textarea
          id={`range-${player}`}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setWidthIntent(null);
            setWeightIntent(null);
          }}
          placeholder="TT+, AJs+, KQo:0.5, AsKh:0.25"
          spellCheck={false}
          maxLength={12000}
        />
        <p className={styles.hint}>
          支持 AA、AKs、AKo、TT+、AJs-AKs 和具体 AsKh；:0.5 表示组合权重
          50%。重叠取最大权重。原始输入实时本地校验，提交计算时后端再次校验。
        </p>
      </details>
      <div className={styles.tools}>
        <label>
          矩阵操作{" "}
          <select value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="toggle">切换选中</option>
            <option value="weight">设置权重</option>
            <option value="remove">移除</option>
          </select>
        </label>
        <label htmlFor={`brush-${player}`}>
          单格权重 <output>{brushWeight}%</output>
        </label>
        <input
          id={`brush-${player}`}
          aria-label={`对手 ${player + 1} 单格权重`}
          type="range"
          min="0"
          max="100"
          step="1"
          value={brushWeight}
          onChange={(e) => setBrushWeight(Number(e.target.value))}
        />
      </div>
      <div className={styles.scroll}>
        <div
          className={styles.matrix}
          aria-label={`对手 ${player + 1} 范围矩阵`}
        >
          {Array.from({ length: 169 }, (_, index) => {
            const row = Math.floor(index / 13),
              col = index % 13,
              label = matrixLabel(row, col),
              selected = stats.classWeights[label] ?? 0;
            return (
              <button
                key={label}
                aria-label={`${label} 范围权重 ${Math.round(selected * 100)}%`}
                aria-pressed={selected > 0}
                disabled={!editable}
                className={`${row === col ? styles.pair : row < col ? styles.suited : styles.offsuit} ${selected > 0 ? styles.selected : ""}`}
                title={`${label}：类别最大组合权重`}
                onClick={() => edit(label)}
              >
                <span>{label}</span>
                {selected > 0 && <small>{Math.round(selected * 100)}%</small>}
              </button>
            );
          })}
        </div>
      </div>
      <p className={styles.hint}>
        对角为对子，上方同花，下方非同花；可连续点选，无需等待。矩阵显示类别最大权重；有效组合数仅排除已知牌，多人范围冲突在计算时处理。
      </p>
    </div>
  );
}
