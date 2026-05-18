import { test, expect } from "@playwright/test";

test.describe("home — no DiceRoll", () => {
  test("home page renders no .dice-roll button", async ({ page }) => {
    await page.goto("/");
    // Wait for the filter section to be visible so we know rendering is done
    await expect(page.getByRole("combobox", { name: /all bug types/i })).toBeVisible();
    // Regression guard: dice lives on /gallery only.
    expect(await page.locator(".dice-roll").count()).toBe(0);
  });
});
