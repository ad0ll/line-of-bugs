import { test, expect } from "@playwright/test";

test("subject chip toggle is URL-synced and pagination resets", async ({ page }) => {
  await page.goto("/gallery?page=3");
  await page.waitForSelector("#gallery-grid");

  // New UI: the subject filter is the `all photo types` summary-chip
  // combobox in FilterChipsControls. AllOrChipsFilter renders a button
  // with role=combobox + aria-label="all photo types" while empty;
  // after a selection the button is replaced by SelectedChips
  // (aria-label="photo type selections").
  await page.getByRole("combobox", { name: /all photo types/i }).click();
  // Option labels include a trailing count ("wild  20"); anchor on the
  // start of the accessible name to disambiguate from other listbox
  // entries in the page.
  await page.getByRole("option", { name: /^wild/i }).first().click();

  await page.waitForURL(/subject=wild/);
  expect(page.url()).not.toMatch(/page=3/);

  // Sanity: at least one tile rendered post-filter.
  await expect(page.locator(".grid-item-image").first()).toBeVisible();

  // Selection surface flipped from the empty combobox to the
  // SelectedChips zone — chip text + remove button confirm state.
  await expect(page.getByLabel(/photo type selections/i)).toBeVisible();
  const removeWild = page.getByRole("button", { name: /remove wild/i });
  await expect(removeWild).toBeVisible();

  // Clear the selection and assert the URL `subject` param is gone.
  await removeWild.click();
  await page.waitForURL((url) => !new URL(url).searchParams.has("subject"));
  await expect(page.getByRole("combobox", { name: /all photo types/i })).toBeVisible();
});

test("institution picker opens and toggles selection", async ({ page }) => {
  await page.goto("/gallery");
  await page.waitForSelector("#gallery-grid");

  // Institutions live in the same FilterChipsControls row as a separate
  // AllOrChipsFilter combobox. The picker is searchable; type a unique
  // substring to surface a deterministic option from the real DB
  // (institution column is a free-form string, but iNaturalist
  // dominates the row counts and is always present).
  await page.getByRole("combobox", { name: /all institutions/i }).click();
  const searchBox = page.getByPlaceholder(/type to filter/i);
  await searchBox.fill("iNaturalist (citizen");

  // The option's accessible name is `<label> <count>`; anchor on the
  // start of the label so the variable count doesn't break the regex.
  const opt = page.getByRole("option", { name: /^iNaturalist \(citizen science\)/i });
  await expect(opt).toBeVisible();
  await opt.click();

  // URL gains ?inst=iNaturalist (citizen science). The router replace
  // form-encodes spaces and parens; normalise via URLSearchParams.
  await page.waitForURL((url) => {
    const params = new URL(url).searchParams;
    return params.get("inst") === "iNaturalist (citizen science)";
  });

  // SelectedChips replaces the empty combobox. A remove button confirms
  // the chip rendered for the picked option.
  await expect(page.getByLabel(/institution selections/i)).toBeVisible();
  await expect(
    page.getByRole("button", { name: /remove iNaturalist \(citizen science\)/i }),
  ).toBeVisible();
});

test("infinite scroll appends a second page of tiles", async ({ page }) => {
  await page.goto("/gallery");
  await page.waitForSelector("#gallery-grid .grid-item");
  const before = await page.locator(".grid-item").count();
  // Scroll to the sentinel — InfiniteScroller fires fetch + appends
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  // Allow time for IntersectionObserver + fetch + render
  await page.waitForFunction(
    (n) => document.querySelectorAll(".grid-item").length > n,
    before,
    { timeout: 5000 },
  );
  const after = await page.locator(".grid-item").count();
  expect(after).toBeGreaterThan(before);
});
