import { openTab } from "./workspace";
import { expect, test } from "@playwright/test";
import { emptyDraft } from "../src/model";
import { createGame, startGame } from "../src/liveGame";

test("preflop advice is available without waiting for the probability service", async ({
  page,
}) => {
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
