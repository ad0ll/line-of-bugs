import { test, expect } from "@playwright/test";

test.describe("R7 dynamic chip counts", () => {
  test("home: selecting captive shows filtered/total on taxon chips", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /what kind of bug/i }).click();

    const butterflies = page
      .locator(".taxon-group-chip")
      .filter({ hasText: "butterflies" });
    const baseline = await butterflies.locator(".chip-count").innerText();

    // Switch subject filter to captive.
    const subjectGroup = page.getByRole("radiogroup", { name: /subject type/i });
    await subjectGroup.getByRole("radio", { name: "captive" }).click();

    // Wait for the facets fetch to land.
    await page.waitForFunction((seed: string) => {
      const el = document.querySelector(".taxon-group-chip");
      // Find the butterflies chip (first chip is butterflies in our taxon order)
      const chip = Array.from(document.querySelectorAll(".taxon-group-chip"))
        .find((c) => c.textContent?.includes("butterflies"));
      const txt = chip?.querySelector(".chip-count")?.textContent ?? "";
      return el !== null && txt !== seed && /\//.test(txt);
    }, baseline);

    // Butterflies chip should now show a filtered/total display.
    await expect(butterflies.locator(".chip-count-total")).toBeVisible();
  });

  test("home: selecting butterflies leaves cockroach count UNCHANGED (own-axis exclusion)", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /what kind of bug/i }).click();

    const cockroach = page
      .locator(".taxon-group-chip")
      .filter({ hasText: "cockroaches" });
    const before = await cockroach.locator(".chip-count").innerText();

    // Capture the pool-count text BEFORE the click so we can wait
    // for it to change. Previously we matched against a hardcoded
    // "2,855" which broke every time the fixture grew.
    const poolCountBefore =
      (await page.locator(".home-pool-count").innerText()) ?? "";

    // Click butterflies — own axis, shouldn't change cockroach.
    await page
      .locator(".taxon-group-chip")
      .filter({ hasText: "butterflies" })
      .click();

    // Wait for the URL update + a real pool-count change so we know
    // the facets fetch landed. Any non-trivial change to the label
    // text indicates the new filter has been applied.
    await page.waitForURL(/type=butterflies/);
    await page.waitForFunction(
      (prev: string) => {
        const txt =
          document.querySelector(".home-pool-count")?.textContent ?? "";
        return txt.length > 0 && txt !== prev;
      },
      poolCountBefore,
    );
    await expect(cockroach.locator(".chip-count")).toHaveText(before);
  });

  test("gallery: subject=captive narrows taxon counts on next page render", async ({ page }) => {
    await page.goto("/gallery?subject=captive");
    await page.getByRole("button", { name: /what kind of bug/i }).click();
    const butterflies = page
      .locator(".taxon-group-chip")
      .filter({ hasText: "butterflies" });
    // Captive butterflies are a small subset; the chip shows filtered/total.
    await expect(butterflies.locator(".chip-count-total")).toBeVisible();
  });
});
