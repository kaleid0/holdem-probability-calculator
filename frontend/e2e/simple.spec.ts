import { expect, test } from "@playwright/test";

test("quick input keeps advanced controls collapsed and fills the board continuously", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("group", { name: "牌局交互模式" })).toHaveCount(
    1,
  );
  await expect(page.getByRole("tablist", { name: "输入模式" })).toHaveCount(0);
  await expect(page.getByLabel("对手 1 手牌模式")).not.toBeVisible();
  await expect(page.getByLabel("模拟精度")).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "导入", exact: true }),
  ).not.toBeVisible();
  await page.getByRole("button", { name: "选择手牌 1", exact: true }).click();
  await page.getByRole("button", { name: "黑桃A", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "选择我的手牌 · 第 2 张" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "黑桃K", exact: true }).click();
  await page.getByRole("button", { name: "翻牌 3 张", exact: true }).click();
  await page.getByRole("button", { name: "选择翻牌 1", exact: true }).click();
  for (const name of ["黑桃2", "黑桃3", "黑桃4"])
    await page.getByRole("button", { name, exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByLabel("当前底池", { exact: true }).fill("150");
  await page.getByLabel("需要跟注", { exact: true }).fill("0");
  await page
    .getByRole("button", { name: "精细分析当前牌局", exact: false })
    .click();
  await expect(
    page.getByLabel("底池权益百分比", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "策略对照" })).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "../.local/simple-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: "../.local/simple-desktop.png",
    fullPage: true,
  });
});
