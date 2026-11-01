import { expect, test } from "@playwright/test";
import { openTab } from "./workspace";

test("keyboard navigation exposes one panel and retains unapplied table drafts", async ({
  page,
}) => {
  await page.goto("/");
  const tabs = page.getByRole("tablist", { name: "工作台导航" });
  await expect(tabs.getByRole("tab")).toHaveCount(4);
  await expect(page.getByRole("tabpanel")).toHaveCount(1);
  await tabs.getByRole("tab", { name: "当前牌局", exact: true }).focus();
  await page.keyboard.press("End");
  await expect(
    tabs.getByRole("tab", { name: "牌桌与筹码", exact: true }),
  ).toBeFocused();
  await expect(
    page.getByRole("tabpanel", { name: "牌桌与筹码" }),
  ).toBeVisible();
  await page.getByLabel("小盲", { exact: true }).fill("7");
  await page.getByLabel("玩家 1（我）初始筹码", { exact: true }).fill("1234");
  await tabs.getByRole("tab", { name: "牌桌与筹码", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    tabs.getByRole("tab", { name: "当前牌局", exact: true }),
  ).toBeFocused();
  await expect(page.getByRole("tabpanel")).toHaveCount(1);
  await page.getByLabel("当前底池", { exact: true }).fill("321");
  await openTab(page, "对手与范围");
  await openTab(page, "精细分析");
  await openTab(page, "牌桌与筹码");
  await expect(page.getByLabel("小盲", { exact: true })).toHaveValue("7");
  await expect(
    page.getByLabel("玩家 1（我）初始筹码", { exact: true }),
  ).toHaveValue("1234");
  await expect(page.getByRole("button", { name: "应用盲注" })).toBeVisible();
  await expect(
    page.getByRole("tabpanel", { name: "牌桌与筹码" }).locator("summary"),
  ).toContainText("盲注 5 / 10");
  await openTab(page, "当前牌局");
  await expect(page.getByLabel("当前底池", { exact: true })).toHaveValue("321");
  await expect(
    page.getByRole("button", { name: "局面录入", exact: false }),
  ).toHaveAttribute("aria-pressed", "true");
});

test("switching panels preserves an in-flight quick submission without cancellation or duplicate work", async ({
  page,
}) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let submissions = 0;
  const cancelled: string[] = [];
  await page.route("**/api/v1/analyses**", async (route) => {
    const req = route.request();
    if (req.url().endsWith("/cancel")) {
      cancelled.push(req.url());
      await route.fulfill({ json: {} });
    } else if (req.method() === "POST") {
      submissions++;
      await gate;
      await route.fulfill({
        status: 202,
        json: { task_id: "quick-held", status: "queued" },
      });
    } else {
      await route.fulfill({
        json: { status: "succeeded", result: { equity: 0.8, call_ev: 116 } },
      });
    }
  });
  await page.goto("/");
  await page.getByRole("button", { name: "载入示例", exact: false }).click();
  await expect.poll(() => submissions).toBe(1);
  try {
    for (const tab of [
      "对手与范围",
      "精细分析",
      "牌桌与筹码",
      "当前牌局",
    ] as const) {
      await openTab(page, tab);
      await expect(
        page.getByRole("region", { name: "快速分析", exact: true }),
      ).toHaveAttribute("aria-busy", "true");
    }
    expect(submissions).toBe(1);
    expect(cancelled).toEqual([]);
  } finally {
    release();
  }
  await expect(page.getByLabel("快速底池权益百分比")).toHaveText("80.00%");
  await openTab(page, "精细分析");
  await openTab(page, "当前牌局");
  await expect(page.getByLabel("快速底池权益百分比")).toHaveText("80.00%");
  expect(submissions).toBe(1);
  expect(cancelled).toEqual([]);
});

