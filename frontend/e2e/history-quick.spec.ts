import { openTab } from "./workspace";
import { expect, test } from "@playwright/test";
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

test("action ranges update after the baseline, survive undo, and fit mobile", async ({
  page,
}, testInfo) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requested = false;
  await page.route("**/api/v1/analyses", async (route) => {
    if (
      route.request().postDataJSON().strategies?.[0]?.id === "history-ranges"
    ) {
      requested = true;
      await gate;
    }
    await route.continue();
  });
  await page.goto("/");
  const quick = page.getByRole("region", { name: "快速分析", exact: true });
  await expect.poll(() => requested).toBe(true);
  await openTab(page, "精细分析");
  const details = page.getByRole("region", {
    name: "快速分析说明",
    exact: true,
  });
  await expect(details).toContainText("正在根据本手行动");
  await expect(quick.getByLabel("快速底池权益百分比")).not.toHaveText("—");
  release();
  await expect(quick).toContainText("行动修正权益");
  await expect(details).toContainText("已按本手行动更新随机对手范围");
  const equity = await quick.getByLabel("快速底池权益百分比").innerText();
  await details.getByText("查看依据与适用条件", { exact: true }).click();
  await expect(details.getByLabel("行动范围摘要")).toContainText(
    "玩家 2：3 次行动",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("action-ranges-mobile.png"),
    fullPage: true,
  });
  await openTab(page, "当前牌局");
  const live = page.getByRole("region", { name: "真实牌局", exact: true });
  await live.getByRole("button", { name: "跟注 60", exact: true }).click();
  await expect(quick).not.toContainText("行动修正权益");
  await live.getByRole("button", { name: "撤销上一步", exact: true }).click();
  await expect(quick).toContainText("行动修正权益");
  await expect(quick.getByLabel("快速底池权益百分比")).toHaveText(equity);
});
