import { test, expect } from "@playwright/test";

test("home: 'what kind of bug?' starts collapsed; expands; chip selection updates URL + pool count", async ({ page }) => {
  await page.goto("/");
  // Wait for the live count to populate
  const count = page.locator(".home-pool-count");
  await expect(count).toContainText(/\d/, { timeout: 5000 });
  const baseline = parseInt(((await count.textContent()) ?? "").replace(/[^\d]/g, ""), 10);
  expect(baseline).toBeGreaterThan(1000);

  // Section starts collapsed — chips not in DOM (hidden body is aria-hidden)
  const trigger = page.getByRole("button", { name: /what kind of bug/i });
  await expect(trigger).toHaveAttribute("aria-expanded", "false");

  // Expand
  await trigger.click();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");

  // Pick butterflies — must use the chip with role=button and "butterflies" text
  const butterflies = page.locator("button.taxon-group-chip").filter({ hasText: /^butterflies/i });
  await butterflies.click();

  // URL syncs
  await page.waitForURL(/type=butterflies/);

  // Live count drops below baseline
  await expect.poll(async () => {
    const t = (await count.textContent()) ?? "";
    return parseInt(t.replace(/[^\d]/g, ""), 10);
  }, { timeout: 5000 }).toBeLessThan(baseline);
});

test("home: collapsed section shows badge when filter is active", async ({ page }) => {
  await page.goto("/?type=butterflies,beetles");
  const trigger = page.getByRole("button", { name: /what kind of bug/i });
  // Badge text matches "2 selected" — rendered inside the trigger
  await expect(trigger).toContainText(/2 selected/);
});

test("gallery: chip wall behind 'what kind of bug?' collapse; selecting filters the grid", async ({ page }) => {
  await page.goto("/gallery");
  await page.waitForSelector("#gallery-grid");

  const trigger = page.getByRole("button", { name: /what kind of bug/i });
  await expect(trigger).toHaveAttribute("aria-expanded", "false");

  await trigger.click();
  const ladybugs = page.locator("button.taxon-group-chip").filter({ hasText: /^ladybugs/i });
  await ladybugs.click();

  await page.waitForURL(/type=ladybugs/);
  const resultCount = page.locator(".gallery-result-count");
  // Ladybug count is ~1.2k — assert under 2000 (smaller than the unfiltered total).
  await expect.poll(async () => {
    const t = (await resultCount.textContent()) ?? "";
    return parseInt(t.replace(/[^\d]/g, ""), 10);
  }, { timeout: 5000 }).toBeLessThan(2000);
});

test("home: 'more filters' collapse holds the existing view/life/sex popovers", async ({ page }) => {
  await page.goto("/");
  const more = page.getByRole("button", { name: /^▸?\s*more filters/i });
  await expect(more).toHaveAttribute("aria-expanded", "false");
  await more.click();
  // After expand, the view popover trigger becomes visible
  await expect(page.getByRole("button", { name: /^view: all$/i })).toBeVisible();
});