test("fine analysis keeps polling off-screen, returns to its result and marks changed input stale", async ({
  page,
}) => {
  let fineId = "";
  let completed = false;
  let polls = 0;
  let fineSubmissions = 0;
  await page.route("**/api/v1/analyses", async (route) => {
    if (route.request().postDataJSON().equity_method === "monteCarlo")
      return route.continue();
    fineSubmissions++;
    const response = await route.fetch();
    fineId = (await response.json()).task_id;
    await route.fulfill({ response });
  });
  await page.route("**/api/v1/analyses/*", async (route) => {
    if (!fineId || !route.request().url().endsWith(`/${fineId}`) || completed)
      return route.continue();
    polls++;
    await route.fulfill({
      json: {
        task_id: fineId,
        status: "running",
        progress: 0.5,
        result: null,
        outcomes: [],
      },
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "载入示例", exact: false }).click();
  await expect(
    page.getByRole("region", { name: "快速分析", exact: true }),
  ).toContainText("已更新至当前牌局");
  await page
    .getByRole("button", { name: "精细分析当前牌局", exact: false })
    .click();
  await expect(
    page.getByRole("tab", { name: "精细分析", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByRole("tab", { name: "精细分析", exact: true }),
  ).toContainText("计算中");
  await expect.poll(() => polls).toBeGreaterThan(0);
  await openTab(page, "对手与范围");
  const before = polls;
  await expect.poll(() => polls).toBeGreaterThan(before);
  await openTab(page, "当前牌局");
  await page.getByLabel("需要跟注", { exact: true }).fill("20");
  await openTab(page, "精细分析");
  await expect(
    page.getByText("输入已修改，此任务仍在计算提交时的牌局。"),
  ).toBeVisible();
  completed = true;
  await expect(
    page.getByLabel("底池权益百分比", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("牌局已修改，以下为上一次计算结果。请重新计算。"),
  ).toBeVisible();
  await expect(
    page.getByRole("tab", { name: "精细分析", exact: true }),
  ).toContainText("待更新");
  await openTab(page, "牌桌与筹码");
  await openTab(page, "当前牌局");
  await page.getByRole("button", { name: "查看结果", exact: false }).click();
  await expect(
    page.getByLabel("底池权益百分比", { exact: true }),
  ).toBeVisible();
  expect(fineSubmissions).toBe(1);
});

test("an off-screen fine task can still be cancelled after returning to analysis", async ({
  page,
}) => {
  let cancelled = false;
  let cancelRequests = 0;
  let fineSubmissions = 0;
  await page.route("**/api/v1/analyses**", async (route) => {
    const req = route.request();
    if (req.url().endsWith("/cancel")) {
      cancelRequests++;
      cancelled = true;
      await route.fulfill({ json: {} });
    } else if (req.method() === "POST") {
      const quick = req.postDataJSON().equity_method === "monteCarlo";
      if (!quick) fineSubmissions++;
      await route.fulfill({
        status: 202,
        json: { task_id: quick ? "quick" : "fine", status: "queued" },
      });
    } else if (req.url().endsWith("/quick")) {
      await route.fulfill({
        json: { status: "succeeded", result: { equity: 0.8, call_ev: 116 } },
      });
    } else {
      await route.fulfill({
        json: {
          task_id: "fine",
          status: cancelled ? "cancelled" : "running",
          progress: 0.3,
          result: null,
          outcomes: [],
        },
      });
    }
  });
  await page.goto("/");
  await page.getByRole("button", { name: "载入示例", exact: false }).click();
  await expect(
    page.getByRole("region", { name: "快速分析", exact: true }),
  ).toContainText("已更新至当前牌局");
  await page
    .getByRole("button", { name: "精细分析当前牌局", exact: false })
    .click();
  await expect(
    page.getByRole("button", { name: "取消任务", exact: true }),
  ).toBeVisible();
  await openTab(page, "牌桌与筹码");
  await openTab(page, "精细分析");
  await page.getByRole("button", { name: "取消任务", exact: true }).click();
  await expect(
    page.getByRole("tab", { name: "精细分析", exact: true }),
  ).toContainText("已取消");
  expect(cancelRequests).toBe(1);
  expect(fineSubmissions).toBe(1);
});

test("bottom navigation spans the viewport while quick analysis stays above visible panels", async ({
  page,
}) => {
  await page.goto("/");
  await openTab(page, "精细分析");
  await page.getByRole("button", { name: "执行精细分析", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("请选择我的两张手牌");
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const name of [
      "当前牌局",
      "对手与范围",
      "精细分析",
      "牌桌与筹码",
    ] as const) {
      await openTab(page, name);
      await expect(page.getByRole("tabpanel")).toHaveCount(1);
      const bounds = await page.evaluate(() => ({
        page: document.documentElement.scrollWidth,
        viewport: innerWidth,
        quick: document
          .querySelector('[aria-label="快速分析"]')!
          .getBoundingClientRect().bottom,
        bar: (() => {
          const element = document.querySelector(
            '[role="tablist"][aria-label="工作台导航"]',
          )!;
          const bounds = element.getBoundingClientRect();
          return {
            left: bounds.left,
            right: bounds.right,
            bottom: bounds.bottom,
            position: getComputedStyle(element).position,
            radius: getComputedStyle(element).borderRadius,
          };
        })(),
        height: innerHeight,
        panel: document
          .querySelector('[role="tabpanel"]:not([hidden])')!
          .getBoundingClientRect().top,
      }));
      expect(bounds.page).toBeLessThanOrEqual(bounds.viewport);
      expect(bounds.panel).toBeGreaterThanOrEqual(bounds.quick);
      expect(bounds.bar.left).toBe(0);
      expect(bounds.bar.right).toBe(bounds.viewport);
      expect(bounds.bar.bottom).toBe(bounds.height);
      expect(bounds.bar.position).toBe("fixed");
      expect(bounds.bar.radius).toBe("0px");
    }
  }
  await openTab(page, "当前牌局");
  await page.getByRole("button", { name: "载入示例", exact: false }).click();
  await expect(
    page.getByRole("region", { name: "快速分析", exact: true }),
  ).toContainText("已更新至当前牌局");
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: `../.local/bottom-navigation-${width}.png`,
      fullPage: true,
    });
  }
});
