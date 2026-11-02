import { openTab } from "./workspace";
import { expect, test } from "@playwright/test";

test("side pot analysis survives reload and displays eligibility and refunds", async ({
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

  await openTab(page, "精细分析");
  await page.getByRole("button", { name: "执行精细分析", exact: true }).click();
  const result = page.getByRole("region", { name: "计算结果", exact: true });
  await expect(
    result.getByRole("heading", { name: "主池与边池 · 跟注后直接摊牌" }),
  ).toBeVisible();
  const pots = result.getByRole("table");
  await expect(pots).toContainText("主池");
  await expect(pots).toContainText("边池 1");
  await expect(pots).toContainText("未跟注退回");
  await expect(pots).toContainText("50 / 我");
  await expect(result).toContainText("预期可得筹码：");
  await expect(result).toContainText("跟注 EV 的适用条件尚未满足");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: "../.local/side-pots-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: "../.local/side-pots-desktop.png",
    fullPage: true,
  });
});
