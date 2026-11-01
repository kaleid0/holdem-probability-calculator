import { openTab } from "./workspace";
import { expect, test } from "@playwright/test";

test("short stacks run out the board and settle main pot, side pot and refund", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const setup = page.getByRole("region", { name: "共同牌桌设置" });
  await openTab(page, "牌桌与筹码");
  await setup.getByRole("button", { name: "3 人", exact: true }).click();
  for (const [i, value] of [100, 20, 50].entries()) {
    await setup
      .getByLabel(`玩家 ${i + 1}${i === 0 ? "（我）" : ""}初始筹码`, {
        exact: true,
      })
      .fill(String(value));
  }
  await setup.getByRole("button", { name: "保存初始筹码" }).click();
  await openTab(page, "当前牌局");
  await page.getByRole("button", { name: "逐步记录", exact: false }).click();
  await page.getByRole("button", { name: "开始记录新一手 →" }).click();
  const live = page.getByRole("region", { name: "真实牌局", exact: true });
  await live.getByRole("button", { name: "选择手牌 1", exact: true }).click();
  for (const name of ["黑桃A", "黑桃K"])
    await page.getByRole("button", { name, exact: true }).click();
  await live.getByRole("button", { name: "开始牌局 →" }).click();
  await live.getByRole("button", { name: "加注", exact: true }).click();
  await expect(live.getByRole("slider")).toHaveAttribute("max", "100");
  await live.getByRole("slider").fill("100");
  await openTab(page, "对手与范围");
  await openTab(page, "精细分析");
  await openTab(page, "当前牌局");
  await expect(live.getByRole("slider")).toHaveValue("100");
  await live.getByRole("button", { name: "确认加注 100", exact: true }).click();
  await live.getByRole("button", { name: "全下跟注 15", exact: true }).click();
  await live.getByRole("button", { name: "全下跟注 40", exact: true }).click();
  await page.reload();
  for (const [street, offset, cards] of [
    ["翻牌", 1, ["黑桃2", "黑桃3", "黑桃4"]],
    ["转牌", 4, ["黑桃5"]],
    ["河牌", 5, ["黑桃6"]],
  ] as const) {
    await openTab(page, "当前牌局");
    await live
      .getByRole("button", { name: `选择公共牌 ${offset}`, exact: true })
      .click();
    for (const name of cards)
      await page.getByRole("button", { name, exact: true }).click();
    await live
      .getByRole("button", { name: `确认${street}，继续发牌 →` })
      .click();
  }
  const settlement = live.getByRole("region", { name: "确认摊牌结算" });
  const main = settlement.getByRole("group", { name: "主池 · 60 筹码" });
  await main.getByRole("checkbox", { name: "玩家 2", exact: true }).check();
  const side = settlement.getByRole("group", { name: "边池 1 · 60 筹码" });
  await side.getByRole("checkbox", { name: "玩家 3", exact: true }).check();
  await openTab(page, "牌桌与筹码");
  await openTab(page, "当前牌局");
  await expect(
    main.getByRole("checkbox", { name: "玩家 2", exact: true }),
  ).toBeChecked();
  await expect(
    side.getByRole("checkbox", { name: "玩家 3", exact: true }),
  ).toBeChecked();
  await expect(settlement).toContainText("未被跟注，退回 玩家 1（我）");
  await live.getByRole("button", { name: "确认结算筹码" }).click();
  await openTab(page, "牌桌与筹码");
  await expect(setup).toContainText("剩余 50 · 累计盈亏 -50");
  await expect(setup).toContainText("剩余 60 · 累计盈亏 +40");
  await expect(setup).toContainText("剩余 60 · 累计盈亏 +10");
});

