import { test, expect } from "@playwright/test";

test("gallery: view popover opens, shows unknown chip, filters results", async ({ page }) => {
  await page.goto("/gallery");
  await page.waitForSelector("#gallery-grid");
  // open the view popover (chip labelled "view: all")
  await page.getByRole("button", { name: /^view: all$/i }).click();
  // unknown must be visible — most rows are unlabeled iNat photos so
  // we want the option to be discoverable (not cryptic)
  const unknownLabel = page.locator(".filter-popover-list li label").filter({ hasText: /unknown/i });
  await expect(unknownLabel).toBeVisible();
  // dorsal should also be present
  const dorsalLabel = page.locator(".filter-popover-list li label").filter({ hasText: /^dorsal/i });
  await expect(dorsalLabel).toBeVisible();
  await dorsalLabel.click();
  await page.waitForURL(/view=dorsal/);
  expect(page.url()).toContain("view=dorsal");
});

test("home: filter popovers render and live count updates", async ({ page }) => {
  await page.goto("/");
  // Wait for the live count to populate
  const count = page.locator(".home-pool-count");
  await expect(count).toContainText(/\d/, { timeout: 5000 });
  const baselineText = (await count.textContent()) ?? "";
  const baselineNum = parseInt(baselineText.replace(/[^\d]/g, ""), 10);
  expect(baselineNum).toBeGreaterThan(0);

  // Open the view popover and pick dorsal — count should drop
  await page.getByRole("button", { name: /^view: all$/i }).click();
  const dorsalLabel = page.locator(".filter-popover-list li label").filter({ hasText: /^dorsal/i });
  await dorsalLabel.click();
  await page.waitForURL(/view=dorsal/);
  // Live count refetches; should be smaller than baseline.
  await expect.poll(async () => {
    const t = (await count.textContent()) ?? "";
    return parseInt(t.replace(/[^\d]/g, ""), 10);
  }, { timeout: 5000 }).toBeLessThan(baselineNum);
});

test("home: subject + view filters persist via URL", async ({ page }) => {
  await page.goto("/?subject=specimen&view=dorsal");
  await expect(page.locator(".home-pool-count")).toContainText(/\d/, { timeout: 5000 });
  // "view: 1 selected" should be the trigger label
  await expect(page.getByRole("button", { name: /view: 1 selected/i })).toBeVisible();
  // Subject pill "specimen" should be active
  const specimenPill = page.locator(".home-pill").filter({ hasText: /^specimen$/i });
  await expect(specimenPill).toHaveAttribute("aria-checked", "true");
});
