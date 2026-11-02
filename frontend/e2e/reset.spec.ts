import { expect, test } from "@playwright/test";
import { openTab } from "./workspace";

test("reset reallocates chips, clears the session, supports cancellation and survives reload", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await openTab(page, "当前牌局");
  await page.getByRole("button", { name: "逐步记录", exact: true }).click();
  await page.getByRole("button", { name: "开始记录新一手 →" }).click();
  const live = page.getByRole("region", { name: "真实牌局", exact: true });
  await live.getByRole("button", { name: "选择手牌 1", exact: true }).click();
  for (const name of ["黑桃A", "黑桃K"])
    await page.getByRole("button", { name, exact: true }).click();
  await live.getByRole("button", { name: "开始牌局 →" }).click();
  await live.getByRole("button", { name: "弃牌", exact: true }).click();
  await openTab(page, "牌桌与筹码");
  const setup = page.getByRole("region", { name: "共同牌桌设置" });
  const ledger = setup.getByRole("region", { name: "筹码账本" });
  const hero = ledger.getByLabel("玩家 1（我）初始筹码", { exact: true });
  const opponent = ledger.getByLabel("玩家 2初始筹码", { exact: true });
  await expect(ledger).toContainText("已结算 1 手");
  await expect(hero).toBeDisabled();
  await ledger
    .getByRole("button", { name: "重置全局对局", exact: true })
    .click();
  await hero.fill("500");
  await ledger.getByRole("button", { name: "取消重置", exact: true }).click();
  await expect(hero).toHaveValue("1000");
  await expect(hero).toBeDisabled();
  await expect(ledger).toContainText("已结算 1 手");

  // A reset can also discard an active, unfinished hand.
  await openTab(page, "当前牌局");
  await live.getByRole("button", { name: "撤销上一步", exact: true }).click();
  await live.getByRole("button", { name: "加注", exact: true }).click();
  await openTab(page, "牌桌与筹码");
  await ledger
    .getByRole("button", { name: "重置全局对局", exact: true })
    .click();
  await hero.fill("0");
  await ledger.getByRole("button", { name: "确认重置并分配筹码" }).click();
  await expect(ledger.getByRole("alert")).toContainText("至少两位玩家有筹码");
  await hero.fill("500");
  await opponent.fill("800");
  await page.screenshot({
    path: "../.local/reset-session-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: "../.local/reset-session-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await ledger.getByRole("button", { name: "确认重置并分配筹码" }).click();
  await expect(hero).toHaveValue("500");
  await expect(opponent).toHaveValue("800");
  await expect(hero).toBeEnabled();
  await expect(ledger).not.toContainText("每手输赢记录");
  await expect(ledger).toContainText("剩余 500 · 累计盈亏 0");
  await expect(ledger).toContainText("剩余 800 · 累计盈亏 0");
  await expect(
    setup.getByRole("button", { name: "3 人", exact: true }),
  ).toBeEnabled();
  await page.reload();
  await openTab(page, "牌桌与筹码");
  await expect(hero).toHaveValue("500");
  await expect(opponent).toHaveValue("800");
  await expect(ledger).not.toContainText("每手输赢记录");
  await openTab(page, "当前牌局");
  await page.getByRole("button", { name: "开始记录新一手 →" }).click();
  await expect(live.getByRole("button", { name: "开始牌局 →" })).toBeDisabled();
  await expect(live.getByRole("button", { name: "撤销上一步" })).toBeDisabled();
  await expect(live.getByRole("slider")).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
});
