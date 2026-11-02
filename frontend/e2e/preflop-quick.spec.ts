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
  await expect(quick.getByLabel("快速行动建议")).toContainText("本次追加 20");
  await expect(quick).toContainText("计算服务暂时不可用");
  await expect(quick.getByLabel("快速底池权益百分比")).toHaveText("—");
  await expect(quick.getByLabel("快速行动建议")).toContainText("非 GTO 表");
});
