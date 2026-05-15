import { test, expect } from "@playwright/test";

test("home page renders with dark theme", async ({ page }) => {
  await page.goto("/");
  const bg = await page.evaluate(() =>
    window.getComputedStyle(document.body).backgroundColor,
  );
  expect(bg).toBe("rgb(13, 12, 16)"); // #0d0c10
  await expect(page.locator("h1")).toContainText("line of bugs");
});

test("thumb route returns JPEG with cache headers", async ({ request }) => {
  const KNOWN_THUMB = "0001028_bugwood_nature_saddleback-caterpillar.jpg";
  const res = await request.get(`/api/thumb/${KNOWN_THUMB}`);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toBe("image/jpeg");
  expect(res.headers()["cache-control"]).toContain("immutable");
});

test("img route returns 404 for missing file", async ({ request }) => {
  const res = await request.get("/api/img/nope-not-here.jpg");
  expect(res.status()).toBe(404);
});
