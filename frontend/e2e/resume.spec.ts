import { openTab } from "./workspace";
import { expect, test } from "@playwright/test";

test("mobile recording resumes after page reload and tab recreation, including undo", async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
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
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("holdem-lab:session:v1")!),
  );
  expect(saved.session.game.actor).toBe(1);
  expect(saved.session.game.total).toEqual([10, 5, 10]);
  expect(saved.session.game.historyComplete).toBe(true);
  expect(saved.session.game.events).toHaveLength(3);
  expect(saved.session.game.events.at(-1)).toMatchObject({
    kind: "action",
    sequence: 3,
    player: 0,
    street: 0,
    action: "call",
    amount: 10,
    streetTotal: 10,
    toCall: 10,
    potBefore: 15,
    potAfter: 25,
  });
  // Mobile browsers can discard the entire document while the phone is asleep.
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  await page.reload();
  await expect(
    page.getByRole("button", { name: "逐步记录", exact: false }),
  ).toHaveAttribute("aria-pressed", "true");
  await openTab(page, "当前牌局");
  await expect(
    live.getByRole("heading", { name: "翻前 · 玩家 2 行动" }),
  ).toBeVisible();
  await expect(
    live.getByRole("button", { name: "更换手牌 1：黑桃A", exact: true }),
  ).toBeVisible();
  await expect(
    live.getByRole("button", { name: "撤销上一步", exact: true }),
  ).toBeEnabled();
  await live.getByRole("button", { name: "撤销上一步", exact: true }).click();
  await expect(
    live.getByRole("button", { name: "跟注 10", exact: true }),
  ).toBeVisible();
  await live.getByRole("button", { name: "跟注 10", exact: true }).click();
  await live.getByRole("button", { name: "弃牌", exact: true }).click();
  await page.close();
  const reopened = await context.newPage();
  await reopened.setViewportSize({ width: 390, height: 844 });
  await reopened.goto("/");
  const resumed = reopened.getByRole("region", {
    name: "真实牌局",
    exact: true,
  });
  await openTab(reopened, "当前牌局");
  await expect(
    resumed.getByRole("heading", { name: "翻前 · 玩家 3 行动" }),
  ).toBeVisible();
  await openTab(reopened, "牌桌与筹码");
  await expect(
    reopened.getByRole("region", { name: "共同牌桌设置" }),
  ).toContainText("3 人坐席 · 2 人在局");
  const restored = await reopened.evaluate(() =>
    JSON.parse(localStorage.getItem("holdem-lab:session:v1")!),
  );
  expect(restored.session.game.folded).toEqual([false, true, false]);
  expect(restored.session.game.total).toEqual([10, 5, 10]);
  expect(restored.session.game.events.at(-1)).toMatchObject({
    kind: "action",
    sequence: 4,
    player: 1,
    action: "fold",
    amount: 0,
    toCall: 5,
  });
  await openTab(reopened, "当前牌局");
  await resumed
    .getByRole("button", { name: "撤销上一步", exact: true })
    .click();
  const undone = await reopened.evaluate(() =>
    JSON.parse(localStorage.getItem("holdem-lab:session:v1")!),
  );
  expect(undone.session.game.events).toEqual(saved.session.game.events);
  await expect(
    resumed.getByRole("heading", { name: "翻前 · 玩家 2 行动" }),
  ).toBeVisible();
  await expect(
    reopened.getByRole("button", { name: "开始记录新一手 →" }),
  ).toHaveCount(0);
});

test("partial dealing and input mode survive reload without reviving an old hand", async ({
  page,
}) => {
  await page.goto("/");
  await openTab(page, "当前牌局");
  await page.getByRole("button", { name: "逐步记录", exact: false }).click();
  await page.getByRole("button", { name: "开始记录新一手 →" }).click();
  const live = page.getByRole("region", { name: "真实牌局", exact: true });
  await live.getByRole("button", { name: "选择手牌 1", exact: true }).click();
  for (const name of ["黑桃A", "黑桃K"])
    await page.getByRole("button", { name, exact: true }).click();
  await live.getByRole("button", { name: "开始牌局 →" }).click();
  await live.getByRole("button", { name: "跟注 5", exact: true }).click();
  await live.getByRole("button", { name: "过牌", exact: true }).click();
  await live.getByRole("button", { name: "选择公共牌 1", exact: true }).click();
  for (const name of ["黑桃2", "黑桃3"])
    await page.getByRole("button", { name, exact: true }).click();
  await page.reload();
  await openTab(page, "当前牌局");
  await expect(
    live.getByRole("heading", { name: "翻前 · 等待发公共牌" }),
  ).toBeVisible();
  await expect(
    live.getByRole("button", { name: "更换公共牌 2：黑桃3", exact: true }),
  ).toBeVisible();
  await live.getByRole("button", { name: "选择公共牌 3", exact: true }).click();
  await page.getByRole("button", { name: "黑桃4", exact: true }).click();
  await live.getByRole("button", { name: "确认翻牌，继续下注 →" }).click();
  await page.getByRole("button", { name: "局面录入", exact: false }).click();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "局面录入", exact: false }),
  ).toHaveAttribute("aria-pressed", "true");
  await openTab(page, "当前牌局");
  await page.getByRole("button", { name: "逐步记录", exact: false }).click();
  await expect(
    live.getByRole("heading", { name: "翻牌 · 玩家 2 行动" }),
  ).toBeVisible();
  await live
    .getByRole("button", { name: "放弃本手并重开", exact: true })
    .click();
  await page.reload();
  await openTab(page, "当前牌局");
  await expect(
    live.getByRole("button", { name: "开始牌局 →", exact: true }),
  ).toBeDisabled();
  await expect(
    live.getByRole("button", { name: "选择手牌 1", exact: true }),
  ).toBeVisible();
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("holdem-lab:session:v1")!),
  );
  expect(stored.session.history).toEqual([]);
  expect(stored.session.game.log).toEqual([]);
  expect(stored.session.game.events).toEqual([]);
});
