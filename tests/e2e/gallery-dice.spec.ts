import { test, expect } from "@playwright/test";

test.describe("gallery dice — clear-then-roll", () => {
  test("clicking 'roll' clears existing filters and applies a random subset", async ({ page }) => {
    // Pre-load with filters set via URL params
    await page.goto("/gallery?view=dorsal&life=adult&sex=female&inst=USNM");

    // Sanity check the dice chip is present
    await expect(page.locator(".dice-roll")).toBeVisible();

    // Click the dice
    await page.locator(".dice-roll").click();

    // Wait for the URL to settle (give the router a tick + facets refetch)
    await page.waitForLoadState("networkidle");

    // inst and sex are always cleared by the roll (they're never re-rolled
    // — only groups/views/life/subjects are rollable axes).
    const url = new URL(page.url());
    expect(url.searchParams.get("inst")).toBeNull();
    expect(url.searchParams.get("sex")).toBeNull();
    // Since inst was definitively cleared, the URL is guaranteed to differ
    // from the pristine pre-roll URL — no flake on the view/life axes which
    // can land on the preset value by chance (0.5 × 0.25 = 12.5% for view).
    expect(`${url.pathname}${url.search}`).not.toBe(
      "/gallery?view=dorsal&life=adult&sex=female&inst=USNM",
    );

    // The gallery is in a reachable post-roll state — either tiles
    // rendered, or the empty-state copy shows (a dice roll can legitimately
    // land on a filter combo with no matching photos, e.g. ventral larva
    // of a rare group).
    const tileOrEmpty = page
      .locator(".grid-item-image")
      .first()
      .or(page.getByText(/no bugs found with those filters/i));
    await expect(tileOrEmpty).toBeVisible();
  });
});
