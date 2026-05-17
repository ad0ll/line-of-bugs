import { test, expect } from "@playwright/test";

test("sketchfab panel opens, shows thumbnails, click opens new tab, timer pauses", async ({
  page,
  context,
}) => {
  // Stub the API to avoid hitting Sketchfab live in CI.
  await page.route("**/api/sketchfab/search*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        rawHadResults: true,
        hits: [
          {
            uid: "test-uid",
            name: "Stubbed Bee Model",
            author: "Test Author",
            authorUsername: "testauthor",
            thumbnailUrl:
              "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='256' height='144'><rect width='256' height='144' fill='%23333'/></svg>",
            viewerUrl: "https://sketchfab.com/3d-models/test-uid",
            licenseSlug: "by",
            matchedBy: "scientific",
          },
        ],
      }),
    }),
  );

  // Navigate from home → session
  await page.goto("/");
  await page.getByRole("button", { name: "30s" }).click();
  await page.getByRole("button", { name: /start session/i }).click();
  await page.waitForURL(/\/session\?session=/);
  // Session renders the bug photo via /api/medium/ (1024px JPEG q88).
  await page.waitForSelector('img[src*="/api/medium/"]');

  const timer = page.getByTestId("session-timer");
  // Capture initial timer text (e.g. "00:30")
  const beforeText = await timer.textContent();
  expect(beforeText).toMatch(/\d\d:\d\d/);

  // Open Sketchfab panel via the IconBtn (label="sketchfab")
  await page.getByRole("button", { name: /sketchfab/i }).click();
  await expect(page.getByRole("dialog", { name: /sketchfab models/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /Stubbed Bee Model/ })).toBeVisible();

  // Timer should be unchanged after 2 seconds (panel pauses it)
  await page.waitForTimeout(2000);
  const afterText = await timer.textContent();
  expect(afterText).toBe(beforeText);

  // Clicking a thumbnail opens a new tab to sketchfab.com
  const [popup] = await Promise.all([
    context.waitForEvent("page"),
    page.getByRole("link", { name: /Stubbed Bee Model/ }).click(),
  ]);
  expect(popup.url()).toContain("sketchfab.com/3d-models/test-uid");
  await popup.close();

  // Capture the session URL before Escape — the regression we're
  // guarding against here is SessionPlayer's Escape handler
  // router.push("/")-ing the user out of the session when the panel
  // is open. The panel should close, but the session URL must NOT
  // change. (Pre-fix, both happened: panel closed AND we left.)
  const sessionUrl = page.url();
  expect(sessionUrl).toMatch(/\/session\?session=/);

  // Closing the panel resumes the timer.
  // SketchfabBrowsePanel attaches its Escape handler via
  // `document.addEventListener("keydown", ...)`, so dispatching on
  // `document` (not `window`) is what reliably triggers it under the
  // Playwright protocol quirk that drops `keyboard.press("Escape")`
  // on Firefox + WebKit. Chromium also accepts this path.
  await page.evaluate(() => {
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );
  });
  await expect(page.getByRole("dialog", { name: /sketchfab models/i })).toBeHidden();
  // URL must be unchanged — Escape closed the panel, not the session.
  expect(page.url()).toBe(sessionUrl);

  // Wait briefly for the timer to advance after resume
  await page.waitForTimeout(1500);
  const resumedText = await timer.textContent();
  expect(resumedText).not.toBe(afterText);
});
