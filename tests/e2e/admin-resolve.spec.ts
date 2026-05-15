import { test, expect } from "@playwright/test";

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!ADMIN_PASSWORD) {
  throw new Error("ADMIN_PASSWORD env var is required for admin-resolve e2e (no default — security smell)");
}

test.use({ httpCredentials: { username: "admin", password: ADMIN_PASSWORD } });

// Serial because each test reports + resolves its own image; running parallel
// produces tile-pick collisions and shared gallery state.
test.describe.configure({ mode: "serial" });

let tileIdx = 0;

async function seedReport(page: import("@playwright/test").Page): Promise<string> {
  await page.goto("/gallery");
  await page.waitForSelector(".grid-item");
  // Pick a unique tile per test so we don't collide with previously-hidden images
  const idx = tileIdx++;
  const imageId = (await page.locator(".grid-item").nth(idx).getAttribute("data-id"))!;
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
  await expect(card.getByRole("button", { name: /are you sure/i })).toBeVisible();
  await card.getByRole("button", { name: /are you sure/i }).click();
  await expect(card).toHaveCount(0);
});
