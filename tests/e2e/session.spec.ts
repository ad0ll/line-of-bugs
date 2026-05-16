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

  // Press Escape — back to home.
  // Both `page.keyboard.press("Escape")` and `locator.press("Escape")`
  // silently no-op in Firefox + WebKit (Playwright protocol quirk —
  // verified by instrumenting window/document/body keydown listeners
  // and observing zero events). The only reliable cross-browser way
  // to fire a keydown for Escape is evaluate + dispatchEvent.
  await page.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  });
  // Home page re-syncs interval state into the URL on mount (e.g.,
  // `/?interval=30`), so wait on the pathname only.
  await page.waitForURL((url) => new URL(url).pathname === "/");
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
