import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { openTab } from "./workspace";

const tableScreenshotStyle =
  '[role="tablist"], [aria-label="快速分析"] { visibility: hidden !important; }';

async function openVisualTable(page: Page, count: number) {
  await page.goto("/");
  await openTab(page, "牌桌与筹码");
  await page
    .getByRole("group", { name: "牌桌人数", exact: true })
    .getByRole("button", { name: `${count} 人`, exact: true })
    .click();
  await openTab(page, "当前牌局");
  await page.getByRole("button", { name: "逐步记录", exact: true }).click();
  await page.getByRole("button", { name: "开始记录新一手 →" }).click();
  const live = page.getByRole("region", { name: "真实牌局", exact: true });
  await expect(
    live.getByRole("button", { name: "列表视图", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await live.getByRole("button", { name: "可视化牌桌", exact: true }).click();
  return {
    live,
    table: live.getByRole("region", { name: "可视化牌桌", exact: true }),
  };
}

test("visual table follows actions, undo and street changes without losing the hand when switching views", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const { live, table } = await openVisualTable(page, 3);
  const hero = table.getByRole("article", {
    name: "玩家 1（我）",
    exact: true,
  });
  const smallBlind = table.getByRole("article", {
    name: "玩家 2",
    exact: true,
  });
  const bigBlind = table.getByRole("article", { name: "玩家 3", exact: true });
  await expect(table.getByRole("article")).toHaveCount(3);
  await expect(hero).toContainText("庄家 D");
  await expect(smallBlind).toContainText("小盲 SB");
  await expect(bigBlind).toContainText("大盲 BB");
  await expect(table.locator('article[aria-current="true"]')).toHaveCount(0);

  await table.getByRole("button", { name: "选择手牌 1", exact: true }).click();
  for (const name of ["黑桃A", "黑桃K"])
    await page.getByRole("button", { name, exact: true }).click();
  await live.getByRole("button", { name: "开始牌局 →" }).click();
  await expect(table.getByRole("status")).toHaveText("轮到 玩家 1（我） 行动");
  await expect(hero).toHaveAttribute("aria-current", "true");
  await expect(smallBlind).toContainText("995");
  await expect(bigBlind).toContainText("990");
  await live.getByRole("button", { name: "跟注 10", exact: true }).click();
  await expect(hero).toContainText("990");
  await expect(hero).toContainText(/本轮\s*(?:投入\s*)?10/);
  await expect(table.getByRole("status")).toHaveText("轮到 玩家 2 行动");
  await expect(table.locator('article[aria-current="true"]')).toHaveCount(1);
  await expect(smallBlind).toHaveAttribute("aria-current", "true");
  await live.getByRole("button", { name: "加注", exact: true }).click();
  await live.getByRole("slider").fill("30");
  await live.getByRole("button", { name: "确认加注 30", exact: true }).click();
  await expect(smallBlind).toContainText("970");
  await expect(smallBlind).toContainText(/加注至\s*30/);
  await expect(bigBlind).toHaveAttribute("aria-current", "true");
  await live.getByRole("button", { name: "弃牌", exact: true }).click();
  await expect(bigBlind).toContainText("已弃牌");
  await expect(hero).toHaveAttribute("aria-current", "true");
  await live.getByRole("button", { name: "撤销上一步", exact: true }).click();
  await expect(bigBlind).not.toContainText("已弃牌");
  await expect(bigBlind).toHaveAttribute("aria-current", "true");
  await expect(bigBlind).toContainText("大盲 BB");
  await live.getByRole("button", { name: "弃牌", exact: true }).click();

  await live.getByRole("button", { name: "列表视图", exact: true }).click();
  await expect(table).not.toBeVisible();
  await expect(
    live.getByRole("button", { name: "更换手牌 1：黑桃A", exact: true }),
  ).toHaveCount(1);
  await live.getByRole("button", { name: "可视化牌桌", exact: true }).click();
  await expect(hero).toHaveAttribute("aria-current", "true");
  await expect(bigBlind).toContainText("已弃牌");
  await expect(smallBlind).toContainText("970");
  await live.getByRole("button", { name: "跟注 20", exact: true }).click();
  await expect(hero).toContainText("970");
  await expect(table).toContainText(/底池\s*70/);
  await expect(table.locator('article[aria-current="true"]')).toHaveCount(0);

  await table
    .getByRole("button", { name: "选择公共牌 1", exact: true })
    .click();
  for (const name of ["黑桃2", "黑桃3", "黑桃4"])
    await page.getByRole("button", { name, exact: true }).click();
  await live.getByRole("button", { name: "确认翻牌，继续下注 →" }).click();
  await expect(smallBlind).toHaveAttribute("aria-current", "true");
  await expect(smallBlind).not.toContainText(/加注至\s*30/);
  for (const seat of [hero, smallBlind, bigBlind])
    await expect(seat).toContainText(/本轮\s*(?:投入\s*)?0/);
  await expect(bigBlind).toContainText("已弃牌");
  await expect(
    table.getByRole("button", { name: "更换公共牌 1：黑桃2", exact: true }),
  ).toBeVisible();
  await table.screenshot({
    path: "../.local/visual-table-actions-desktop.png",
    style: tableScreenshotStyle,
  });
  await expect(hero).toContainText(/累计投入\s*30/);
  await expect(smallBlind).toContainText(/累计投入\s*30/);
  await expect(bigBlind).toContainText(/累计投入\s*10/);
  await page.setViewportSize({ width: 390, height: 844 });
  for (const seat of [hero, smallBlind, bigBlind]) {
    const bet = seat.getByTitle("本轮下注 0", { exact: true });
    await expect(bet).toBeVisible();
    await expect(bet).toHaveText(/^下注\s*0$/);
  }
  await table.screenshot({
    path: "../.local/visual-table-street-reset-mobile.png",
    style: tableScreenshotStyle,
  });
  expect(errors).toEqual([]);
});

test("mobile seat details preserve manual selection and follow the actor without taking keyboard focus", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const { live, table } = await openVisualTable(page, 9);
  const details = table.getByRole("region", { name: "座位详情", exact: true });
  await expect(details).toBeVisible();
  await expect(
    details.getByRole("heading", { name: "玩家 1（我）", exact: true }),
  ).toBeVisible();
  await expect(table.getByTitle("本轮下注 0", { exact: true })).toHaveCount(9);
  await expect(
    table
      .getByRole("button", { name: "查看玩家 1（我）详情", exact: true })
      .getByTitle("本轮下注 0", { exact: true }),
  ).toHaveText(/^下注\s*0$/);
  await table.getByRole("button", { name: "选择手牌 1", exact: true }).click();
  for (const name of ["黑桃A", "黑桃K"])
    await page.getByRole("button", { name, exact: true }).click();
  await live.getByRole("button", { name: "开始牌局 →" }).click();
  await expect(
    details.getByRole("heading", { name: "玩家 4", exact: true }),
  ).toBeVisible();
  const player4 = table.getByRole("button", {
    name: "查看玩家 4详情",
    exact: true,
  });
  const player5 = table.getByRole("button", {
    name: "查看玩家 5详情",
    exact: true,
  });
  await expect(player4.getByTitle("本轮下注 0", { exact: true })).toBeVisible();
  await expect(
    table
      .getByRole("button", { name: "查看玩家 2详情", exact: true })
      .getByTitle("本轮下注 5", { exact: true }),
  ).toHaveText(/^下注\s*5$/);
  await expect(
    table
      .getByRole("button", { name: "查看玩家 3详情", exact: true })
      .getByTitle("本轮下注 10", { exact: true }),
  ).toHaveText(/^下注\s*10$/);
  const follow = details.getByRole("button", { name: "跟随行动", exact: true });
  await expect(follow).toHaveAttribute("aria-pressed", "true");
  const selectedSeat = table.getByRole("button", {
    name: "查看玩家 2详情",
    exact: true,
  });
  await selectedSeat.focus();
  const scrollBeforeSelection = await page.evaluate(() => window.scrollY);
  await selectedSeat.press("Enter");
  await expect(selectedSeat).toBeFocused();
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollBeforeSelection);
  await expect(selectedSeat).toHaveAttribute("aria-pressed", "true");
  await expect(follow).toHaveAttribute("aria-pressed", "false");
  await expect(
    details.getByRole("heading", { name: "玩家 2", exact: true }),
  ).toBeVisible();
  await expect(details).toContainText(/剩余筹码\s*995/);
  await expect(details).toContainText(/本轮投入\s*5/);
  await expect(details).toContainText(/累计投入\s*5/);
  await expect(details).toContainText("小盲 SB");
  await expect(
    details.getByRole("img", { name: "未知底牌", exact: true }),
  ).toHaveCount(2);
  await expect(
    table.getByRole("article", { name: "玩家 4", exact: true }),
  ).toHaveAttribute("aria-current", "true");

  const call = live.getByRole("button", { name: "跟注 10", exact: true });
  await call.click();
  await expect(call).toBeFocused();
  await expect(player4.getByTitle("本轮下注 10", { exact: true })).toHaveText(
    /^下注\s*10$/,
  );
  await expect(player4).toHaveAccessibleDescription(
    /本轮下注\s*10.*剩余筹码\s*990/,
  );
  await expect(
    table.getByRole("article", { name: "玩家 5", exact: true }),
  ).toHaveAttribute("aria-current", "true");
  await expect(
    details.getByRole("heading", { name: "玩家 2", exact: true }),
  ).toBeVisible();
  await expect(selectedSeat).toHaveAttribute("aria-pressed", "true");
  await follow.click();
  await expect(follow).toBeFocused();
  await expect(follow).toHaveAttribute("aria-pressed", "true");
  await expect(
    details.getByRole("heading", { name: "玩家 5", exact: true }),
  ).toBeVisible();
  await call.click();
  await expect(call).toBeFocused();
  await expect(player5.getByTitle("本轮下注 10", { exact: true })).toHaveText(
    /^下注\s*10$/,
  );
  await expect(
    details.getByRole("heading", { name: "玩家 6", exact: true }),
  ).toBeVisible();
  await expect(
    table.getByRole("button", { name: "查看玩家 6详情", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await live.getByRole("button", { name: "撤销上一步", exact: true }).click();
  await expect(
    details.getByRole("heading", { name: "玩家 5", exact: true }),
  ).toBeVisible();
  await expect(player5.getByTitle("本轮下注 0", { exact: true })).toHaveText(
    /^下注\s*0$/,
  );
  await expect(details).toContainText(/剩余筹码\s*1000/);
  await table.screenshot({
    path: "../.local/visual-table-9-mobile-details.png",
    style: tableScreenshotStyle,
  });
  expect(errors).toEqual([]);
});

test("mobile details resume following the actor when the selected seat is removed", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const { live, table } = await openVisualTable(page, 9);
  const details = table.getByRole("region", { name: "座位详情", exact: true });
  const removedSeat = table.getByRole("button", {
    name: "查看玩家 9详情",
    exact: true,
  });
  await expect(removedSeat).toHaveAccessibleDescription(/1000.*待发牌/);
  await removedSeat.click();
  await expect(
    details.getByRole("heading", { name: "玩家 9", exact: true }),
  ).toBeVisible();
  await openTab(page, "牌桌与筹码");
  await page
    .getByRole("group", { name: "牌桌人数", exact: true })
    .getByRole("button", { name: "2 人", exact: true })
    .click();
  await openTab(page, "当前牌局");
  await expect(table.getByRole("article")).toHaveCount(2);
  await expect(
    details.getByRole("heading", { name: "玩家 1（我）", exact: true }),
  ).toBeVisible();
  await expect(
    table.getByRole("button", { name: "查看玩家 1（我）详情", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await table.getByRole("button", { name: "选择手牌 1", exact: true }).click();
  for (const name of ["黑桃A", "黑桃K"])
    await page.getByRole("button", { name, exact: true }).click();
  await live.getByRole("button", { name: "开始牌局 →" }).click();
  await expect(
    details.getByRole("button", { name: "跟随行动", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await live.getByRole("button", { name: "跟注 5", exact: true }).click();
  await expect(
    details.getByRole("heading", { name: "玩家 2", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

for (const count of [2, 7, 9]) {
  test(`${count}-seat visual table fits desktop and mobile with readable seats`, async ({
    page,
  }) => {
    const { live, table } = await openVisualTable(page, count);
    await expect(table.getByRole("article")).toHaveCount(count);
    if (count === 2) {
      const dealer = table.getByRole("article", {
        name: "玩家 1（我）",
        exact: true,
      });
      await expect(dealer).toContainText("庄家 D");
      await expect(dealer).toContainText("小盲 SB");
    }
    await table
      .getByRole("button", { name: "选择手牌 1", exact: true })
      .click();
    for (const name of ["黑桃A", "黑桃K"])
      await page.getByRole("button", { name, exact: true }).click();
    await live.getByRole("button", { name: "开始牌局 →" }).click();
    await live.getByRole("button", { name: "加注", exact: true }).click();
    await live.getByRole("slider").fill("30");
    await live
      .getByRole("button", { name: "确认加注 30", exact: true })
      .click();
    for (const [name, width, height] of [
      ["desktop", 1440, 1000],
      ["mobile", 390, 844],
      ["narrow", 320, 844],
      ["tablet", 768, 1000],
      ["tablet-wide", 801, 1000],
      ["compact-desktop", 900, 1000],
      ["laptop", 1024, 1000],
    ] as const) {
      await page.setViewportSize({ width, height });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBeTruthy();
      const tableBox = await table.boundingBox();
      expect(tableBox).not.toBeNull();
      if (width <= 390) {
        const frameBox = await table.locator("[data-count]").boundingBox();
        expect(frameBox).not.toBeNull();
        expect(frameBox!.height).toBeLessThanOrEqual(580);
        expect(tableBox!.height).toBeLessThan(900);
      }
      const boardBox = await table
        .getByRole("group", { name: "公共牌区域", exact: true })
        .boundingBox();
      expect(boardBox).not.toBeNull();
      expect(boardBox!.x).toBeGreaterThanOrEqual(tableBox!.x - 1);
      expect(boardBox!.x + boardBox!.width).toBeLessThanOrEqual(
        tableBox!.x + tableBox!.width + 1,
      );
      expect(boardBox!.y).toBeGreaterThanOrEqual(tableBox!.y - 1);
      expect(boardBox!.y + boardBox!.height).toBeLessThanOrEqual(
        tableBox!.y + tableBox!.height + 1,
      );
      const seatBoxes = await table.getByRole("article").evaluateAll((seats) =>
        seats.map((seat) => {
          const box = seat.getBoundingClientRect();
          return {
            left: box.left,
            right: box.right,
            top: box.top,
            bottom: box.bottom,
            width: box.width,
            height: box.height,
          };
        }),
      );
      for (const seat of seatBoxes) {
        expect(seat.width).toBeGreaterThanOrEqual(width === 320 ? 72 : 80);
        if (width <= 390) expect(seat.height).toBeLessThanOrEqual(80);
        expect(seat.left).toBeGreaterThanOrEqual(tableBox!.x - 1);
        expect(seat.right).toBeLessThanOrEqual(
          tableBox!.x + tableBox!.width + 1,
        );
        expect(seat.top).toBeGreaterThanOrEqual(tableBox!.y - 1);
        expect(seat.bottom).toBeLessThanOrEqual(
          tableBox!.y + tableBox!.height + 1,
        );
        const overlapX =
          Math.min(seat.right, boardBox!.x + boardBox!.width) -
          Math.max(seat.left, boardBox!.x);
        const overlapY =
          Math.min(seat.bottom, boardBox!.y + boardBox!.height) -
          Math.max(seat.top, boardBox!.y);
        expect(
          overlapX > 1 && overlapY > 1,
          `${count} seats on ${name}: a player overlaps the public cards`,
        ).toBeFalsy();
      }
      for (let i = 0; i < seatBoxes.length; i++) {
        for (let j = i + 1; j < seatBoxes.length; j++) {
          const first = seatBoxes[i];
          const second = seatBoxes[j];
          const overlapX =
            Math.min(first.right, second.right) -
            Math.max(first.left, second.left);
          const overlapY =
            Math.min(first.bottom, second.bottom) -
            Math.max(first.top, second.top);
          expect(
            overlapX > 1 && overlapY > 1,
            `${count} seats on ${name}: players ${i + 1} and ${j + 1} overlap`,
          ).toBeFalsy();
        }
      }
      await table.screenshot({
        path: `../.local/visual-table-${count}-${name}.png`,
        style: tableScreenshotStyle,
      });
    }
  });
}
