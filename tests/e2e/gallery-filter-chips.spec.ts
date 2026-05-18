import { test, expect } from "@playwright/test";

test.describe("gallery filter chips — single-line row regression", () => {
  test("selecting multiple bug types keeps the filter row at one line", async ({ page }) => {
    await page.goto("/gallery");
    // Open the "what bug" picker and select 3 groups
    await page.getByRole("combobox", { name: /all bug types/i }).click();
    // Wait for the default-groups list to render (empty-q backend call)
    await page.waitForResponse((r) => r.url().includes("/api/search/insect"));
    // Each option's accessible name is "group <name> <count>" (the kind
    // badge "group" prefixes the row). Match the name via accessible
    // name — its DOM text content concatenates spans without whitespace
    // ("groupbutterflies2,855"), so a \b regex against text content fails;
    // role-name matching uses the aria-friendly spaced form.
    for (const group of ["butterflies", "moths", "beetles"]) {
      await page.getByRole("option", { name: new RegExp(`\\b${group}\\b`, "i") }).first().click();
    }
    // Close the picker
    await page.keyboard.press("Escape");

    // Chip text reflects 3 selections
    await expect(page.getByRole("combobox", { name: /3 bug types/i })).toBeVisible();

    // Filter row should remain visually a single line (≤80px on a fresh
    // gallery view at default desktop width).
    const rowBox = await page.locator(".gallery-filter-row").boundingBox();
    expect(rowBox).not.toBeNull();
    expect(rowBox!.height).toBeLessThanOrEqual(80);
  });

  test("selections zone inside picker lists removable chips", async ({ page }) => {
    await page.goto("/gallery?type=butterflies%2Cmoths");
    await page.getByRole("combobox", { name: /2 bug types/i }).click();
    await expect(page.getByText(/^selected \(2\)$/i)).toBeVisible();
    await page.getByRole("button", { name: /remove butterflies/i }).click();
    // Combobox count updates
    await expect(page.getByRole("combobox", { name: /1 bug type/i })).toBeVisible();
  });
});
