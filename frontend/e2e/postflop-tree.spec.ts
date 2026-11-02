import { expect, test } from "@playwright/test";
import { openTab } from "./workspace";
import { readFileSync } from "node:fs";

const input = JSON.parse(
  readFileSync(
    new URL("../../examples/history-sensitivity.json", import.meta.url),
    "utf8",
  ),
);
const manual = JSON.parse(
  readFileSync(
    new URL("../../examples/river-bet.json", import.meta.url),
    "utf8",
  ),
);

test.beforeEach(async ({ page }) => {
  const h = input.history_context;
  await page.addInitScript(
    ({ input, h, draft }) => {
      if (localStorage.getItem("holdem-lab:session:v1")) return;
      localStorage.setItem(
        "holdem-lab:session:v1",
        JSON.stringify({
          schemaVersion: 1,
          session: {
            mode: "live",
            history: [],
            draft: {
              ...draft,
              hero: input.base_analysis.hero,
              board: input.base_analysis.board,
              boardSize: 4,
              opponents: [{ kind: "random" }],
              pot: "120",
              call: "60",
              bets: ["90"],
              riverBet: {
                mode: "auto",
                effectiveStack: "",
                checkClosesAction: false,
                bets: [{ amount: "50", foldPercent: "0", callingRange: "" }],
              },
            },
            game: {
              handId: h.hand_id,
              openingSeats: h.opening_seats,
              count: h.count,
              dealer: h.dealer,
              smallBlind: h.small_blind,
              bigBlind: h.big_blind,
              street: 4,
              phase: "betting",
              actor: 0,
              folded: [false, false],
              paid: [0, 60],
              total: [30, 90],
              pending: [0],
              highest: 60,
              minRaise: 60,
              stacks: h.stacks,
              actedAt: [null, 60],
              historyComplete: true,
              events: h.events,
              log: [],
            },
          },
        }),
      );
    },
    { input, h, draft: manual.draft },
  );
});

test("limited tree runs in the background and compares call versus fold", async ({
  page,
}, testInfo) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let submitted = false;
  await page.route("**/api/v1/analyses", async (route) => {
    if (
      route.request().postDataJSON().strategies?.[0]?.id === "postflop-tree"
    ) {
      submitted = true;
      await gate;
    }
    await route.continue();
  });
  await page.goto("/");
  const quick = page.getByRole("region", { name: "快速分析", exact: true });
  await expect.poll(() => submitted).toBe(true);
  await expect(quick).toContainText("行动修正权益");
  await expect(quick).toContainText("正在比较翻牌/转牌有限行动树");
  release();
  await expect(
    quick.getByText("查看有限行动树与动作比较", { exact: true }),
  ).toBeVisible();
  await quick.getByText("查看有限行动树与动作比较", { exact: true }).click();
  const table = quick.getByRole("table", { name: "翻牌转牌候选动作" });
  await expect(table.getByRole("row")).toHaveCount(3);
  await expect(table).toContainText("跟注 60");
  await expect(table).toContainText("较弃牌");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("postflop-tree-mobile.png"),
    fullPage: true,
  });
});

test("tree failure can be retried without losing prior analysis", async ({
  page,
}) => {
  let treeCount = 0;
  let otherCount = 0;
  await page.route("**/api/v1/analyses", async (route) => {
    if (
      route.request().postDataJSON().strategies?.[0]?.id === "postflop-tree"
    ) {
      treeCount++;
      if (treeCount === 1) {
        await route.fulfill({ status: 503, json: {} });
        return;
      }
    } else otherCount++;
    await route.continue();
  });
  await page.goto("/");
  const quick = page.getByRole("region", { name: "快速分析", exact: true });
  await expect(quick).toContainText("有限树分析暂不可用");
  const prior = otherCount;
  await quick.getByRole("button", { name: "重试有限树" }).click();
  await expect(
    quick.getByText("查看有限行动树与动作比较", { exact: true }),
  ).toBeVisible();
  expect(otherCount).toBe(prior);
});

test("an action cancels a delayed tree id and hides the old recommendation", async ({
  page,
}) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let submitted = false;
  let cancelled = false;
  await page.route("**/api/v1/analyses/held-tree/cancel", async (route) => {
    cancelled = true;
    await route.fulfill({ json: { status: "cancelled" } });
  });
  await page.route("**/api/v1/analyses", async (route) => {
    if (
      route.request().postDataJSON().strategies?.[0]?.id === "postflop-tree"
    ) {
      submitted = true;
      await gate;
      await route.fulfill({
        status: 202,
        json: { task_id: "held-tree", status: "queued" },
      });
    } else await route.continue();
  });
  await page.goto("/");
  await expect.poll(() => submitted).toBe(true);
  await page
    .getByRole("region", { name: "真实牌局", exact: true })
    .getByRole("button", { name: "跟注 60", exact: true })
    .click();
  release();
  await expect.poll(() => cancelled).toBe(true);
  await expect(
    page.getByText("查看有限行动树与动作比较", { exact: true }),
  ).toHaveCount(0);
});

test("manual detailed analysis uses the same tree model and labels its EV correctly", async ({
  page,
}) => {
  await page.goto("/");
  await openTab(page, "精细分析");
  const choices = page.getByRole("group", {
    name: "精细分析策略",
    exact: true,
  });
  for (const box of await choices.getByRole("checkbox").all()) {
    if (await box.isChecked()) await box.uncheck();
  }
  await choices
    .getByRole("checkbox", { name: "翻牌/转牌有限行动树", exact: false })
    .check();
  await page.getByRole("button", { name: "执行精细分析", exact: true }).click();
  const result = page.getByRole("region", { name: "计算结果", exact: true });
  await expect(result).toContainText("最高候选收益");
  await result.getByText("查看有限行动树与动作比较", { exact: true }).click();
  await expect(
    result.getByRole("table", { name: "翻牌转牌候选动作" }).getByRole("row"),
  ).toHaveCount(3);
  await expect(result).not.toContainText("同一摊牌假设");
});
