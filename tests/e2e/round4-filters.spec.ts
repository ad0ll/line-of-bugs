import { test, expect, type Page } from "@playwright/test";

/**
 * R6 moved the view / life-stage / sex popovers behind a collapsible
 * "more filters" section on both home and gallery. Tests that exercise
 * those popovers must first expand the section.
 */
async function openMoreFilters(page: Page) {
  const trigger = page.getByRole("button", { name: /^▸?\s*more filters/i });
  await trigger.click();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
}

test("gallery: view popover opens, shows unknown chip, filters results", async ({ page }) => {
  await page.goto("/gallery");
  await page.waitForSelector("#gallery-grid");
  await openMoreFilters(page);
  await page.getByRole("button", { name: /^view: all$/i }).click();
  // FilterPopover keeps all panels in the DOM (toggling the `hidden`
  // attribute) so aria-controls targets always exist. Scope to the open
  // panel to dodge strict-mode multiplicity across the three popovers.
  const openPanel = page.locator(".filter-popover-panel:not([hidden])");
  const unknownLabel = openPanel.locator("li label").filter({ hasText: /unknown/i });
  await expect(unknownLabel).toBeVisible();
  const dorsalLabel = openPanel.locator("li label").filter({ hasText: /^dorsal/i });
  await expect(dorsalLabel).toBeVisible();
  await dorsalLabel.click();
  await page.waitForURL(/view=dorsal/);
  expect(page.url()).toContain("view=dorsal");
});

test("home: filter popovers render and live count updates", async ({ page }) => {
  await page.goto("/");
  const count = page.locator(".home-pool-count");
  await expect(count).toContainText(/\d/, { timeout: 5000 });
  const baselineNum = parseInt(((await count.textContent()) ?? "").replace(/[^\d]/g, ""), 10);
  expect(baselineNum).toBeGreaterThan(0);

  await openMoreFilters(page);
  await page.getByRole("button", { name: /^view: all$/i }).click();
  const openPanel = page.locator(".filter-popover-panel:not([hidden])");
  const dorsalLabel = openPanel.locator("li label").filter({ hasText: /^dorsal/i });
  await dorsalLabel.click();
  await page.waitForURL(/view=dorsal/);
  await expect.poll(async () => {
    const t = (await count.textContent()) ?? "";
    return parseInt(t.replace(/[^\d]/g, ""), 10);
  }, { timeout: 5000 }).toBeLessThan(baselineNum);
});

test("home: subject + view filters persist via URL", async ({ page }) => {
  await page.goto("/?subject=specimen&view=dorsal");
  await expect(page.locator(".home-pool-count")).toContainText(/\d/, { timeout: 5000 });
  // R6: "more filters" badge reads "1 selected" when view filter is active.
  // The view popover itself is inside the collapse; we don't need to expand
  // to assert the badge.
  const moreTrigger = page.getByRole("button", { name: /^▸?\s*more filters/i });
  await expect(moreTrigger).toContainText(/1 selected/);
  const specimenPill = page.locator(".home-pill").filter({ hasText: /^specimen$/i });
  await expect(specimenPill).toHaveAttribute("aria-checked", "true");
});
