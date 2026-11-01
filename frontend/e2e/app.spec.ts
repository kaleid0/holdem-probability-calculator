import { openTab } from "./workspace";
import { test, expect } from "@playwright/test";
import { resolve } from "node:path";

test("weighted range, comparison, preference and stale results", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByText("牌局工具", { exact: false }).click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "导入", exact: true }).click();
  await (
    await chooser
  ).setFiles(resolve("../examples/weighted-comparison.json"));
  await openTab(page, "对手与范围");
  await expect(page.getByText("有效 2", { exact: false })).toBeVisible();
  await openTab(page, "当前牌局");
  await page
    .getByRole("button", { name: "精细分析当前牌局", exact: false })
    .click();
  await expect(page.getByLabel("底池权益百分比", { exact: true })).toHaveText(
    /75\.00\s*%/,
  );
  await expect(page.getByRole("heading", { name: "策略对照" })).toBeVisible();
  await expect(page.getByRole("button", { name: "查看详情" })).toHaveCount(2);
  await expect(page.getByText("精确枚举", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "查看详情" }).nth(1).click();
  await expect(
    page.getByRole("heading", { name: "规则触发依据" }),
  ).toBeVisible();
  await expect(
    page.getByText("当前权益 75.00%", { exact: false }),
  ).toBeVisible();
  await openTab(page, "精细分析");
  await page.getByLabel("权益安全余量（百分点）").fill("50");
  await openTab(page, "当前牌局");
  await page.getByLabel("需要跟注", { exact: true }).fill("100");
  await openTab(page, "精细分析");
  await expect(
    page.getByText("牌局已修改，以下为上一次计算结果。请重新计算。"),
  ).toBeVisible();
  await openTab(page, "当前牌局");
  await page
    .getByRole("button", { name: "精细分析当前牌局", exact: false })
    .click();
  await openTab(page, "精细分析");
  await expect(
    page.getByText("牌局已修改，以下为上一次计算结果。请重新计算。"),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "查看详情" }).nth(1).click();
  await expect(page.getByText("权益未达到规则阈值，偏向弃牌。")).toHaveCount(2);
  await expect(
    page.getByText("跟注参考 EV 87.50", { exact: false }),
  ).toHaveCount(2);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: "../.local/v02-desktop.png", fullPage: true });
  await page.screenshot({ path: "../.local/v02-overview.png" });
  await page.reload();
  await openTab(page, "对手与范围");
  await expect(page.getByLabel("对手 1 的手牌范围")).toHaveValue(
    "KsKh:0.75 TsTh:0.25",
  );
  expect(errors).toEqual([]);
});

test("mobile matrix edits, blockers, invalid input and partial strategy success", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "载入示例", exact: false }).click();
  await openTab(page, "对手与范围");
  await page.getByText("指定对手手牌或范围", { exact: true }).click();
  await page.getByLabel("对手 1 手牌模式").selectOption("range");
  await page.getByText("细分滑块 · 文本与精确输入", { exact: true }).click();
  await page.getByLabel("对手 1 的手牌范围").fill("AA,AKs");
  await expect(page.getByText("有效 6", { exact: false })).toBeVisible();
  await page
    .getByRole("button", { name: "QQ 范围权重 0%", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "QQ 范围权重 100%", exact: true }),
  ).toBeEnabled();
  await page.getByLabel("对手 1 的手牌范围").fill("bad");
  await expect(
    page.getByRole("alert").filter({ hasText: "无效手牌类别" }),
  ).toBeVisible();
  await page.getByLabel("对手 1 的手牌范围").fill("AA,AKs");
  await openTab(page, "精细分析");
  await page
    .getByRole("checkbox", { name: "权益余量规则", exact: false })
    .check();
  await openTab(page, "当前牌局");
  await page
    .getByRole("button", { name: "精细分析当前牌局", exact: false })
    .click();
  await expect(
    page.getByText("部分策略已完成", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText("本规则仅支持跟注后无后续投入的场景"),
  ).toBeVisible();
  const widths = await page.evaluate(() => ({
    width: window.innerWidth,
    content: document.documentElement.scrollWidth,
  }));
  expect(widths.content).toBeLessThanOrEqual(widths.width);
});

test("v1 import remains usable", async ({ page }) => {
  await page.goto("/");
  await page.getByText("牌局工具", { exact: false }).click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "导入", exact: true }).click();
  await (await chooser).setFiles(resolve("../examples/three-way-split.json"));
  await expect(page.getByText("已导入牌局。", { exact: true })).toBeVisible();
  await openTab(page, "当前牌局");
  await page
    .getByRole("button", { name: "精细分析当前牌局", exact: false })
    .click();
  await expect(page.getByLabel("底池权益百分比", { exact: true })).toHaveText(
    /33\.33\s*%/,
  );
  await expect(
    page
      .getByRole("region", { name: "精细分析", exact: true })
      .getByText("100.00%", { exact: true }),
  ).toBeVisible();
});
