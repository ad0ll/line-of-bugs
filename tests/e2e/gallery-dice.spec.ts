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

    // Every preset filter param should be gone — these were all cleared
    const url = new URL(page.url());
    expect(url.searchParams.get("inst")).toBeNull();
    expect(url.searchParams.get("sex")).toBeNull();
    // view and life may or may not be present depending on the random
    // roll; assert they are NOT the preset values
    expect(url.searchParams.get("view")).not.toBe("dorsal");
    expect(url.searchParams.get("life")).not.toBe("adult");

    // At least one tile rendered after the roll
    await expect(page.locator(".grid-item-image").first()).toBeVisible();
  });
});
