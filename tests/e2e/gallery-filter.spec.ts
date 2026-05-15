import { test, expect } from "@playwright/test";

test("subject chip toggle is URL-synced and pagination resets", async ({ page }) => {
  await page.goto("/gallery?page=3");
  await page.waitForSelector("#gallery-grid");
  await page.getByRole("button", { name: /nature/i, exact: false }).first().click();
  await page.waitForURL(/subject=nature/);
  expect(page.url()).not.toMatch(/page=3/);
});

test("institution picker opens and toggles selection", async ({ page }) => {
  await page.goto("/gallery");
  await page.waitForSelector("#gallery-grid");
  await page.getByRole("button", { name: /institution/i }).click();
  await expect(page.locator(".institution-popover")).toBeVisible();
  // Click the label (covers the checkbox + name span) to avoid label/checkbox dispatch races
  const firstLabel = page.locator(".institution-list li label").first();
  const name = (await firstLabel.locator("span").first().textContent())!.trim();
  await firstLabel.click();
  await page.waitForURL(/inst=/);
  // URLSearchParams.toString() form-encodes spaces as `+`, but the test
  // wants to assert against the human-readable name. Normalize both.
  const decoded = decodeURIComponent(page.url().replace(/\+/g, "%20"));
  expect(decoded).toContain(`inst=${name}`);
});

test("infinite scroll appends a second page of tiles", async ({ page }) => {
  await page.goto("/gallery");
  await page.waitForSelector("#gallery-grid .grid-item");
  const before = await page.locator(".grid-item").count();
  // Scroll to the sentinel — InfiniteScroller fires fetch + appends
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  // Allow time for IntersectionObserver + fetch + render
  await page.waitForFunction(
    (n) => document.querySelectorAll(".grid-item").length > n,
    before,
    { timeout: 5000 },
  );
  const after = await page.locator(".grid-item").count();
  expect(after).toBeGreaterThan(before);
});
