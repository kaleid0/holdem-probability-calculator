import { ranks } from "./model";

export type WeightedPair = { cards: number[]; weight: number };
export type RangeCategory = "pair" | "suited" | "offsuit";
export const matrixRanks = "AKQJT98765432";
export function handClass(cards: number[]): string {
  const [a, b] = [...cards].sort((x, y) => y - x);
  return (
    ranks[Math.floor(a / 4)] +
    ranks[Math.floor(b / 4)] +
    (Math.floor(a / 4) === Math.floor(b / 4) ? "" : a % 4 === b % 4 ? "s" : "o")
  );
}
export function matrixLabel(row: number, column: number): string {
  return row === column
    ? matrixRanks[row].repeat(2)
    : row < column
      ? matrixRanks[row] + matrixRanks[column] + "s"
      : matrixRanks[column] + matrixRanks[row] + "o";
}
export function expandClass(label: string): [number, number][] {
  const a = ranks.indexOf(label[0]),
    b = ranks.indexOf(label[1]);
  const pairs: [number, number][] = [];
  for (let x = 0; x < 4; x++)
    for (let y = 0; y < 4; y++) {
      if (a === b ? x >= y : label[2] === "s" ? x !== y : x === y) continue;
      const values = [a * 4 + x, b * 4 + y].sort((p, q) => p - q);
      pairs.push([values[0], values[1]]);
    }
  return pairs;
}
export function serializeCombos(combos: WeightedPair[]): string {
  const groups = new Map<string, WeightedPair[]>();
  for (const combo of combos) {
    const key = handClass(combo.cards);
    groups.set(key, [...(groups.get(key) ?? []), combo]);
  }
  return [...groups.entries()]
    .map(([label, items]) => {
      const full = expandClass(label).length;
      if (
        items.length === full &&
        items.every((item) => item.weight === items[0].weight)
      )
        return `${label}:${items[0].weight}`;
      return items
        .map(
          (item) =>
            item.cards
              .map((card) => ranks[Math.floor(card / 4)] + "shcd"[card % 4])
              .join("") +
            ":" +
            item.weight,
        )
        .join(",");
    })
    .join(",");
}

export function categoryOf(label: string): RangeCategory {
  return label[0] === label[1]
    ? "pair"
    : label.endsWith("s")
      ? "suited"
      : "offsuit";
}

// Input convenience only: this fixed score is not an equity ranking or strategy chart.
function inputScore(label: string): number {
  const high = ranks.indexOf(label[0]) + 2,
    low = ranks.indexOf(label[1]) + 2;
  if (high === low) return 35 + high * 5;
  const gap = high - low - 1;
  return (
    high * 3 +
    low * 1.6 +
    (label.endsWith("s") ? 6 : 0) +
    (gap === 0 ? 5 : gap === 1 ? 2 : 0) -
    Math.min(gap, 5) * 1.5
  );
}
export const orderedClasses = Array.from({ length: 169 }, (_, i) =>
  matrixLabel(Math.floor(i / 13), i % 13),
).sort((a, b) => inputScore(b) - inputScore(a) || a.localeCompare(b));

export function buildWidth(
  percent: number,
  category?: RangeCategory,
): WeightedPair[] {
  const classes = orderedClasses.filter(
    (label) => !category || categoryOf(label) === category,
  );
  const target =
    (classes.reduce((sum, label) => sum + expandClass(label).length, 0) *
      Math.max(0, Math.min(100, percent))) /
    100;
  const result: WeightedPair[] = [];
  for (const label of classes) {
    if (result.length >= target) break;
    result.push(...expandClass(label).map((cards) => ({ cards, weight: 1 })));
  }
  return result;
}

export function rangeStats(combos: WeightedPair[], knownCards: number[]) {
  const known = new Set(knownCards);
  const classWeights: Record<string, number> = {};
  for (const combo of combos) {
    const label = handClass(combo.cards);
    classWeights[label] = Math.max(classWeights[label] ?? 0, combo.weight);
  }
  const effective = combos.filter(
    (combo) => !combo.cards.some((card) => known.has(card)),
  ).length;
  return {
    total: combos.length,
    effective,
    blocked: combos.length - effective,
    classWeights,
    coverage: (combos.length / 1326) * 100,
    weightedCoverage:
      (combos.reduce((sum, combo) => sum + combo.weight, 0) / 1326) * 100,
  };
}

