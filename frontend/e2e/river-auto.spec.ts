import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { openTab } from "./workspace";

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

test("automatically resolves history, stacks, sizes and response without manual parameters", async ({
  page,
}, testInfo) => {
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
  await page.goto("/");
  await openTab(page, "精细分析");
  await expect(page.getByLabel("河牌策略参数来源")).toHaveValue("auto");
  await expect(page.getByLabel("有效筹码", { exact: true })).toHaveCount(0);
  await expect(
    page.getByText("当前有效筹码 910", { exact: false }),
  ).toBeVisible();
  const submitted = page.waitForRequest(
    (req) =>
      req.method() === "POST" &&
      req.url().endsWith("/api/v1/analyses") &&
      req
        .postDataJSON()
        .strategies?.some((s: { id: string }) => s.id === "river-bet"),
  );
  await page.getByRole("button", { name: "执行精细分析", exact: true }).click();
  const config = (await submitted).postDataJSON().strategies[0].config;
  expect(config).toMatchObject({
    mode: "auto",
    opponent_seats: [1],
    history_context: { cutoff_sequence: 12 },
  });
  expect(config).not.toHaveProperty("effective_stack");
  expect(config).not.toHaveProperty("bets");
  const evidence = page.getByRole("region", {
    name: "系统推断依据",
    exact: true,
  });
  await expect(evidence).toContainText("有效筹码 910");
  await expect(evidence).toContainText("4 次行动");
  const result = page.getByRole("region", { name: "计算结果", exact: true });
  await expect(
    result
      .getByRole("table", { name: "河牌候选动作", exact: true })
      .getByRole("row"),
  ).toHaveCount(8);
  await expect(
    page.getByLabel("河牌自动分析可用性", { exact: true }),
  ).toContainText("当前满足");
  await expect(
    result.getByRole("table", { name: "自动策略三情景对照" }).getByRole("row"),
  ).toHaveCount(4);
  await expect(
    result.getByRole("table", { name: "河牌候选动作" }),
  ).toContainText("较过牌");
  await evidence.getByText("查看后验范围摘要", { exact: true }).click();
  await expect(
    evidence.getByRole("table", { name: "后验范围摘要" }),
  ).toBeVisible();
  await evidence.getByText("查看历史与环境依据", { exact: true }).click();
  await expect(evidence).toContainText("#12");
  await page.getByLabel("河牌策略参数来源").selectOption("manual");
  await expect(page.getByLabel("有效筹码", { exact: true })).toHaveValue("910");
  await expect(
    page.getByRole("checkbox", { name: "确认过牌后直接摊牌", exact: false }),
  ).toBeChecked();
  await page.getByLabel("河牌策略参数来源").selectOption("auto");
  await page.screenshot({
    path: testInfo.outputPath("automatic-river-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: testInfo.outputPath("automatic-river-mobile.png"),
    fullPage: true,
  });
  await page.reload();
  await openTab(page, "精细分析");
  await expect(page.getByLabel("河牌策略参数来源")).toHaveValue("auto");
  await expect(
    page.getByText("已记录 12 个事件", { exact: false }),
  ).toBeVisible();
});

test("missing history is explained and manual fallback preserves settings", async ({
  page,
}) => {
  await page.addInitScript((draft) => {
    localStorage.setItem(
      "holdem-lab:session:v1",
      JSON.stringify({
        schemaVersion: 1,
        session: { draft, game: null, history: [], mode: "snapshot" },
      }),
    );
  }, manual.draft);
  await page.goto("/");
  await openTab(page, "精细分析");
  await page.getByLabel("河牌策略参数来源").selectOption("auto");
  await expect(
    page.getByLabel("河牌自动分析可用性", { exact: true }),
  ).toContainText("完整本手记录");
  await page.getByRole("button", { name: "执行精细分析", exact: true }).click();
  const result = page.getByRole("region", { name: "计算结果", exact: true });
  await expect(result).toContainText("自动推断缺少完整本手历史");
  await page.getByLabel("河牌策略参数来源").selectOption("manual");
  await expect(page.getByLabel("有效筹码", { exact: true })).toHaveValue("200");
  await page.getByRole("button", { name: "执行精细分析", exact: true }).click();
  await expect(result).toContainText("过牌的 EV 最高（50.00 筹码）");
});
