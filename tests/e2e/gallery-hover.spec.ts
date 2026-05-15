import { test, expect } from "@playwright/test";

test("hover over a tile shows the popup with a medium image", async ({ page }) => {
  await page.goto("/gallery");
  await page.waitForSelector("#gallery-grid .grid-item");
  const thumb = page.locator(".grid-item").first().locator(".grid-item-image");
  await thumb.hover();
  // 250ms hover-intent + small buffer
  await page.waitForTimeout(400);
  const popup = page.locator(".hover-zoom-popup.visible");
  await expect(popup).toBeVisible();
  const img = popup.locator("img");
  const src = await img.getAttribute("src");
  expect(src).toMatch(/\/api\/medium\//);
});

test("moving cursor away hides popup", async ({ page }) => {
  await page.goto("/gallery");
  await page.waitForSelector("#gallery-grid .grid-item");
  const thumb = page.locator(".grid-item").first().locator(".grid-item-image");
  await thumb.hover();
  await page.waitForTimeout(400);
  await page.mouse.move(0, 0);
  await page.waitForTimeout(200);
  await expect(page.locator(".hover-zoom-popup.visible")).toHaveCount(0);
});
