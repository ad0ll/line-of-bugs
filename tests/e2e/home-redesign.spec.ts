import { test, expect } from "@playwright/test";

test.describe("home redesign", () => {
  test("hero shows centered title + dynamic tagline with count", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("line of bugs");
    const tagline = page.locator(".home-tagline");
    await expect(tagline).toContainText(/insects, tenderly photographed/);
    await expect(tagline).toContainText(/\d{2,}/); // formatted count present
  });

  test("filter rows render with all-or-chips empty state", async ({ page }) => {
    await page.goto("/");
    // The "what bug" row replaces the old "bug type" + "species" rows; its
    // empty-state combobox label still includes "all bug types" so the same
    // selector matches.
    for (const label of ["all photo types", "all bug types", "all views", "all life stages", "all sexes"]) {
      await expect(page.getByRole("combobox", { name: new RegExp(label, "i") })).toBeVisible();
    }
  });

  test("selecting a bug type via WhatIsBugFilter narrows the pool count", async ({ page }) => {
    await page.goto("/");
    const poolText = () => page.locator(".home-pool-count").innerText();
    const before = await poolText();
    // WhatIsBugFilter combobox: click it, type a partial query, pick the group.
    await page.getByRole("combobox", { name: /all bug types/i }).click();
    await page.getByPlaceholder(/type to search bugs/i).fill("butter");
    await page.waitForResponse((r) => r.url().includes("/api/search/insect"));
    await page.getByRole("option").filter({ hasText: /butterflies/i }).first().click();
    // Wait for facets to refetch
    await page.waitForResponse((r) => r.url().includes("/api/facets") && r.status() === 200);
    const after = await poolText();
    expect(after).not.toBe(before);
    expect(after).toMatch(/bugs to draw|bugs are waiting/);
  });

  test("WhatIsBugFilter autocomplete shows groups + species", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("combobox", { name: /all bug types/i }).click();
    await page.getByPlaceholder(/type to search bugs/i).fill("but");
    await page.waitForResponse((r) => r.url().includes("/api/search/insect"));
    // Result list should populate with at least one option.
    await expect(page.getByRole("option").first()).toBeVisible();
  });

  test("novelty change updates the pool count number", async ({ page }) => {
    await page.goto("/");
    // Wait for initial facet refresh to settle (SSR uses show-everything;
    // default Phase D mode is never-repeat-animals, so the client fetches
    // /api/facets once on mount to apply the novelty filter to the count).
    await page.waitForResponse((r) => r.url().includes("/api/facets"));
    // Give state a tick to commit.
    await page.waitForTimeout(150);
    const before = await page.locator(".home-pool-count-num").innerText();
    // Click 'include all photos' to flip away from the default "never repeat".
    await page.getByRole("radio", { name: /include all photos/i }).click();
    await page.waitForResponse((r) => r.url().includes("/api/facets"));
    await page.waitForTimeout(150);
    const after = await page.locator(".home-pool-count-num").innerText();
    expect(after).not.toBe(before);
  });

  test("start session and browse gallery look like a paired CTA", async ({ page }) => {
    await page.goto("/");
    const start = page.getByRole("button", { name: /start session/i });
    const gallery = page.getByRole("link", { name: /browse the gallery/i });
    await expect(start).toBeVisible();
    await expect(gallery).toBeVisible();
    // Same height (visual parity)
    const startBox = await start.boundingBox();
    const galleryBox = await gallery.boundingBox();
    expect(Math.abs((startBox?.height ?? 0) - (galleryBox?.height ?? 0))).toBeLessThan(2);
  });

  test("social row has three external links + ethereum copy button", async ({ page }) => {
    await page.goto("/");
    // Three external <a class="home-social-link">
    const anchors = page.locator("a.home-social-link");
    await expect(anchors).toHaveCount(3);
    for (let i = 0; i < 3; i++) {
      await expect(anchors.nth(i)).toHaveAttribute("target", "_blank");
    }
    // Plus one Ethereum copy <button>
    await expect(page.locator("button.home-social-eth")).toBeVisible();
  });
});
