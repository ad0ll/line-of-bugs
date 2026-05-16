import { test, expect } from "@playwright/test";

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

// Skip cleanly when the credential isn't supplied. Older revisions threw at
// import time which made the test runner crash before reporting other suites.
test.beforeAll(() => {
  test.skip(!ADMIN_PASSWORD, "ADMIN_PASSWORD env var required for admin-resolve e2e");
  // Reset tile counter so re-running the suite within a single process (e.g.
  // `playwright test --repeat-each`) doesn't drift off the end of the grid.
  tileIdx = 0;
});

test.use({ httpCredentials: { username: "admin", password: ADMIN_PASSWORD ?? "" } });

// Serial because each test reports + resolves its own image; running parallel
// produces tile-pick collisions and shared gallery state.
test.describe.configure({ mode: "serial" });

let tileIdx = 0;

async function seedReport(page: import("@playwright/test").Page): Promise<string> {
  // submitReport rate-limits per-IP to 1 / 10 s. Stamp a unique X-Forwarded-For
  // per test invocation so serial tests don't trip the limit on each other.
  const idx = tileIdx++;
  await page.setExtraHTTPHeaders({ "x-forwarded-for": `10.0.0.${idx + 1}` });
  await page.goto("/gallery");
  // Wait for a real tile (skeleton tiles share `.grid-item` but lack data-id;
  // in headless mode they paint first and racing them lands /report/null).
  await page.waitForSelector(".grid-item[data-id]");
  const imageId = (await page.locator(".grid-item[data-id]").nth(idx).getAttribute("data-id"))!;
  await page.goto(`/report/${imageId}`);
  await page.getByRole("button", { name: /^cropped$/i }).click();
  await page.getByRole("button", { name: /^submit$/i }).click();
  await page.waitForURL("/");
  return imageId;
}

test("Dismiss removes the card and re-shows the image in gallery", async ({ page }) => {
  const imageId = await seedReport(page);
  await page.goto("/admin/reports");
  const card = page.locator(".report-card", { hasText: imageId });
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: /^dismiss$/i }).click();
  await expect(card).toHaveCount(0, { timeout: 5000 });
});

test("Hide image keeps the image absent from gallery", async ({ page }) => {
  const imageId = await seedReport(page);
  await page.goto("/admin/reports");
  const card = page.locator(".report-card", { hasText: imageId });
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: /^hide image$/i }).click();
  await expect(card).toHaveCount(0);
});

test("Delete needs two clicks; image vanishes from gallery", async ({ page }) => {
  const imageId = await seedReport(page);
  await page.goto("/admin/reports");
  const card = page.locator(".report-card", { hasText: imageId });
  await expect(card).toBeVisible();

  await card.getByRole("button", { name: /^delete$/i }).click();
  await expect(card.getByRole("button", { name: /confirm delete/i })).toBeVisible();
  await card.getByRole("button", { name: /confirm delete/i }).click();
  await expect(card).toHaveCount(0);
});
