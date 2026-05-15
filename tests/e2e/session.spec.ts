import { test, expect } from "@playwright/test";

test("home → start → session player → exit", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("line of bugs")).toBeVisible();

  // Pick 30s interval (shortest)
  await page.getByRole("button", { name: "30s" }).click();
  await page.getByRole("button", { name: /start session/i }).click();

  // Should land on /session
  await page.waitForURL(/\/session\?/);
  // Timer is visible
  await expect(page.locator("text=/\\d{2}:\\d{2}/")).toBeVisible();

  // Press space to pause
  await page.keyboard.press("Space");

  // Press Escape — back to home
  await page.keyboard.press("Escape");
  await page.waitForURL("/");
});

test("session keyboard B toggles B&W", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "30s" }).click();
  await page.getByRole("button", { name: /start session/i }).click();
  await page.waitForURL(/\/session\?/);

  // Trigger mousemove to ensure chrome visible
  await page.mouse.move(400, 300);

  const img = page.locator("img").first();
  const filterBefore = await img.evaluate((el) => getComputedStyle(el).filter);
  await page.keyboard.press("b");
  const filterAfter = await img.evaluate((el) => getComputedStyle(el).filter);
  expect(filterAfter).not.toBe(filterBefore);
});
