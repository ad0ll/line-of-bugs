import { test, expect, request as pwRequest } from "@playwright/test";

test("GET /admin/reports without auth returns 401", async () => {
  const api = await pwRequest.newContext({ baseURL: "http://localhost:3000" });
  const res = await api.get("/admin/reports");
  expect(res.status()).toBe(401);
  expect(res.headers()["www-authenticate"]).toContain("Basic");
});

test("GET /admin/reports with wrong credentials returns 401", async () => {
  const api = await pwRequest.newContext({
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    httpCredentials: { username: "admin", password: "wrong" },
  });
  const res = await api.get("/admin/reports");
  expect(res.status()).toBe(401);
});

test("GET /admin/reports with valid credentials returns 200", async () => {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) {
    throw new Error("ADMIN_PASSWORD env var is required for this test (no default — that would be a security smell)");
  }
  const api = await pwRequest.newContext({
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    httpCredentials: { username: "admin", password },
  });
  const res = await api.get("/admin/reports");
  expect(res.status()).toBe(200);
});

test("no nav link to /admin exists from public pages", async ({ page }) => {
  await page.goto("/");
  expect(await page.locator('a[href*="/admin"]').count()).toBe(0);
  await page.goto("/gallery");
  expect(await page.locator('a[href*="/admin"]').count()).toBe(0);
});

test("robots.txt disallows /admin", async ({ page }) => {
  await page.goto("/robots.txt");
  const text = await page.textContent("body");
  expect(text).toContain("Disallow: /admin/");
});
