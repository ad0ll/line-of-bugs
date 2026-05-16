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
    // Wait for the species-search XHR rather than guessing the debounce
    // (200 ms in SpeciesAutocomplete + ~10 ms FTS query).
    await page.waitForResponse((r) => r.url().includes('/api/species/search') && r.ok());
    await input.press('Enter');

    await page.waitForURL(/q=bee/);
    const afterCount = await page.locator('.grid-item').count();
    expect(afterCount).toBeLessThan(beforeCount);
  });

  test('result count updates with filter', async ({ page }) => {
    await page.goto('/gallery');
    await page.waitForSelector('.gallery-result-count');
    const before = await page.locator('.gallery-result-count').innerText();

    await page.locator('.subject-type-chips .chip').filter({ hasText: 'specimen' }).first().click();
    await page.waitForURL(/subject=specimen/);
    const after = await page.locator('.gallery-result-count').innerText();
    expect(after).not.toBe(before);
  });
});
