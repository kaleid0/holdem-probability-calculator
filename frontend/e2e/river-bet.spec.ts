import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { openTab } from "./workspace";

const fixture = JSON.parse(
  readFileSync(
    new URL("../../examples/river-bet.json", import.meta.url),
    "utf8",
  ),
);

test.beforeEach(async ({ page }) => {
  await page.addInitScript((draft) => {
    if (!localStorage.getItem("holdem-lab:session:v1"))
      localStorage.setItem(
        "holdem-lab:session:v1",
        JSON.stringify({
          schemaVersion: 1,
          session: { draft, game: null, history: [], mode: "snapshot" },
        }),
      );
  }, fixture.draft);
  await page.goto("/");
  await openTab(page, "精细分析");
});

test("river responses, candidate EVs, settings persistence and mobile layout", async ({
  page,
}, testInfo) => {
  await expect(page.getByLabel("有效筹码", { exact: true })).toHaveValue("200");
  await page.getByRole("button", { name: "执行精细分析", exact: true }).click();
  const result = page.getByRole("region", { name: "计算结果", exact: true });
  await expect(result).toContainText("过牌的 EV 最高（50.00 筹码）");
  const table = result.getByRole("table").first();
  await expect(table.getByRole("row")).toHaveCount(4);
  await expect(table.getByRole("row").nth(1)).toContainText("50.00");
  await expect(table.getByRole("row").nth(2)).toContainText("25.00");
  await expect(table.getByRole("row").nth(2)).toContainText("50.00% / 0.00%");
  await expect(
    table.getByRole("row").nth(3).getByRole("cell").nth(2),
  ).toHaveText("0.00");
  await page.getByLabel("方案 1 弃牌率", { exact: true }).fill("75");
  await expect(result).toContainText("牌局已修改");
  await page.getByRole("button", { name: "执行精细分析", exact: true }).click();
  await expect(result).toContainText("下注 50的 EV 最高（62.50 筹码）");
  await page.getByRole("button", { name: "添加下注方案", exact: true }).click();
  await expect(page.getByLabel("方案 3 下注金额", { exact: true })).toHaveValue(
    "150",
  );
  await page.getByRole("button", { name: "移除方案 3", exact: true }).click();
  await page.reload();
  await openTab(page, "精细分析");
  await expect(page.getByLabel("方案 1 弃牌率", { exact: true })).toHaveValue(
    "75",
  );
  await page.getByRole("button", { name: "执行精细分析", exact: true }).click();
  await expect(result).toContainText("62.50 筹码");
  await page.screenshot({
    path: testInfo.outputPath("river-bet-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: testInfo.outputPath("river-bet-mobile.png"),
    fullPage: true,
  });
});

test("incoherent response preserves other strategy results", async ({
  page,
}) => {
  await page
    .getByRole("checkbox", { name: "底池赔率基线", exact: false })
    .check();
  await page.getByLabel("方案 1 弃牌率", { exact: true }).fill("10");
  await page.getByRole("button", { name: "执行精细分析", exact: true }).click();
  const result = page.getByRole("region", { name: "计算结果", exact: true });
  await expect(result).toContainText("部分策略已完成");
  await expect(result).toContainText("弃牌率与跟注范围不一致");
  await expect(result.getByLabel("底池权益百分比", { exact: true })).toHaveText(
    "50.00%",
  );
});