test("initial chips, fold settlement, undo, reload and a later split showdown", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const setup = page.getByRole("region", { name: "共同牌桌设置" });
  await openTab(page, "牌桌与筹码");
  const ledger = setup.getByRole("region", { name: "筹码账本" });
  await ledger.getByLabel("玩家 1（我）初始筹码", { exact: true }).fill("100");
  await ledger.getByLabel("玩家 2初始筹码", { exact: true }).fill("200");
  await ledger.getByRole("button", { name: "保存初始筹码" }).click();
  await openTab(page, "当前牌局");
  await page.getByRole("button", { name: "逐步记录", exact: false }).click();
  await page.getByRole("button", { name: "开始记录新一手 →" }).click();
  const live = page.getByRole("region", { name: "真实牌局", exact: true });
  async function start() {
    await openTab(page, "当前牌局");
    await live.getByRole("button", { name: "选择手牌 1", exact: true }).click();
    for (const name of ["黑桃A", "黑桃K"])
      await page.getByRole("button", { name, exact: true }).click();
    await live.getByRole("button", { name: "开始牌局 →" }).click();
  }
  await start();
  await openTab(page, "牌桌与筹码");
  await expect(ledger).toContainText("剩余 95 · 累计盈亏 0");
  await expect(ledger.getByLabel("玩家 1（我）初始筹码")).toBeDisabled();
  await openTab(page, "当前牌局");
  await live.getByRole("button", { name: "弃牌", exact: true }).click();
  await openTab(page, "牌桌与筹码");
  await expect(ledger).toContainText("剩余 95 · 累计盈亏 -5");
  await expect(ledger).toContainText("剩余 205 · 累计盈亏 +5");
  await page.reload();
  await openTab(page, "牌桌与筹码");
  await expect(ledger).toContainText("已结算 1 手");
  await openTab(page, "当前牌局");
  await live.getByRole("button", { name: "撤销上一步" }).click();
  await openTab(page, "牌桌与筹码");
  await expect(ledger).toContainText("剩余 95 · 累计盈亏 0");
  await expect(ledger).not.toContainText("已结算 1 手");
  await openTab(page, "当前牌局");
  await live.getByRole("button", { name: "弃牌", exact: true }).click();
  await live.getByRole("button", { name: "开始新一手 →" }).click();
  await openTab(page, "牌桌与筹码");
  await expect(ledger).toContainText("剩余 95 · 累计盈亏 -5");
  await start();
  await openTab(page, "当前牌局");
  await live.getByRole("button", { name: "跟注 5", exact: true }).click();
  await live.getByRole("button", { name: "过牌", exact: true }).click();
  for (const [street, cards] of [
    ["翻牌", ["黑桃2", "黑桃3", "黑桃4"]],
    ["转牌", ["黑桃5"]],
    ["河牌", ["黑桃6"]],
  ] as const) {
    const offset = street === "翻牌" ? 1 : street === "转牌" ? 4 : 5;
    await live
      .getByRole("button", { name: `选择公共牌 ${offset}`, exact: true })
      .click();
    for (const name of cards)
      await page.getByRole("button", { name, exact: true }).click();
    await live
      .getByRole("button", { name: `确认${street}，继续下注 →` })
      .click();
    await live.getByRole("button", { name: "过牌", exact: true }).click();
    await live.getByRole("button", { name: "过牌", exact: true }).click();
  }
  await expect(
    live.getByRole("button", { name: "开始新一手 →" }),
  ).toBeDisabled();
  await live
    .getByRole("checkbox", { name: "玩家 1（我）", exact: true })
    .check();
  await live.getByRole("checkbox", { name: "玩家 2", exact: true }).check();
  await live.getByRole("button", { name: "确认结算筹码" }).click();
  await openTab(page, "牌桌与筹码");
  await expect(ledger).toContainText("已结算 2 手");
  await expect(ledger).toContainText("剩余 95 · 累计盈亏 -5");
  await openTab(page, "当前牌局");
  await expect(
    live.getByRole("button", { name: "开始新一手 →" }),
  ).toBeEnabled();
  await openTab(page, "牌桌与筹码");
  await ledger.locator("summary").click();
  await expect(ledger.getByRole("table")).toContainText("第 2 手");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "../.local/chip-ledger-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: "../.local/chip-ledger-desktop.png",
    fullPage: true,
  });
});
