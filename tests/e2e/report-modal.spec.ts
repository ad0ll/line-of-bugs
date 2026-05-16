import { test, expect } from "@playwright/test";

test("R key opens report modal during session, Esc closes it", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "30s" }).click();
  await page.getByRole("button", { name: /start session/i }).click();
  await page.waitForURL(/\/session\?session=/);
  await page.waitForSelector('img[src*="/api/img/"]');

  await page.keyboard.press("r");
  await expect(page.getByRole("dialog", { name: /report this image/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /^submit$/i })).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("full-page /report/[id] form submits successfully", async ({ page }) => {
  await page.goto("/gallery");
  // Filter to real tiles ([data-id] is set on GridTile; skeleton tiles
  // from loading.tsx lack the attribute and would otherwise be picked up
  // by `.grid-item` during the streaming render window).
  await page.waitForSelector(".grid-item[data-id]");
  const imageId = await page.locator(".grid-item[data-id]").first().getAttribute("data-id");
  expect(imageId).toBeTruthy();

  await page.goto(`/report/${imageId}`);
  await expect(page.getByText(/^report this image$/i)).toBeVisible();
  await page.getByRole("button", { name: /low-resolution/i }).click();
  await page.getByRole("button", { name: /^submit$/i }).click();
  await page.waitForURL("/");
});
