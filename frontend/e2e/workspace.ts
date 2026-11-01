import type { Page } from "@playwright/test";

export async function openTab(
  page: Page,
  name: "当前牌局" | "对手与范围" | "精细分析" | "牌桌与筹码",
) {
  await page.getByRole("tab", { name, exact: true }).click();
}
