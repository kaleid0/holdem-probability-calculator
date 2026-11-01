# 结构化行动序列

逐步记录的 `LiveGame.events` 是当前一手牌的有序事件数组。界面文字通过 `gameLog(game)` 生成；新操作不会再写入中文字符串。事件随完整牌局保存到浏览器，撤销会同时撤回对应事件，重新行动从撤销后的序号继续。

数据类型、Zod 校验和查询方法见 `frontend/src/handHistory.ts`，写入入口是 `liveGame.ts` 中的 `startGame`、`act`、`nextStreet`。

## 事件类型

| kind | 内容 |
| --- | --- |
| `action` | 盲注、弃牌、过牌、跟注、首次下注或加注 |
| `street` | 进入翻牌、转牌、河牌，以及当时的公共牌快照 |
| `handEnd` | 其他人均弃牌或河牌下注结束；后者不推断摊牌赢家 |

每个事件都有从 1 开始的 `sequence` 和 `street`（0/3/4/5）。`sequence` 是整桌事件序号，按玩家筛选后保留原序号，便于还原玩家之间的行动关系。

## 玩家动作字段

| 字段 | 含义 |
| --- | --- |
| `player` | 本手座位，从 0 开始，0 为我 |
| `action` | `smallBlind` / `bigBlind` / `fold` / `check` / `call` / `bet` / `raise` |
| `amount` | 本次追加筹码；过牌和弃牌为 0 |
| `streetTotal` | 操作后本轮累计投入，即加注动作的“加注至”金额 |
| `totalCommitted` | 操作后本手累计投入 |
| `toCall` | 操作前需要追加多少才能跟齐 |
| `highestBefore` / `minRaiseBefore` | 操作前本轮最高投入、最小加注增量 |
| `potBefore` / `potAfter` | 操作前后底池 |
| `activePlayersBefore` | 操作前在局人数，包含当前行动者 |

所有金额均为筹码。盲注是强制投入，统计自愿入池或主动下注时可按 `action` 排除。`bet` 与 `raise`、`check` 与 `call` 已在记录时区分，不需要再解析显示文字。

例如，小盲已经投入 5，面对最高投入 10 加注至 30：

```json
{
  "kind": "action",
  "sequence": 4,
  "street": 0,
  "player": 1,
  "action": "raise",
  "amount": 25,
  "streetTotal": 30,
  "totalCommitted": 30,
  "toCall": 5,
  "highestBefore": 10,
  "minRaiseBefore": 10,
  "potBefore": 25,
  "potAfter": 50,
  "activePlayersBefore": 3
}
```

## 按玩家读取

```ts
import { playerActions, actionsByPlayer } from "./handHistory";

const opponentSequence = playerActions(game, 1);
const allSequences = actionsByPlayer(game); // 数组下标对应座位
const voluntaryActions = opponentSequence.filter(
  (event) => event.action !== "smallBlind" && event.action !== "bigBlind",
);
```

`street` 事件的 `board` 是当时已知公共牌的独立副本；没有提供公共牌上下文的底层调用记为 `null`。界面的确认发牌操作会提供完整公共牌。

## 兼容与后续策略

旧存档可以继续恢复。旧版中文记录保存在 `log` 中作为文字前缀，升级后的新动作写入 `events`；这类牌局的 `historyComplete` 为 `false`。策略必须检查此标记，不能将缺失的早期行动当成未发生。新开局的 `historyComplete` 为 `true`。

本次持久化范围为当前一手及其撤销快照；开始新一手会清空当前事件。座位编号是本手内的标识。跨手习惯分析还需要独立的玩家身份与多手归档，不能直接把不同手的同号座位当成同一个人。现有分析 API 尚不使用这些事件，后续策略可基于以上数据合约接入。

## 跨手筹码账本

`Draft.bankroll` 保存同一桌固定座位的 `initial`（初始筹码）、`balances`（最近一次结算后的余额）和 `hands`（每手投入、收回及结余）。每手净输赢为 `payouts[i] - committed[i]`，累计盈亏为 `balances[i] - initial[i]`。开始新一手保留账本；已结算后锁定人数与初始筹码，重置牌局可开始新的账本。

新牌局的 `LiveGame.stacks` 是本手开始时的筹码快照，行动期间剩余筹码为 `stacks[i] - total[i]`，结算后再加 `payouts[i]`。下注不直接改动账本结余，结算只记账一次；撤销最后一次弃牌或摊牌结算会一起恢复账本。旧版无 `stacks` 的当前牌局沿用原记录方式，下一手开始启用筹码账本。

`gamePots` 按投入与获奖资格划分底池，相同获奖资格的层合并，单人未被跟注的部分退回。`settleGame` 接受逐池赢家数组，多人平分时无法均分的筹码从庄家左侧依次分配。零筹码座位在后续牌局跳过。摊牌确认是实际结果，不使用权益模拟推断赢家。此处边池仅用于实际筹码结算，现有分析 API 仍以单底池计算权益和跟注 EV。
