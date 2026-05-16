import { test, expect } from "@playwright/test";

const BASE = "https://line-of-bugs.com";

// Hit production only when explicitly opted-in. Guards against developers
// running `npx playwright test` locally and hammering the live deploy.
test.skip(
  !process.env.PROD_SMOKE,
  "PROD_SMOKE=1 required to run prod-smoke against the live deploy",
);

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

// `session start API returns sessionId` removed — it allocated a server-side
// pool on the live deploy on every CI run, gradually leaking memory until
// the sweeper cleaned it up. The route is covered by the local
// session-start vitest suite.

test("/admin returns 401 unauthorized", async ({ request }) => {
  const res = await request.get("/admin");
  expect(res.status()).toBe(401);
});

test("admin with valid auth returns 200", async ({ request }) => {
  const password = process.env.ADMIN_PASSWORD;
  test.skip(!password, "ADMIN_PASSWORD env var required for this test");
  const creds = Buffer.from(`admin:${password}`).toString("base64");
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

test.skip("CAA records enforce LE", async () => {
  // CAA verification lives out-of-band in deploy/scripts/smoke.sh (which
  // runs `dig CAA line-of-bugs.com`). Playwright can't see DNS records
  // without a custom resolver; skipping in-suite rather than leaving an
  // empty pass that gives false confidence.
});
