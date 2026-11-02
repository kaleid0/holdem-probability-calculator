import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { openTab } from "./workspace";

const history = JSON.parse(
  readFileSync(
    new URL("../../examples/history-sensitivity.json", import.meta.url),
    "utf8",
  ),
);

test("history inference, explanation, export, staleness and restore", async ({
  page,
}, testInfo) => {
  // This fixture is a recorded game, not an intercepted analysis response.
  const draft = {
    hero: [48, 49],
    board: [4, 9, 14, 19],
    boardSize: 4,
    deadCards: [],
    opponents: [{ kind: "random" }],
    pot: "120",
    call: "60",
    bets: ["90"],
    futureBetting: true,
    samples: 10000,
    seed: 42,
    strategyId: "pot-odds",
    strategyIds: ["pot-odds"],
    ruleMargin: 0.05,
    table: { dealer: 0, smallBlind: 5, bigBlind: 10 },
  };
  const game = {
    handId: "browser-recording-1",
    openingSeats: [0, 1],
    count: 2,
    dealer: 0,
    smallBlind: 5,
    bigBlind: 10,
    street: 4,
    phase: "betting",
    actor: 0,
    folded: [false, false],
    paid: [0, 60],
    total: [30, 90],
    pending: [0],
    highest: 60,
    minRaise: 60,
    stacks: [1000, 1000],
    actedAt: [null, 60],
    historyComplete: true,
    events: history.history_context.events,
    log: [],
  };
  await page.addInitScript(
    (session) =>
      localStorage.setItem(
        "holdem-lab:session:v1",
        JSON.stringify({ schemaVersion: 1, session }),
      ),
    { draft, game, history: [], mode: "live" },
  );
  await page.goto("/");
  await openTab(page, "精细分析");
  const panel = page.getByRole("region", { name: "范围敏感性分析" });
  await panel
    .getByRole("textbox", { name: "翻前先验", exact: true })
    .fill("QQ,AKs,98s");
  await panel
    .getByRole("button", { name: "执行范围敏感性分析", exact: true })
    .click();
  await expect(
    panel.getByText("计算完成", { exact: false }).first(),
  ).toBeVisible({ timeout: 30000 });
  await expect(panel.getByRole("table").getByRole("row")).toHaveCount(4);
  await expect(
    panel.getByRole("cell", { name: "完成", exact: true }),
  ).toHaveCount(3);
  await panel.getByText("基准：范围与推断依据", { exact: false }).click();
  await expect(panel.getByText("#9 · 4 张公共牌 · 下注").first()).toBeVisible();
  await expect(panel.getByLabel("基准范围矩阵")).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("sensitivity-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    panel.getByRole("button", { name: "导出分析快照与结果" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: testInfo.outputPath("sensitivity-mobile.png"),
    fullPage: true,
  });
  const download = page.waitForEvent("download");
  await panel.getByRole("button", { name: "导出分析快照与结果" }).click();
  expect((await download).suggestedFilename()).toBe(
    "river-lab-sensitivity.json",
  );
  await panel.getByRole("spinbutton", { name: "偏价值诈唬偏置" }).fill("-2");
  await expect(panel.getByText("历史快照：", { exact: false })).toBeVisible();
  await expect(
    panel.getByRole("button", { name: "应用基准到当前对手范围" }),
  ).toBeDisabled();
  await panel.getByRole("button", { name: "恢复上次分析并重算" }).click();
  await expect(
    panel.getByText("计算完成", { exact: false }).first(),
  ).toBeVisible({ timeout: 30000 });
});

test("manual comparison works without game history", async ({ page }) => {
  await page.goto("/");
  await openTab(page, "精细分析");
  const panel = page.getByRole("region", { name: "范围敏感性分析" });
  // Importing revalidates and computes a frozen manual snapshot in the real API.
  const input = {
    mode: "manual",
    model_version: "history-rules-v1",
    target_seat: 1,
    opponent_seats: [1],
    base_analysis: {
      hero: [48, 49],
      board: [4, 9, 14, 19, 24],
      opponents: [{ kind: "random" }],
      samples: 1000,
      settlement_assumption: "showdownAfterCall",
    },
    scenarios: [
      {
        id: "baseline",
        name: "手工基准",
        current_range: { kind: "range", text: "KK" },
      },
      {
        id: "other",
        name: "其他",
        current_range: { kind: "range", text: "QQ" },
      },
    ],
  };
  await panel.getByLabel("导入分析快照并重算").setInputFiles({
    name: "manual.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ schemaVersion: 1, input })),
  });
  await expect(
    panel.getByRole("cell", { name: "完成", exact: true }),
  ).toHaveCount(2, { timeout: 30000 });
  await expect(
    panel.getByText("当前手工范围（不应用历史）", { exact: false }),
  ).toBeVisible();
});
