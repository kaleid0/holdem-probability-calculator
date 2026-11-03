import { openTab } from "./workspace";
import { expect, test, type Page } from "@playwright/test";
import { emptyDraft } from "../src/model";
import { createGame, startGame } from "../src/liveGame";

async function seedPreflop(page: Page) {
  const game = startGame(createGame(2, 0, 5, 10, [1000, 1000]));
  const draft = { ...emptyDraft(), hero: [48, 49], pot: "15", call: "5" };
  await page.addInitScript(
    ({ draft, game }) => {
      localStorage.setItem(
        "holdem-lab:session:v1",
        JSON.stringify({
          schemaVersion: 1,
          session: { mode: "live", draft, game, history: [] },
        }),
      );
    },
    { draft, game },
  );
}

test("preflop advice is available without waiting for the probability service", async ({
  page,
}) => {
  await seedPreflop(page);
  await page.route("**/api/v1/analyses", (route) =>
    route.fulfill({ status: 503, json: {} }),
  );
  await page.goto("/");
  const quick = page.getByRole("region", { name: "快速分析", exact: true });
  await expect(quick.getByLabel("快速行动建议")).toContainText("倾向加注至 25");
  await expect(quick.getByLabel("建议依据")).toContainText("本次追加 20");
  await expect(quick).toContainText("计算服务暂时不可用");
  await expect(quick.getByLabel("快速底池权益百分比")).toHaveText("—");
  await expect(quick.getByLabel("建议可靠程度")).toContainText("非 GTO 表");
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 844 });
    const summary = quick.getByLabel("快速行动建议");
    await expect(summary).toBeInViewport({ ratio: 1 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await expect(quick.locator("details, input, select, table")).toHaveCount(0);
  await openTab(page, "精细分析");
  const details = page.getByRole("region", {
    name: "快速分析说明",
    exact: true,
  });
  await expect(details).toContainText("本次追加 20");
  await expect(details).toContainText("非 GTO 表");
  await expect(
    page.getByLabel("精细分析模拟精度", { exact: true }),
  ).toBeVisible();
});

test("the server owns advice wording and the browser sends task references only", async ({
  page,
}) => {
  await seedPreflop(page);
  await page.route("**/api/v1/analyses", (route) =>
    route.fulfill({ status: 503, json: {} }),
  );
  await page.route("**/api/v1/decision-advice", async (route) => {
    const payload = route.request().postDataJSON();
    expect(payload).not.toHaveProperty("result");
    expect(payload).not.toHaveProperty("equity");
    expect(payload.history_context.events).toHaveLength(2);
    const response = await route.fetch();
    const json = await response.json();
    json.advice.title = "服务端决定的行动标题";
    json.advice.reason = "服务端返回的决策依据";
    await route.fulfill({ response, json });
  });
  await page.goto("/");
  const advice = page.getByLabel("快速行动建议");
  await expect(advice).toContainText("服务端决定的行动标题");
  await expect(advice).toContainText("服务端返回的决策依据");
  await expect(advice).not.toContainText("倾向加注至 25");
});

test("advice failure is explicit and retries without submitting another analysis", async ({
  page,
}) => {
  await seedPreflop(page);
  let analyses = 0;
  let fail = true;
  await page.route("**/api/v1/analyses", (route) => {
    analyses++;
    return route.fulfill({ status: 503, json: {} });
  });
  await page.route("**/api/v1/decision-advice", (route) =>
    fail ? route.fulfill({ status: 503, json: {} }) : route.continue(),
  );
  await page.goto("/");
  const quick = page.getByRole("region", { name: "快速分析", exact: true });
  await expect(quick).toContainText("行动建议暂不可用");
  await expect(quick.getByLabel("快速行动建议")).toHaveCount(0);
  await expect.poll(() => analyses).toBe(1);
  fail = false;
  await quick
    .getByRole("button", { name: "重试行动建议", exact: true })
    .click();
  await expect(quick.getByLabel("快速行动建议")).toContainText("倾向加注至 25");
  expect(analyses).toBe(1);
});

test("a late advice response cannot restore a recommendation after cards change", async ({
  page,
}) => {
  await seedPreflop(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let held = false;
  let delivered = false;
  await page.route("**/api/v1/analyses", (route) =>
    route.fulfill({ status: 503, json: {} }),
  );
  await page.route("**/api/v1/decision-advice", async (route) => {
    const response = await route.fetch();
    held = true;
    await gate;
    await route.fulfill({ response });
    delivered = true;
  });
  await page.goto("/");
  await expect.poll(() => held).toBe(true);
  await page.getByRole("button", { name: "局面录入", exact: true }).click();
  await page
    .getByRole("button", { name: "移除手牌 1：黑桃A", exact: true })
    .click();
  const quick = page.getByRole("region", { name: "快速分析", exact: true });
  await expect(quick).toContainText("请选择我的两张手牌");
  release();
  await expect.poll(() => delivered).toBe(true);
  await expect(quick.getByLabel("快速行动建议")).toHaveCount(0);
});
