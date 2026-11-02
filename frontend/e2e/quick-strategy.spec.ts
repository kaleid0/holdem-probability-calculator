import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

const input = JSON.parse(
  readFileSync(
    new URL("../../examples/river-auto-analysis.json", import.meta.url),
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
  const h = input.strategies[0].config.history_context;
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
              hero: input.hero,
              board: input.board,
              boardSize: 5,
              opponents: [{ kind: "random" }],
              pot: "180",
              call: "0",
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
              street: 5,
              phase: "betting",
              actor: 0,
              folded: [false, false],
              paid: [0, 0],
              total: [90, 90],
              pending: [0],
              highest: 0,
              minRaise: 10,
              stacks: h.stacks,
              actedAt: [null, 0],
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

test("quick river model runs after the baseline and keeps it visible while delayed", async ({
  page,
}, testInfo) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let riverSubmitted = false;
  await page.route("**/api/v1/analyses", async (route) => {
    if (route.request().postDataJSON().strategies?.[0]?.id === "river-bet") {
      riverSubmitted = true;
      await gate;
    }
    await route.continue();
  });
  await page.goto("/");
  const quick = page.getByRole("region", { name: "快速分析", exact: true });
  await expect(quick).toContainText("已更新至当前牌局");
  await expect.poll(() => riverSubmitted).toBe(true);
  await expect(quick.getByLabel("快速底池权益百分比")).not.toHaveText("—");
  await expect(quick).toContainText("正在自动比较河牌下注");
  release();
  const advice = quick.getByLabel("快速行动建议");
  await expect(advice).toContainText(/三种假设下均为最优候选|对对手假设敏感/);
  await advice.getByText("查看依据与适用条件", { exact: true }).click();
  await expect(
    advice.getByRole("table", { name: "快速河牌候选动作" }).getByRole("row"),
  ).toHaveCount(8);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("quick-strategy-mobile.png"),
    fullPage: true,
  });
});

test("advanced failure and retry preserve the baseline without resubmitting it", async ({
  page,
}) => {
  let baselineCount = 0;
  let riverCount = 0;
  await page.route("**/api/v1/analyses", async (route) => {
    if (route.request().postDataJSON().strategies?.[0]?.id === "river-bet") {
      riverCount++;
      if (riverCount === 1) {
        await route.fulfill({ status: 503, json: {} });
        return;
      }
    } else baselineCount++;
    await route.continue();
  });
  await page.goto("/");
  const quick = page.getByRole("region", { name: "快速分析", exact: true });
  await expect(quick).toContainText("河牌分析暂不可用");
  const equity = await quick.getByLabel("快速底池权益百分比").innerText();
  const count = baselineCount;
  await quick.getByRole("button", { name: "重试河牌分析" }).click();
  await expect(quick.getByLabel("快速行动建议")).toContainText(
    /三种假设下均为最优候选|对对手假设敏感/,
  );
  expect(baselineCount).toBe(count);
  await expect(quick.getByLabel("快速底池权益百分比")).toHaveText(equity);
});

test("a river submission superseded by an action is cancelled when its id arrives", async ({
  page,
}) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let submitted = false;
  let cancelled = false;
  await page.route("**/api/v1/analyses/held-river/cancel", async (route) => {
    cancelled = true;
    await route.fulfill({ json: { status: "cancelled" } });
  });
  await page.route("**/api/v1/analyses", async (route) => {
    if (route.request().postDataJSON().strategies?.[0]?.id === "river-bet") {
      submitted = true;
      await gate;
      await route.fulfill({
        status: 202,
        json: { task_id: "held-river", status: "queued" },
      });
    } else await route.continue();
  });
  await page.goto("/");
  await expect.poll(() => submitted).toBe(true);
  await page
    .getByRole("region", { name: "真实牌局", exact: true })
    .getByRole("button", { name: "过牌", exact: true })
    .click();
  release();
  await expect.poll(() => cancelled).toBe(true);
  const quick = page.getByRole("region", { name: "快速分析", exact: true });
  await expect(quick).not.toContainText("正在自动比较河牌下注");
  await expect(quick.getByLabel("快速行动建议")).toContainText("等待你的行动");
});
