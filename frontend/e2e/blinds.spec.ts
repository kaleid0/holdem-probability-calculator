import { expect, test } from "@playwright/test";
import { openTab } from "./workspace";

test("blind presets and custom ratios persist, post correct chips and lock for the current hand", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "逐步记录", exact: false }).click();
  await page
    .getByRole("button", { name: "开始记录新一手 →", exact: true })
    .click();
  const live = page.getByRole("region", { name: "真实牌局", exact: true });
  await expect(
    live.getByRole("button", { name: "设置大小盲", exact: true }),
  ).toHaveCount(0);
  await openTab(page, "牌桌与筹码");
  await expect(
    page.getByRole("tab", { name: "牌桌与筹码", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  const setup = page.getByRole("region", { name: "共同牌桌设置", exact: true });
  await setup
    .getByRole("button", { name: "盲注预设 25 / 50", exact: true })
    .click();
  await expect(setup.getByLabel("小盲", { exact: true })).toHaveValue("25");
  await expect(setup.getByLabel("大盲", { exact: true })).toHaveValue("50");
  for (const invalid of ["0", "1.5", "1e2", "60"]) {
    await setup.getByLabel("小盲", { exact: true }).fill(invalid);
    await setup.getByRole("button", { name: "应用盲注", exact: true }).click();
    await expect(setup.getByRole("alert")).toContainText("正整数盲注");
    await expect(
      setup.getByText("盲注 25 / 50", { exact: true }),
    ).toBeVisible();
  }
  await setup.getByLabel("小盲", { exact: true }).fill("10");
  await setup.getByLabel("大盲", { exact: true }).fill("30");
  await setup.getByRole("button", { name: "应用盲注", exact: true }).click();
  await expect(setup.getByRole("alert")).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await setup.screenshot({
    path: testInfo.outputPath("blind-settings-mobile.png"),
  });
  await page.reload();
  await openTab(page, "牌桌与筹码");
  await expect(setup.getByLabel("小盲", { exact: true })).toHaveValue("10");
  await expect(setup.getByLabel("大盲", { exact: true })).toHaveValue("30");
  await openTab(page, "当前牌局");
  await live.getByRole("button", { name: "选择手牌 1", exact: true }).click();
  await page.getByRole("button", { name: "黑桃A", exact: true }).click();
  await page.getByRole("button", { name: "黑桃K", exact: true }).click();
  await live.getByRole("button", { name: "开始牌局 →", exact: true }).click();
  await expect(live).toContainText("盲注 10 / 30");
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("holdem-lab:session:v1")!),
  );
  expect(stored.session.game).toMatchObject({
    smallBlind: 10,
    bigBlind: 30,
    paid: [10, 30],
    minRaise: 30,
    highest: 30,
  });
  expect(stored.session.draft.pot).toBe("40");
  await openTab(page, "牌桌与筹码");
  await expect(setup.getByLabel("小盲", { exact: true })).toBeDisabled();
  await expect(setup.getByLabel("大盲", { exact: true })).toBeDisabled();
  await expect(
    setup.getByRole("button", { name: "盲注预设 1 / 2", exact: true }),
  ).toBeDisabled();
});
