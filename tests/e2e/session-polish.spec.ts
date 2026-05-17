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
});
