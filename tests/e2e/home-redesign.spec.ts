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
    for (const label of ["all photo types", "all bug types", "all views", "all life stages", "all sexes"]) {
      await expect(page.getByRole("combobox", { name: new RegExp(label, "i") })).toBeVisible();
    }
  });

  test("selecting a bug type narrows the pool count", async ({ page }) => {
    await page.goto("/");
    const poolText = () => page.locator(".home-pool-count").innerText();
    const before = await poolText();
    await page.getByRole("combobox", { name: /all bug types/i }).click();
    await page.getByRole("option", { name: /butterflies/i }).click();
    // Wait for facets to refetch
    await page.waitForResponse((r) => r.url().includes("/api/facets") && r.status() === 200);
    const after = await poolText();
    expect(after).not.toBe(before);
    expect(after).toContain("bugs in your session pool");
  });

  test("novelty change updates the pool count number", async ({ page }) => {
    await page.goto("/");
    const before = await page.locator(".home-pool-count-num").innerText();
    // Click 'never repeat species' radio
    await page.getByRole("radio", { name: /never repeat species/i }).click();
    await page.waitForResponse((r) => r.url().includes("/api/facets"));
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

  test("social row has four links opening in new tabs", async ({ page }) => {
    await page.goto("/");
    const links = page.locator(".home-social-link");
    await expect(links).toHaveCount(4);
    for (let i = 0; i < 4; i++) {
      await expect(links.nth(i)).toHaveAttribute("target", "_blank");
    }
  });
});
