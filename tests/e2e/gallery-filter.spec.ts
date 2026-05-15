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
  expect(decodeURIComponent(page.url())).toContain(`inst=${name}`);
});

test("Load more increments page param", async ({ page }) => {
  await page.goto("/gallery");
  await page.waitForSelector("#gallery-grid");
  const link = page.getByRole("link", { name: /load more/i });
  const count = await link.count();
  if (count === 0) {
    test.skip(true, "fewer than 200 results — no load-more link");
  }
  await link.click();
  await page.waitForURL(/page=2/);
});
