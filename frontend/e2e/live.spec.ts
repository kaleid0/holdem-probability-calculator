import { openTab } from "./workspace";
import { expect, test } from "@playwright/test";

test("table setup is shared, locks during recording and preserves the current hand across modes", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const setup = page.getByRole("region", { name: "共同牌桌设置" });
  await openTab(page, "牌桌与筹码");
  await setup
    .getByRole("group", { name: "牌桌人数", exact: true })
    .getByRole("button", { name: "3 人", exact: true })
    .click();
  await setup.getByLabel("小盲", { exact: true }).fill("2");
  await setup.getByLabel("大盲", { exact: true }).fill("4");
  await setup.getByRole("button", { name: "应用盲注" }).click();
  await openTab(page, "当前牌局");
  await page.getByRole("button", { name: "逐步记录", exact: false }).click();
  await page.getByRole("button", { name: "开始记录新一手 →" }).click();
  const live = page.getByRole("region", { name: "真实牌局", exact: true });
  await live.getByRole("button", { name: "选择手牌 1", exact: true }).click();
  await page.getByRole("button", { name: "黑桃A", exact: true }).click();
  await page.getByRole("button", { name: "黑桃K", exact: true }).click();
  await openTab(page, "牌桌与筹码");
  await setup
    .getByRole("group", { name: "牌桌人数", exact: true })
    .getByRole("button", { name: "9 人", exact: true })
    .click();
  await setup.getByRole("button", { name: "玩家 9坐庄", exact: true }).click();
  await expect(setup).toContainText("翻前 玩家 3 先行动");
  await setup.screenshot({ path: "../.local/table-settings-mobile.png" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await setup.screenshot({ path: "../.local/table-settings-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await setup
    .getByRole("group", { name: "牌桌人数", exact: true })
    .getByRole("button", { name: "2 人", exact: true })
    .click();
  await expect(
    setup.getByRole("button", { name: "玩家 2坐庄", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await setup
    .getByRole("button", { name: "玩家 1（我）坐庄", exact: true })
    .click();
  await openTab(page, "当前牌局");
  await expect(
    live.getByRole("button", { name: "更换手牌 1：黑桃A", exact: true }),
  ).toBeVisible();
  await live.getByRole("button", { name: "开始牌局 →" }).click();
  await openTab(page, "牌桌与筹码");
  await expect(
    setup.getByRole("button", { name: "2 人", exact: true }),
  ).toBeDisabled();
  await openTab(page, "当前牌局");
  await page.getByRole("button", { name: "局面录入", exact: false }).click();
  const snapshot = page.getByRole("region", { name: "牌局设置", exact: true });
  await expect(
    snapshot.getByRole("button", { name: "更换手牌 1：黑桃A", exact: true }),
  ).toBeVisible();
  await expect(snapshot.getByLabel("当前底池", { exact: true })).toHaveValue(
    "6",
  );
  await page.getByRole("button", { name: "逐步记录", exact: false }).click();
  await expect(
    live.getByRole("heading", { name: "翻前 · 玩家 1（我） 行动" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "局面录入", exact: false }).click();
  await snapshot.getByLabel("当前底池", { exact: true }).fill("200");
  await page.getByRole("button", { name: "逐步记录", exact: false }).click();
  await expect(
    page.getByRole("heading", { name: "当前局面未记录行动历史" }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "逐步记录", exact: true }),
  ).toContainText("200");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
});

test("mobile recording keeps folded seats and opens analysis and returns to the same decision", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await openTab(page, "牌桌与筹码");
  await page
    .getByRole("group", { name: "牌桌人数", exact: true })
    .getByRole("button", { name: "3 人", exact: true })
    .click();
  await openTab(page, "当前牌局");
  await page.getByRole("button", { name: "逐步记录", exact: false }).click();
  await page.getByRole("button", { name: "开始记录新一手 →" }).click();
  const live = page.getByRole("region", { name: "真实牌局", exact: true });
  await live.getByRole("button", { name: "选择手牌 1", exact: true }).click();
  for (const name of ["黑桃A", "黑桃K"])
    await page.getByRole("button", { name, exact: true }).click();
  await live.getByRole("button", { name: "开始牌局 →" }).click();
  await live.getByRole("button", { name: "跟注 10", exact: true }).click();
  await live.getByRole("button", { name: "跟注 5", exact: true }).click();
  await live.getByRole("button", { name: "过牌", exact: true }).click();
  await live.getByRole("button", { name: "选择公共牌 1", exact: true }).click();
  for (const name of ["黑桃2", "黑桃3", "黑桃4"])
    await page.getByRole("button", { name, exact: true }).click();
  await live.getByRole("button", { name: "确认翻牌，继续下注 →" }).click();
  await live.getByRole("button", { name: "下注", exact: true }).click();
  await live.getByRole("slider").fill("20");
  await live.getByRole("button", { name: "确认下注 20", exact: true }).click();
  await live.getByRole("button", { name: "弃牌", exact: true }).click();
  await live.getByRole("button", { name: "撤销上一步", exact: true }).click();
  await live.getByRole("button", { name: "弃牌", exact: true }).click();
  const submitted = page.waitForRequest(
    (r) =>
      r.url().endsWith("/api/v1/analyses") &&
      r.method() === "POST" &&
      r.postDataJSON().equity_method !== "monteCarlo",
  );
  await live.getByRole("button", { name: "精细分析当前决策 ↗" }).click();
  expect((await submitted).postDataJSON()).toMatchObject({
    pot_before_call: 50,
    call_amount: 20,
    opponents: [{ kind: "random" }],
    board: [0, 4, 8],
  });
  await expect(
    page.getByLabel("底池权益百分比", { exact: true }),
  ).toBeVisible();
  await openTab(page, "当前牌局");
  await expect(
    live.getByRole("heading", { name: "翻牌 · 玩家 1（我） 行动" }),
  ).toBeVisible();
  await openTab(page, "牌桌与筹码");
  await expect(
    page.getByRole("region", { name: "共同牌桌设置" }),
  ).toContainText("3 人坐席 · 2 人在局");
  await openTab(page, "当前牌局");
  await page.getByRole("button", { name: "局面录入", exact: false }).click();
  await openTab(page, "对手与范围");
  await expect(
    page.getByLabel("对手 2 在局", { exact: true }),
  ).not.toBeChecked();
  await openTab(page, "当前牌局");
  await expect(page.getByLabel("当前底池", { exact: true })).toHaveValue("50");
  await page.getByRole("button", { name: "逐步记录", exact: false }).click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: "../.local/shared-table-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "../.local/shared-table-desktop.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
