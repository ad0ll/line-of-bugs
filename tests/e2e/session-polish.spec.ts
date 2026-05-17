import { test, expect } from "@playwright/test";

test.describe("session player polish (Phase B)", () => {
  async function startSession(page: import("@playwright/test").Page) {
    const res = await page.request.post("http://localhost:3000/api/session/start", {
      data: {
        intervalSec: 60,
        subjectType: "all",
        repeatMode: "default",
        views: [],
        lifeStages: [],
        sexes: [],
        groups: [],
        q: [],
      },
    });
    const json = await res.json();
    return json.sessionId as string;
  }

  test("action bar buttons share width", async ({ page }) => {
    const sessionId = await startSession(page);
    await page.goto(`/session?session=${sessionId}&interval=60`);
    // Bump chrome by mousemove
    await page.mouse.move(400, 400);
    await page.mouse.move(720, 450);
    const buttons = page.locator(".session-action-bar-panel .u-icon-btn-stacked");
    await expect(buttons.first()).toBeVisible();
    const count = await buttons.count();
    expect(count).toBeGreaterThanOrEqual(7);
    const widths: number[] = [];
    for (let i = 0; i < count; i++) {
      const box = await buttons.nth(i).boundingBox();
      if (box) widths.push(box.width);
    }
    const max = Math.max(...widths);
    const min = Math.min(...widths);
    expect(max - min).toBeLessThanOrEqual(1.5);
  });

  test("source button is a link without underline", async ({ page }) => {
    const sessionId = await startSession(page);
    await page.goto(`/session?session=${sessionId}&interval=60`);
    await page.mouse.move(400, 400);
    await page.mouse.move(720, 450);
    const source = page.locator(".session-action-bar-panel a.u-icon-btn-stacked");
    await expect(source).toBeVisible();
    const td = await source.evaluate((el) => getComputedStyle(el).textDecorationLine);
    expect(td).toBe("none");
  });

  test("mobile tap pauses; second tap unpauses", async ({ browser }) => {
    // Force a mobile-like context with touch enabled
    const ctx = await browser.newContext({
      viewport: { width: 414, height: 896 },
      hasTouch: true,
      isMobile: true,
    });
    const page = await ctx.newPage();
    const res = await page.request.post("http://localhost:3000/api/session/start", {
      data: { intervalSec: 60, subjectType: "all", repeatMode: "default", views: [], lifeStages: [], sexes: [], groups: [], q: [] },
    });
    const sessionId = (await res.json()).sessionId;
    await page.goto(`/session?session=${sessionId}&interval=60`);
    // Tap in image area (avoid action bar at bottom)
    await page.touchscreen.tap(207, 300);
    await expect(page.locator(".session-paused-overlay")).toBeVisible();
    await page.touchscreen.tap(207, 300);
    await expect(page.locator(".session-paused-overlay")).toHaveCount(0);
    await ctx.close();
  });

  test("muting via keyboard M persists across reload and surfaces the timer icon", async ({ page }) => {
    const sessionId = await startSession(page);
    await page.goto(`/session?session=${sessionId}&interval=60`);
    // No muted icon by default
    await expect(page.locator(".session-timer-muted-icon")).toHaveCount(0);
    // Toggle mute via keyboard
    await page.keyboard.press("m");
    await expect(page.locator(".session-timer-muted-icon")).toBeVisible();
    // Reload and verify the state persists from localStorage
    await page.reload();
    await expect(page.locator(".session-timer-muted-icon")).toBeVisible();
    // Toggle back off and confirm icon vanishes
    await page.keyboard.press("m");
    await expect(page.locator(".session-timer-muted-icon")).toHaveCount(0);
  });

  test("session state resets when starting a new session", async ({ page }) => {
    // Start session 1
    let res = await page.request.post("http://localhost:3000/api/session/start", {
      data: { intervalSec: 60, subjectType: "all", repeatMode: "default", views: [], lifeStages: [], sexes: [], groups: [], q: [] },
    });
    const s1 = (await res.json()).sessionId;
    await page.goto(`/session?session=${s1}&interval=60`);
    // Toggle B&W via keyboard
    await page.keyboard.press("b");
    let bw = await page.locator(".session-image-frame img").evaluate((el) => getComputedStyle(el).filter);
    expect(bw).toContain("grayscale");
    // Start session 2
    await page.goto("/");
    res = await page.request.post("http://localhost:3000/api/session/start", {
      data: { intervalSec: 60, subjectType: "all", repeatMode: "default", views: [], lifeStages: [], sexes: [], groups: [], q: [] },
    });
    const s2 = (await res.json()).sessionId;
    await page.goto(`/session?session=${s2}&interval=60`);
    // B&W should be off
    bw = await page.locator(".session-image-frame img").evaluate((el) => getComputedStyle(el).filter);
    expect(bw).not.toContain("grayscale");
  });
});
