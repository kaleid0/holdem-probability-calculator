import type { Draft } from "./model";
import type { LiveGame } from "./liveGame";
import { canRaise, remainingChips } from "./liveGame";
import { handClass, parseRange } from "./ranges";
import type { QuickAdvice } from "./quickAdvice";

// Project-authored conservative training rules, not solver output or a sourced chart.
export const preflopRules = {
  early: "66+,ATs+,KJs+,QJs,AQo+",
  middle: "55+,A9s+,KTs+,QTs+,JTs,AJo+,KQo",
  late: "22+,A2s+,K9s+,Q9s+,J9s+,T9s,98s,ATo+,KJo+,QJo",
  premium: "QQ+,AKs,AKo",
  defend: "88+,AJs+,KQs,AQo+",
};
const classes = Object.fromEntries(
  Object.entries(preflopRules).map(([key, text]) => [
    key,
    new Set(parseRange(text).map((c) => handClass(c.cards))),
  ]),
);

export function preflopAdvice(
  draft: Draft,
  game?: LiveGame | null,
): QuickAdvice | null {
  if (
    !game ||
    game.phase !== "betting" ||
    game.street !== 0 ||
    game.actor !== 0 ||
    game.folded[0] ||
    !game.historyComplete ||
    !game.stacks ||
    draft.boardSize !== 0 ||
    draft.board.length ||
    draft.hero.some((c) => c == null) ||
    game.total.reduce((a, b) => a + b, 0) !== Number(draft.pot) ||
    Math.min(game.highest - game.paid[0], remainingChips(game, 0)) !==
      Number(draft.call)
  )
    return null;
  const opening =
    game.openingSeats ?? game.stacks.flatMap((n, i) => (n > 0 ? [i] : []));
  const ordered = [...opening].sort(
    (a, b) =>
      ((a - game.dealer + game.count) % game.count) -
      ((b - game.dealer + game.count) % game.count),
  );
  const sb = ordered.length === 2 ? game.dealer : ordered[1];
  const bb = ordered.length === 2 ? ordered[1] : ordered[2];
  const cutoff = ordered.length >= 4 ? ordered.at(-1) : undefined;
  const position =
    game.dealer === 0
      ? "庄位 BTN"
      : sb === 0
        ? "小盲 SB"
        : bb === 0
          ? "大盲 BB"
          : cutoff === 0
            ? "关煞位 CO"
            : "前中位";
  const activeStacks = game.folded.flatMap((f, i) =>
    f || i === 0 ? [] : [remainingChips(game, i)],
  );
  const effective = Math.min(
    remainingChips(game, 0),
    Math.max(...activeStacks),
  );
  const depth = effective / game.bigBlind;
  const hand = handClass(draft.hero as number[]);
  const decisions = game.events.filter(
    (e) =>
      e.kind === "action" &&
      e.action !== "smallBlind" &&
      e.action !== "bigBlind",
  );
  const raises = decisions.filter(
    (e) => e.kind === "action" && (e.action === "raise" || e.action === "bet"),
  ).length;
  const limpers = decisions.filter(
    (e) => e.kind === "action" && e.action === "call",
  ).length;
  const band =
    game.dealer === 0 || cutoff === 0 || ordered.length === 2
      ? "late"
      : ordered.length <= 5
        ? "middle"
        : "early";
  const context = `${position}，${hand}，有效剩余筹码 ${depth.toFixed(1)} BB（按最大可争夺对手计算）。`;
  const stability = "项目启发式规则 v1；未计算加注 EV，非 GTO 表";
  const answer = (title: string, reason: string): QuickAdvice => ({
    title,
    reason: context + reason,
    stability,
  });
  if (
    depth < 20 ||
    raises > 1 ||
    decisions.some((e) => e.kind === "action" && e.player === 0) ||
    activeStacks.some((n) => n === 0)
  )
    return answer(
      "翻前复杂局面，需复核",
      "短筹码、全下或再次行动超出当前规则覆盖；请结合范围权益复核。",
    );
  const due = Number(draft.call);
  const chosen = raises ? "defend" : band;
  const playable = classes[chosen].has(hand);
  if (!playable)
    return answer(
      due ? "倾向弃牌" : "倾向过牌",
      `手牌未进入${raises ? "面对单次加注" : band === "late" ? "后位" : "前中位"}规则范围。`,
    );
  if (raises && !classes.premium.has(hand)) {
    if (game.highest > 4 * game.bigBlind || due > effective * 0.1)
      return answer("面对较大加注，需复核", "当前规则不自动推荐高成本跟注。");
    return answer(
      due ? `倾向跟注 ${due}` : "倾向过牌",
      "手牌进入单次小额加注防守范围；后续仍可下注。",
    );
  }
  if (!canRaise(game))
    return answer(
      due ? `跟注参考 ${due}` : "倾向过牌",
      "当前加注权未开放，不建议非法再加注。",
    );
  const target = raises
    ? Math.ceil(game.highest * 3)
    : Math.ceil(game.bigBlind * ((depth >= 40 ? 2.5 : 2.2) + limpers));
  const raiseTo = Math.max(game.highest + game.minRaise, target);
  // Avoid an accidental commitment or shove from a coarse opening heuristic.
  if (
    !Number.isSafeInteger(raiseTo) ||
    raiseTo - game.paid[0] > effective * 0.3
  )
    return answer(
      "加注投入较大，需复核",
      "建议尺度会占用过多有效筹码，暂不自动给金额。",
    );
  return answer(
    `倾向加注至 ${raiseTo}`,
    `本街总额 ${raiseTo}，本次追加 ${raiseTo - game.paid[0]}；${raises ? "优质牌单次再加注" : "位置开池规则"}。`,
  );
}