function expandToken(token: string): number[][] {
  if (/^[2-9TJQKA][shcd][2-9TJQKA][shcd]$/.test(token)) {
    const cards = [0, 2].map(
      (i) => ranks.indexOf(token[i]) * 4 + "shcd".indexOf(token[i + 1]),
    );
    if (cards[0] === cards[1]) throw new Error("同一组合不能重复用牌");
    return [cards.sort((a, b) => a - b)];
  }
  const valid = (label: string) => {
    if (!/^[2-9TJQKA]{2}[so]?$/.test(label))
      throw new Error(`无效手牌类别：${label}`);
    if (
      ranks.indexOf(label[0]) < ranks.indexOf(label[1]) ||
      (label[0] === label[1] && label.length > 2)
    )
      throw new Error(`手牌须高牌在前，对子不能加 s/o：${label}`);
  };
  const expand = (label: string): number[][] => {
    valid(label);
    return label.length === 2 && label[0] !== label[1]
      ? [...expandClass(label + "s"), ...expandClass(label + "o")]
      : expandClass(label);
  };
  if (token.endsWith("+")) {
    const base = token.slice(0, -1);
    valid(base);
    const high = ranks.indexOf(base[0]),
      low = ranks.indexOf(base[1]);
    const labels =
      high === low
        ? [...ranks.slice(high)].map((rank) => rank + rank)
        : [...ranks.slice(low, high)].map(
            (rank) => base[0] + rank + base.slice(2),
          );
    return labels.flatMap(expand);
  }
  if (token.includes("-")) {
    const parts = token.split("-");
    if (parts.length !== 2) throw new Error("区间须为 AA-TT 或 AJs-AKs");
    const [a, b] = parts;
    valid(a);
    valid(b);
    const pair = a[0] === a[1] && b[0] === b[1];
    if (!pair && (a[0] !== b[0] || a.slice(2) !== b.slice(2)))
      throw new Error("非对子区间须保持相同高牌和同花类型");
    const indexes = [ranks.indexOf(a[1]), ranks.indexOf(b[1])].sort(
      (x, y) => x - y,
    );
    return [...ranks.slice(indexes[0], indexes[1] + 1)].flatMap((rank) =>
      expand(pair ? rank + rank : a[0] + rank + a.slice(2)),
    );
  }
  return expand(token);
}

// Mirrors the documented grammar for immediate UI feedback; the backend validates again on submit.
export function parseRange(text: string): WeightedPair[] {
  if (!text.trim()) return [];
  const combos = new Map<string, WeightedPair>();
  text
    .trim()
    .split(/[,;\s]+/)
    .filter(Boolean)
    .forEach((token, index) => {
      try {
        const parts = token.split(":");
        if (parts.length > 2) throw new Error("权重格式应为 AKs:0.5");
        const raw = parts[1];
        const weight = raw === undefined ? 1 : Number(raw);
        if (
          raw !== undefined &&
          !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(raw)
        )
          throw new Error("权重须为十进制数，例如 0.5");
        if (
          (raw !== undefined && (!raw.trim() || !Number.isFinite(weight))) ||
          weight < 0 ||
          weight > 1 ||
          (weight > 0 && weight < 0.000001)
        )
          throw new Error("权重须为 0 或 0.000001–1 的有限数");
        for (const cards of expandToken(parts[0])) {
          const key = cards.join(",");
          if (weight > (combos.get(key)?.weight ?? 0))
            combos.set(key, { cards, weight });
        }
      } catch (error) {
        throw new Error(
          `范围第 ${index + 1} 项「${token}」：${error instanceof Error ? error.message : "格式不正确"}`,
        );
      }
    });
  const result = [...combos.values()];
  if (!result.length) throw new Error("范围没有正权重的手牌组合");
  return result;
}
