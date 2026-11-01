import { openTab } from "./workspace";
import { expect, test } from "@playwright/test";

test("quick analysis updates automatically and advanced strategies run only on demand", async ({
  page,
}) => {
  const submissions: Record<string, unknown>[] = [];
  page.on("request", (req) => {
    if (req.url().endsWith("/api/v1/analyses") && req.method() === "POST")
      submissions.push(req.postDataJSON());
  });
  await page.goto("/");
  await page.getByRole("button", { name: "载入示例", exact: false }).click();
  const quick = page.getByRole("region", { name: "快速分析", exact: true });
  await expect(quick).toContainText("已更新至当前牌局");
  expect(submissions.length).toBeGreaterThan(0);
  expect(
    submissions.every(
      (body) => body.samples === 10000 && body.equity_method === "monteCarlo",
    ),
  ).toBeTruthy();
  await openTab(page, "精细分析");
  await page
    .getByRole("checkbox", { name: "权益余量规则", exact: false })
    .check();
  await page
    .getByLabel("精细分析模拟精度", { exact: true })
    .selectOption("100000");
  const updated = page.waitForRequest(
    (req) => req.url().endsWith("/api/v1/analyses") && req.method() === "POST",
  );
  await openTab(page, "当前牌局");
  await page.getByLabel("需要跟注", { exact: true }).fill("20");
  expect((await updated).postDataJSON()).toMatchObject({
    call_amount: 20,
    samples: 10000,
    equity_method: "monteCarlo",
    strategies: [{ id: "pot-odds", config: {} }],
  });
  await expect(quick).toContainText("已更新至当前牌局");
  expect(
    submissions.every((body) => body.equity_method === "monteCarlo"),
  ).toBeTruthy();
  const fineRequest = page.waitForRequest(
    (req) =>
      req.url().endsWith("/api/v1/analyses") &&
      req.method() === "POST" &&
      req.postDataJSON().samples === 100000,
  );
  await openTab(page, "精细分析");
  await page.getByRole("button", { name: "执行精细分析", exact: true }).click();
  expect((await fineRequest).postDataJSON()).toMatchObject({
    samples: 100000,
    strategies: [{ id: "pot-odds" }, { id: "equity-rules" }],
  });
  await expect(
    page.getByLabel("底池权益百分比", { exact: true }),
  ).toBeVisible();
  // Invalid intermediate edits hide old quick results; manual results stay marked stale.
  await openTab(page, "当前牌局");
  await page
    .getByRole("button", { name: "移除手牌 1：黑桃A", exact: true })
    .click();
  await expect(quick).toContainText("请选择我的两张手牌");
  await expect(quick.getByLabel("快速底池权益百分比")).toHaveText("—");
  await openTab(page, "精细分析");
  await expect(
    page.getByText("牌局已修改，以下为上一次计算结果。请重新计算。"),
  ).toBeVisible();
});

test("a superseded submission is cancelled when its delayed id arrives", async ({
  page,
}) => {
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  let count = 0;
  const cancelled: string[] = [];
  const polled: string[] = [];
  await page.route("**/api/v1/analyses**", async (route) => {
    const req = route.request();
    if (req.url().endsWith("/cancel")) {
      cancelled.push(req.url().split("/").at(-2)!);
      await route.fulfill({ json: { status: "cancelled" } });
    } else if (req.method() === "POST") {
      const id = `quick-${++count}`;
      if (count === 1) await firstGate;
      await route.fulfill({
        status: 202,
        json: { task_id: id, status: "queued" },
      });
    } else {
      polled.push(req.url().split("/").at(-1)!);
      await route.fulfill({
        json: {
          status: "succeeded",
          result: {
            equity: 0.8,
            call_ev: 116,
            win_probability: 0.8,
            tie_probability: 0,
            lose_probability: 0.2,
            pot_odds_ratio: "15:2",
            break_even_equity: 20 / 170,
            equity_standard_error: 0.004,
            recommendation: null,
          },
        },
      });
    }
  });
  await page.goto("/");
  await page.getByRole("button", { name: "载入示例", exact: false }).click();
  await expect.poll(() => count).toBe(1);
  await openTab(page, "当前牌局");
  await page.getByLabel("需要跟注", { exact: true }).fill("20");
  await expect(page.getByLabel("快速底池权益百分比")).toHaveText("80.00%");
  releaseFirst();
  await expect.poll(() => cancelled).toContain("quick-1");
  expect(polled).not.toContain("quick-1");
  await expect(page.getByLabel("快速底池权益百分比")).toHaveText("80.00%");
});

test("failed quick analysis can be retried without running fine analysis", async ({
  page,
}) => {
  let fail = true;
  await page.route("**/api/v1/analyses", async (route) => {
    if (fail) await route.fulfill({ status: 503, json: {} });
    else await route.continue();
  });
  await page.goto("/");
  await page.getByRole("button", { name: "载入示例", exact: false }).click();
  const quick = page.getByRole("region", { name: "快速分析", exact: true });
  await expect(quick).toContainText("计算服务暂时不可用");
  fail = false;
  await quick.getByRole("button", { name: "重试快速分析" }).click();
  await expect(quick).toContainText("已更新至当前牌局");
  await expect(page.getByLabel("底池权益百分比", { exact: true })).toHaveCount(
    0,
  );
});

test("recorded actions, checks, undo and folding refresh quick analysis", async ({
  page,
}) => {
  const bodies: Record<string, unknown>[] = [];
  page.on("request", (req) => {
    if (req.url().endsWith("/api/v1/analyses") && req.method() === "POST")
      bodies.push(req.postDataJSON());
  });
  await page.goto("/");
  await openTab(page, "当前牌局");
  await page.getByRole("button", { name: "逐步记录", exact: false }).click();
  await page.getByRole("button", { name: "开始记录新一手 →" }).click();
  const live = page.getByRole("region", { name: "真实牌局", exact: true });
  const quick = page.getByRole("region", { name: "快速分析", exact: true });
  await live.getByRole("button", { name: "选择手牌 1", exact: true }).click();
  for (const name of ["黑桃A", "黑桃K"])
    await page.getByRole("button", { name, exact: true }).click();
  await expect(quick).toContainText("已更新至当前牌局");
  async function action(name: string) {
    const previous = bodies.length;
    await openTab(page, "当前牌局");
    await live.getByRole("button", { name, exact: true }).click();
    await expect.poll(() => bodies.length).toBeGreaterThan(previous);
    await expect(quick).toContainText("已更新至当前牌局");
  }
  await action("开始牌局 →");
  expect(bodies.at(-1)).toMatchObject({ pot_before_call: 15, call_amount: 5 });
  await action("跟注 5");
  expect(bodies.at(-1)).toMatchObject({ pot_before_call: 20, call_amount: 0 });
  // Reopen the same decision: no input cards or pot changes, but this is a new action.
  await action("撤销上一步");
  await action("跟注 5");
  await live.getByRole("button", { name: "过牌", exact: true }).click();
  await expect(quick).toContainText("请补齐后计算");
  await action("撤销上一步");
  expect(bodies.at(-1)).toMatchObject({ pot_before_call: 20, call_amount: 0 });
  await action("撤销上一步");
  await live.getByRole("button", { name: "弃牌", exact: true }).click();
  await expect(quick).toContainText("你已弃牌");
  await expect(page.getByLabel("快速底池权益百分比")).toHaveText("—");
  await action("撤销上一步");
  await live
    .getByRole("button", { name: "放弃本手并重开", exact: true })
    .click();
  await expect(quick).toContainText("请选择我的两张手牌");
});
