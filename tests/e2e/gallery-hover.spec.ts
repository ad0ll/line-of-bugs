import { test, expect } from "@playwright/test";

test("hover over a tile shows the popup with a medium image", async ({ page }) => {
  await page.goto("/gallery");
  await page.waitForSelector("#gallery-grid .grid-item");
  const thumb = page.locator(".grid-item").first().locator(".grid-item-image");
  await thumb.hover();
  // 250ms hover-intent triggers .visible class — wait on the assertion
  // instead of guessing the timing.
  const popup = page.locator(".hover-zoom-popup.visible");
  await expect(popup).toBeVisible();
  const img = popup.locator("img");
  await expect(img).toHaveAttribute("src", /\/api\/medium\//);
});

test("moving cursor away hides popup", async ({ page }) => {
  await page.goto("/gallery");
  await page.waitForSelector("#gallery-grid .grid-item");
  const thumb = page.locator(".grid-item").first().locator(".grid-item-image");
  await thumb.hover();
  await expect(page.locator(".hover-zoom-popup.visible")).toBeVisible();
  await page.mouse.move(0, 0);
  await expect(page.locator(".hover-zoom-popup.visible")).toHaveCount(0);
});
