import { test, expect } from "@playwright/test";

const PHONE = { width: 375, height: 812 };

async function getOverflow(page: import("@playwright/test").Page): Promise<number> {
  const html = page.locator("html");
  const box = await html.boundingBox();
  return box ? Math.max(0, box.width - PHONE.width) : 0;
}

test.describe("mobile responsive (375px)", () => {
  test.use({ viewport: PHONE });

  test("home: no horizontal overflow + filter sections visible", async ({ page }) => {
    await page.goto("/");
    expect(await getOverflow(page)).toBeLessThanOrEqual(0);
    await expect(page.getByRole("button", { name: /what kind of bug\?/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /more filters/i })).toBeVisible();
    const subjectGroup = page.getByRole("radiogroup", { name: /subject type/i });
    await expect(subjectGroup.getByRole("radio", { name: "wild" })).toBeVisible();
    await expect(subjectGroup.getByRole("radio", { name: "captive" })).toBeVisible();
    await expect(subjectGroup.getByRole("radio", { name: "specimen" })).toBeVisible();
    await expect(subjectGroup.getByRole("radio", { name: "all" })).toBeVisible();
  });

  test("gallery: no horizontal overflow + subject chips show counts", async ({ page }) => {
    await page.goto("/gallery");
    await page.waitForSelector("#gallery-grid");
    expect(await getOverflow(page)).toBeLessThanOrEqual(0);
    const counts = page.locator(".subject-type-chips .chip .chip-count");
    await expect(counts).toHaveCount(4);
    const texts = await counts.allTextContents();
    for (const t of texts) expect(t).toMatch(/\d/);
  });

  test("session: action bar wraps within viewport width", async ({ page, request }) => {
    const start = await request.post("/api/session/start", {
      data: { intervalSec: 60, subjectType: "all", repeatMode: "default" },
    });
    const { sessionId } = (await start.json()) as { sessionId: string };
    await page.goto(`/session?session=${sessionId}&interval=60`);
    const panel = page.locator(".session-action-bar-panel");
    await panel.waitFor();
    // Force the panel visible — chrome would otherwise auto-hide on no mouse activity.
    await panel.locator("..").evaluate((el: HTMLElement) => {
      el.style.opacity = "1";
      el.style.transform = "translateY(0)";
    });
    const box = await panel.boundingBox();
    expect(box?.width ?? 0).toBeLessThanOrEqual(PHONE.width);
  });
});
