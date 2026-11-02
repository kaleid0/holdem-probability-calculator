import { openTab } from "./workspace";
import { expect, test } from "@playwright/test";
import { emptyDraft } from "../src/model";
import { createGame, startGame } from "../src/liveGame";

test("current action EV updates response assumptions and clears stale results", async ({
  page,
}) => {
  const game = startGame(createGame(2, 0, 5, 10, [1000, 1000]));
  const draft = {
    ...emptyDraft(),
    hero: [48, 49],
    pot: "15",
    call: "5",
    opponents: [{ kind: "random" }],
  };
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
  await page.goto("/");
  await expect(
    page
      .getByRole("region", { name: "快速分析", exact: true })
      .getByRole("table"),
  ).toHaveCount(0);
  await openTab(page, "精细分析");
  const panel = page.getByLabel("当前行动 EV 比较");
  await expect(panel.getByRole("table")).toBeVisible();
  await expect(panel).toContainText("跟注 5");
  await expect(panel).toContainText("不利假设 EV");
  const before = await panel.getByRole("table").innerText();
  await panel.getByText("调整响应假设与查看计算边界").click();
  await panel.getByLabel("面对下注／加注弃牌率").fill("100");
  await expect(panel.getByLabel("面对下注／加注再加注率")).toHaveValue("0");
  await expect(panel.getByRole("table")).not.toHaveText(before);
  await expect(panel).toContainText("不是整手牌完整 EV");
  // A new load without a current service result must not display cached EV.
  await page.route("**/api/v1/analyses", (route) =>
    route.fulfill({ status: 503, json: {} }),
  );
  await page.reload();
  await openTab(page, "精细分析");
  await expect(panel.getByRole("table")).toHaveCount(0);
  await expect(panel).toContainText("等待当前牌局权益计算完成");
});
