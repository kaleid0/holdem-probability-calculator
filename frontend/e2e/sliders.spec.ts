import { test, expect } from "@playwright/test";

test("range sliders are immediate, independent of preview API, and support rapid matrix edits", async ({
  page,
}) => {
  const previews: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/ranges/preview")) previews.push(request.url());
  });
  await page.goto("/");
  await page.getByRole("button", { name: "载入示例", exact: false }).click();
  await page.getByText("指定对手手牌或范围", { exact: true }).click();
  await page.getByLabel("对手 1 手牌模式").selectOption("range");
  await expect(page.getByLabel("对手 1 的手牌范围")).not.toBeVisible();
  const width = page.getByRole("slider", {
    name: "对手 1 范围宽度",
    exact: true,
  });
  await width.press("End");
  await expect(page.getByText("共 1326 组合", { exact: false })).toBeVisible();
  const weight = page.getByRole("slider", {
    name: "对手 1 统一权重",
    exact: true,
  });
  await weight.press("Home");
  await expect(page.getByText("共 0 组合", { exact: false })).toBeVisible();
  await weight.press("End");
  await expect(page.getByText("共 1326 组合", { exact: false })).toBeVisible();
  for (let i = 0; i < 10; i++) await width.press("ArrowLeft");
  await expect(width).toHaveValue("90");
  await page
    .getByRole("group", { name: "对手 1 范围快捷滑块", exact: true })
    .screenshot({ path: "../.local/range-sliders-controls.png" });
  await page.getByRole("button", { name: "清空", exact: true }).click();
  await page
    .getByRole("button", { name: "AA 范围权重 0%", exact: true })
    .click();
  await page
    .getByRole("button", { name: "KK 范围权重 0%", exact: true })
    .click();
  await page
    .getByRole("button", { name: "QQ 范围权重 0%", exact: true })
    .click();
  await expect(page.getByText("共 18 组合", { exact: false })).toBeVisible();
  await page.getByText("细分滑块 · 文本与精确输入", { exact: true }).click();
  await page
    .getByRole("slider", { name: "对手 1 同花范围", exact: true })
    .press("End");
  await expect(page.getByText("共 330 组合", { exact: false })).toBeVisible();
  expect(previews).toEqual([]);
  await page
    .getByRole("button", { name: "计算当前牌局", exact: false })
    .click();
  await expect(page.getByLabel("底池权益百分比")).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "../.local/range-sliders.png",
    fullPage: true,
  });
});

test("mobile range width can be dragged and precise edits retain their own weights", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "载入示例", exact: false }).click();
  await page.getByText("指定对手手牌或范围", { exact: true }).click();
  await page.getByLabel("对手 1 手牌模式").selectOption("range");
  const slider = page.getByRole("slider", {
    name: "对手 1 范围宽度",
    exact: true,
  });
  await slider.scrollIntoViewIfNeeded();
  const box = await slider.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width * 0.15, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width * 0.6, box!.y + box!.height / 2, {
    steps: 20,
  });
  await page.mouse.up();
  const width = Number(await slider.inputValue());
  expect(width).toBeGreaterThan(50);
  expect(width).toBeLessThan(70);
  await page.getByText("细分滑块 · 文本与精确输入", { exact: true }).click();
  await page.getByLabel("对手 1 的手牌范围").fill("KsKh:0.75 TsTh:0.25");
  await expect(
    page.getByRole("button", { name: "KK 范围权重 75%", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "TT 范围权重 25%", exact: true }),
  ).toBeEnabled();
  await page.reload();
  await page.getByText("细分滑块 · 文本与精确输入", { exact: true }).click();
  await expect(page.getByLabel("对手 1 的手牌范围")).toHaveValue(
    "KsKh:0.75 TsTh:0.25",
  );
});
