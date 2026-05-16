import { test, expect } from "@playwright/test";

test("subject chip toggle is URL-synced and pagination resets", async ({ page }) => {
  await page.goto("/gallery?page=3");
  await page.waitForSelector("#gallery-grid");
  // Subject chips live in the first .filter-bar-chips row (role="group"
  // labelled "subject type"). Earlier .subject-type-chips selector was
  // dropped in the FilterBar unification.
  await page.getByRole("group", { name: "subject type" })
    .getByRole("button", { name: /^wild/ })
    .first()
    .click();
  await page.waitForURL(/subject=wild/);
  expect(page.url()).not.toMatch(/page=3/);
});

test("institution picker opens and toggles selection", async ({ page }) => {
  await page.goto("/gallery");
  await page.waitForSelector("#gallery-grid");
  // Institution lives inside "more filters" — disclosed panel hosts the
  // shared FilterPopover, no separate institution-popover class anymore.
  await page.getByRole("button", { name: /^more filters/i }).click();
  await page.getByRole("button", { name: /institution/i }).click();
  await expect(page.locator(".filter-popover-panel").first()).toBeVisible();
  // Click the label (covers the checkbox + name span) to avoid label/checkbox dispatch races
  const firstLabel = page.locator(".filter-popover-list li label").first();
  const name = (await firstLabel.locator(".filter-popover-name").textContent())!.trim();
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
