import { test, expect } from '@playwright/test';

test.describe('Gallery', () => {
  test('loads the gallery and renders tiles', async ({ page }) => {
    await page.goto('/gallery');
    await page.waitForSelector('#gallery-grid');
    const tiles = page.locator('.grid-item');
    expect(await tiles.count()).toBeGreaterThan(0);
  });

  test('search input narrows results', async ({ page }) => {
    await page.goto('/gallery');
    await page.waitForSelector('#gallery-grid');
    const beforeCount = await page.locator('.grid-item').count();

    const input = page.getByRole('combobox');
    await input.fill('bee');
    await page.waitForTimeout(400);
    await input.press('Enter');

    await page.waitForURL(/q=bee/);
    const afterCount = await page.locator('.grid-item').count();
    expect(afterCount).toBeLessThanOrEqual(beforeCount);
  });

  test('result count updates with filter', async ({ page }) => {
    await page.goto('/gallery');
    await page.waitForSelector('.gallery-result-count');
    const before = await page.locator('.gallery-result-count').innerText();

    await page.getByRole('button', { name: /specimen/i }).click();
    await page.waitForURL(/subject=specimen/);
    const after = await page.locator('.gallery-result-count').innerText();
    expect(after).not.toBe(before);
  });
});
