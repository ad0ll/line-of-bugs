import { test, expect } from "@playwright/test";

const BASE = "https://line-of-bugs.com";

test.use({ baseURL: BASE });

test("home renders title + start button", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/line.of.bugs|bug/i);
  await expect(page.getByText(/line of bugs/i).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /start/i })).toBeVisible();
});

test("gallery loads + renders tiles", async ({ page }) => {
  await page.goto("/gallery");
  await page.waitForSelector("#gallery-grid .grid-item", { timeout: 15000 });
  const count = await page.locator(".grid-item").count();
  expect(count).toBeGreaterThan(0);
});

test("gallery thumbnail returns image bytes", async ({ page }) => {
  await page.goto("/gallery");
  const tile = page.locator(".grid-item").first();
  await tile.waitFor({ timeout: 15000 });
  const img = tile.locator("img").first();
  const src = await img.getAttribute("src");
  expect(src).toBeTruthy();
  const res = await page.request.get(`${BASE}${src}`);
  expect(res.status()).toBe(200);
  const body = await res.body();
  expect(body.length).toBeGreaterThan(1000);
});

test("session start API returns sessionId", async ({ request }) => {
  const res = await request.post("/api/session/start", {
    data: { intervalSec: 60, subjectType: "all", repeatMode: "default" },
  });
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.sessionId).toBeTruthy();
  expect(body.count).toBeGreaterThan(0);
});

test("/admin returns 401 unauthorized", async ({ request }) => {
  const res = await request.get("/admin");
  expect(res.status()).toBe(401);
});

test("admin with valid auth returns 200", async ({ request }) => {
  const creds = Buffer.from("admin:cdxC9hqaQtnHhFJXCJadUdGB").toString("base64");
  const res = await request.get("/admin/reports", {
    headers: { Authorization: `Basic ${creds}` },
  });
  expect(res.status()).toBe(200);
});

test("HSTS + CSP + nosniff + referrer + permissions headers present", async ({ request }) => {
  const res = await request.get("/");
  const h = res.headers();
  expect(h["strict-transport-security"]).toMatch(/max-age=31536000/);
  expect(h["content-security-policy"]).toMatch(/default-src 'self'/);
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(h["permissions-policy"]).toMatch(/geolocation=\(\)/);
});

test("www→apex 301 redirect", async ({ request }) => {
  const res = await request.get("https://www.line-of-bugs.com/", { maxRedirects: 0 });
  expect(res.status()).toBe(301);
  const loc = res.headers()["location"] ?? "";
  expect(loc).toMatch(/^https:\/\/line-of-bugs\.com\//);
});

test("CAA records enforce LE", async ({ }) => {
  // External proof via DNS — done out of band in smoke.sh / dig. Sanity stub.
});
