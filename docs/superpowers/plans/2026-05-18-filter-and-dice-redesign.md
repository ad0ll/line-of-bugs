# Filter chip + DiceRoll redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the gallery filter row at a single line regardless of how many "what bug" selections exist; fix the broken-feeling DiceRoll (style, copy, animation, clear-then-roll behavior); apply three copy renames. See spec at `docs/superpowers/specs/2026-05-18-filter-and-dice-redesign-design.md`.

**Architecture:** `WhatIsBugFilter` becomes a single summary chip; its selections live inside the picker (above the search + candidate list). `/api/search/insect` returns the all-groups list when `q` is empty so the picker shows candidates on open. `DiceRoll` swaps the sparkle SVG for a Phosphor dice icon, switches to a tumble + sparkle-burst animation, clears all 7 filter axes before applying its random subset, and applies the swap immediately (animation plays alongside, not as a gate).

**Tech Stack:** Next.js 16 App Router (React 19, TypeScript), Drizzle ORM + better-sqlite3, Vitest browser tests via `vitest-browser-react`, Playwright e2e, Phosphor Icons (MIT) served as static SVG from `public/icons/phosphor/`.

**Project conventions (MUST follow):**
- Commit: `git commit --no-gpg-sign --only -- <files>` per CLAUDE.md (multiple agents in the tree).
- Never `git add -A` / `git add .` — name files explicitly.
- Run `git status` and `git diff --cached` before each commit to confirm only intended files are staged.
- No raw SQL on the live DB (not relevant in this plan — no schema changes).
- Out-of-scope: `scripts/detect_subjects/` — don't touch.

---

## File Structure

**Modify:**
- `app/api/search/insect/route.ts` — return all groups (count desc) on empty `q`.
- `app/components/filters/WhatIsBugFilter.tsx` — single summary chip; selections zone in picker.
- `app/components/filters/WhatIsBugFilter.module.css` — selections zone styles.
- `app/components/filters/DiceRoll.tsx` — Phosphor dice icon, "roll" copy, 5 sparkle `<span>` children, clear-then-roll behavior, immediate apply.
- `app/components/home/HomeClient.tsx` — remove DiceRoll; rename `what is bug?` → `what bug`; rename empty-state copy.
- `app/gallery/_components/FilterChipsControls.tsx` — adapt `applyDiceRoll` to clear all 7 axes before applying.
- `app/gallery/_components/GalleryGrid.tsx` — empty-state copy rename.
- `app/gallery/_components/InfiniteScroller.tsx` — end-marker copy rename.
- `app/globals.css` — `.dice-roll` border + animation keyframes; remove `.home-filter-row-trailing`.
- `tests/api/search-insect.test.ts` — replace the "empty returns []" test.
- `tests/components/WhatIsBugFilter.test.tsx` — add default-candidates + summary-chip + selections-zone tests.
- `tests/components/DiceRoll.test.tsx` — update aria-label and behavior tests.

**Create:**
- `public/icons/phosphor/dice-five-duotone.svg` — Phosphor icon asset.
- `tests/e2e/gallery-filter-chips.spec.ts` — single-line row regression + selections.
- `tests/e2e/gallery-dice.spec.ts` — dice clears + applies on gallery.
- `tests/e2e/home-no-dice.spec.ts` — regression guard: home has no dice.

---

## Task 1: Backend — `/api/search/insect` returns all groups on empty `q`

**Files:**
- Modify: `app/api/search/insect/route.ts:16-19`
- Test:   `tests/api/search-insect.test.ts:36-39`

- [ ] **Step 1: Update the failing test**

Replace the existing "empty query" test in `tests/api/search-insect.test.ts`:

```ts
it("empty query returns all groups sorted by count desc", async () => {
  const data = await call("");
  expect(data.results.length).toBeGreaterThan(0);
  // Every result is a group (no species without a search query)
  expect(data.results.every((r) => r.kind === "group")).toBe(true);
  // Counts are sorted desc
  for (let i = 1; i < data.results.length; i++) {
    expect(data.results[i]!.count).toBeLessThanOrEqual(data.results[i - 1]!.count);
  }
  // The "butterflies" group should be in the list with a positive count
  // (fixture seeds plenty of butterfly rows)
  const butterflies = data.results.find((r) => r.value === "butterflies");
  expect(butterflies).toBeDefined();
  expect(butterflies!.count).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run the test and verify it fails**

```
npx vitest run --project node tests/api/search-insect.test.ts
```

Expected: FAIL with `expect(data.results.length).toBeGreaterThan(0)` because the route still returns `{ results: [] }`.

- [ ] **Step 3: Implement the empty-q branch**

In `app/api/search/insect/route.ts`, replace lines 18–19:

```ts
const url = new URL(req.url);
const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
if (!q) return Response.json({ results: [] });
```

with:

```ts
const url = new URL(req.url);
const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
if (!q) {
  // Picker default: all groups by count desc — so the dropdown shows
  // candidates as soon as it opens, matching AllOrChipsFilter behavior.
  const groupResults: ResultRow[] = TAXON_GROUPS.map((g) => {
    const counts = db.all<{ c: number }>(sql`
      SELECT COUNT(*) AS c FROM images
      WHERE hidden = 0 AND taxon_subgroup IN (${sql.join(
        g.dbValues.map((v) => sql`${v}`),
        sql`, `,
      )})
    `);
    return {
      kind: "group" as const,
      value: g.key,
      label: g.label,
      count: counts[0]?.c ?? 0,
    };
  }).sort((a, b) => b.count - a.count);
  return Response.json(
    { results: groupResults },
    { headers: { "Cache-Control": "public, max-age=60" } },
  );
}
```

- [ ] **Step 4: Run the test and verify it passes**

```
npx vitest run --project node tests/api/search-insect.test.ts
```

Expected: PASS, all 3 tests green.

- [ ] **Step 5: Commit**

```bash
git -C /Users/adoll/projects/line-of-bugs add \
  app/api/search/insect/route.ts \
  tests/api/search-insect.test.ts
git -C /Users/adoll/projects/line-of-bugs commit --only --no-gpg-sign \
  -m "feat(api/search): empty query returns all groups by count desc" \
  -- app/api/search/insect/route.ts tests/api/search-insect.test.ts
```

---

## Task 2: Asset — Phosphor `dice-five-duotone` SVG

**Files:**
- Create: `public/icons/phosphor/dice-five-duotone.svg`

- [ ] **Step 1: Create the asset directory if missing**

```bash
mkdir -p /Users/adoll/projects/line-of-bugs/public/icons/phosphor
```

- [ ] **Step 2: Fetch the icon from Iconify**

```bash
curl -fSL "https://api.iconify.design/ph/dice-five-duotone.svg" \
  -o /Users/adoll/projects/line-of-bugs/public/icons/phosphor/dice-five-duotone.svg
```

- [ ] **Step 3: Verify the file is a valid SVG**

```bash
head -c 200 /Users/adoll/projects/line-of-bugs/public/icons/phosphor/dice-five-duotone.svg
```

Expected: starts with `<svg ` and includes `xmlns="http://www.w3.org/2000/svg"`. File size should be 0.5–2 KB.

- [ ] **Step 4: Visual smoke check**

Start dev server (if not already running):

```bash
npm --prefix /Users/adoll/projects/line-of-bugs run dev
```

Open `http://localhost:3000/icons/phosphor/dice-five-duotone.svg` in a browser tab. The SVG should render as a dice with 5 dots. Confirm it is monochrome / two-tone (duotone) so the CSS filter chain in Task 5 will tint it cleanly.

- [ ] **Step 5: Commit**

```bash
git -C /Users/adoll/projects/line-of-bugs add public/icons/phosphor/dice-five-duotone.svg
git -C /Users/adoll/projects/line-of-bugs commit --only --no-gpg-sign \
  -m "feat(icons): add Phosphor dice-five-duotone for DiceRoll button" \
  -- public/icons/phosphor/dice-five-duotone.svg
```

---

## Task 3: WhatIsBugFilter — picker shows all-groups on open

**Files:**
- Modify: `app/components/filters/WhatIsBugFilter.tsx:70-81` (the search useEffect)
- Test:   `tests/components/WhatIsBugFilter.test.tsx`

- [ ] **Step 1: Add the failing test**

Append to `tests/components/WhatIsBugFilter.test.tsx` (inside a new `describe` block):

```ts
describe("WhatIsBugFilter picker — default candidates", () => {
  it("opens with the all-groups list pre-populated (no typing required)", async () => {
    const mockResults = [
      { kind: "group" as const, value: "butterflies", label: "butterflies", count: 12330 },
      { kind: "group" as const, value: "moths",       label: "moths",       count: 9872 },
      { kind: "group" as const, value: "beetles",     label: "beetles",     count: 7541 },
    ];
    const originalFetch = global.fetch;
    global.fetch = vi.fn(() =>
      Promise.resolve({ json: () => Promise.resolve({ results: mockResults }) } as Response),
    ) as typeof fetch;

    try {
      const screen = await render(
        <WhatIsBugFilter
          selectedGroups={[]}
          selectedSpecies={[]}
          onGroupsChange={vi.fn()}
          onSpeciesChange={vi.fn()}
        />,
      );
      await screen.getByRole("combobox").click();
      // The 120ms debounce + microtasks → poll up to 500ms.
      await expect.element(screen.getByText(/butterflies/i)).toBeInTheDocument();
      await expect.element(screen.getByText(/moths/i)).toBeInTheDocument();
      await expect.element(screen.getByText(/beetles/i)).toBeInTheDocument();
    } finally {
      global.fetch = originalFetch;
    }
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

```
npx vitest run --project browser tests/components/WhatIsBugFilter.test.tsx
```

Expected: FAIL — "butterflies" text not found because the component's `useEffect` returns early on empty query and never fetches.

- [ ] **Step 3: Drop the early-return; gate fetch on `open`**

Edit `app/components/filters/WhatIsBugFilter.tsx`. Replace lines 70–81 (the search `useEffect`):

```ts
  // Fetch search results, debounced
  useEffect(() => {
    if (!query.trim()) { setResults([]); return; }
    const controller = new AbortController();
    const handle = setTimeout(() => {
      fetch(`/api/search/insect?q=${encodeURIComponent(query)}`, { signal: controller.signal })
        .then((r) => r.json())
        .then((d: { results: SearchResult[] }) => setResults(d.results))
        .catch(() => { /* ignore aborts */ });
    }, 120);
    return () => { clearTimeout(handle); controller.abort(); };
  }, [query]);
```

with:

```ts
  // Fetch search results when the picker is open. Empty query is allowed
  // — the backend returns the all-groups list so the dropdown shows
  // candidates immediately, matching AllOrChipsFilter behavior.
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const handle = setTimeout(() => {
      fetch(`/api/search/insect?q=${encodeURIComponent(query)}`, { signal: controller.signal })
        .then((r) => r.json())
        .then((d: { results: SearchResult[] }) => setResults(d.results))
        .catch(() => { /* ignore aborts */ });
    }, 120);
    return () => { clearTimeout(handle); controller.abort(); };
  }, [query, open]);
```

Also update the picker's empty-result hint (lines 172–173):

```tsx
              {query && results.length === 0 && <li className={styles.empty}>no matches</li>}
              {!query && <li className={styles.empty}>start typing to see suggestions</li>}
```

Replace with:

```tsx
              {results.length === 0 && (
                <li className={styles.empty}>
                  {query ? "no matches" : "loading…"}
                </li>
              )}
```

- [ ] **Step 4: Run the tests and verify they pass**

```
npx vitest run --project browser tests/components/WhatIsBugFilter.test.tsx
```

Expected: PASS — both the new test and the existing two empty-state tests are green.

- [ ] **Step 5: Commit**

```bash
git -C /Users/adoll/projects/line-of-bugs add \
  app/components/filters/WhatIsBugFilter.tsx \
  tests/components/WhatIsBugFilter.test.tsx
git -C /Users/adoll/projects/line-of-bugs commit --only --no-gpg-sign \
  -m "feat(filters): WhatIsBugFilter picker shows all-groups on open" \
  -- app/components/filters/WhatIsBugFilter.tsx tests/components/WhatIsBugFilter.test.tsx
```

---

## Task 4: WhatIsBugFilter — single summary chip + selections inside picker

**Files:**
- Modify: `app/components/filters/WhatIsBugFilter.tsx` (chip + picker JSX)
- Modify: `app/components/filters/WhatIsBugFilter.module.css` (new selections-zone styles)
- Test:   `tests/components/WhatIsBugFilter.test.tsx`

- [ ] **Step 1: Add the failing tests**

Append to `tests/components/WhatIsBugFilter.test.tsx`:

```ts
describe("WhatIsBugFilter summary chip", () => {
  it("renders a single chip with combined count when selections exist", async () => {
    const screen = await render(
      <WhatIsBugFilter
        selectedGroups={["butterflies", "moths"]}
        selectedSpecies={["Monarch"]}
        onGroupsChange={vi.fn()}
        onSpeciesChange={vi.fn()}
      />,
    );
    await expect.element(
      screen.getByRole("combobox", { name: /3 bug types/i }),
    ).toBeInTheDocument();
  });

  it("uses singular wording for exactly one selection", async () => {
    const screen = await render(
      <WhatIsBugFilter
        selectedGroups={["butterflies"]}
        selectedSpecies={[]}
        onGroupsChange={vi.fn()}
        onSpeciesChange={vi.fn()}
      />,
    );
    await expect.element(
      screen.getByRole("combobox", { name: /1 bug type$/i }),
    ).toBeInTheDocument();
  });
});

describe("WhatIsBugFilter picker — selections zone", () => {
  it("shows selected chips inside the picker, removable via ×", async () => {
    const onGroupsChange = vi.fn();
    const onSpeciesChange = vi.fn();
    const screen = await render(
      <WhatIsBugFilter
        selectedGroups={["butterflies", "moths"]}
        selectedSpecies={["Monarch"]}
        onGroupsChange={onGroupsChange}
        onSpeciesChange={onSpeciesChange}
      />,
    );
    await screen.getByRole("combobox").click();
    // Selections zone header
    await expect.element(screen.getByText(/selected \(3\)/i)).toBeInTheDocument();
    // Remove butterflies
    await screen.getByRole("button", { name: /remove butterflies/i }).click();
    expect(onGroupsChange).toHaveBeenCalledWith(["moths"]);
    // Remove Monarch
    await screen.getByRole("button", { name: /remove Monarch/i }).click();
    expect(onSpeciesChange).toHaveBeenCalledWith([]);
  });

  it("does not render the selections zone when nothing is selected", async () => {
    const screen = await render(
      <WhatIsBugFilter
        selectedGroups={[]}
        selectedSpecies={[]}
        onGroupsChange={vi.fn()}
        onSpeciesChange={vi.fn()}
      />,
    );
    await screen.getByRole("combobox").click();
    // No "selected (N)" header
    const screenAll = screen.container.querySelectorAll("*");
    // Quick negative assertion via container query — no element matches
    const hasHeader = Array.from(screenAll).some((el) =>
      /^selected \(/.test(el.textContent ?? ""),
    );
    expect(hasHeader).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests and verify they fail**

```
npx vitest run --project browser tests/components/WhatIsBugFilter.test.tsx
```

Expected: FAIL — the chip currently renders `chipWall` when selections exist (not a combobox with the count); the picker has no selections zone.

- [ ] **Step 3: Rewrite WhatIsBugFilter chip + picker**

Replace the full contents of `app/components/filters/WhatIsBugFilter.tsx` with:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./WhatIsBugFilter.module.css";

function ChevronDown() {
  return (
    <svg
      aria-hidden="true"
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      className={styles.chevron}
    >
      <path d="M2 4l3 3 3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

interface SearchResult {
  kind: "group" | "species";
  value: string;
  label: string;
  count: number;
}

export interface WhatIsBugFilterProps {
  /** Selected taxon-group chip keys (e.g. "butterflies"). */
  selectedGroups: string[];
  /** Selected species tags (booru-style, FTS5 search). */
  selectedSpecies: string[];
  onGroupsChange: (next: string[]) => void;
  onSpeciesChange: (next: string[]) => void;
}

function summaryLabel(groups: string[], species: string[]): string {
  const n = groups.length + species.length;
  if (n === 0) return "all bug types";
  if (n === 1) return "1 bug type";
  return `${n} bug types`;
}

export function WhatIsBugFilter({
  selectedGroups,
  selectedSpecies,
  onGroupsChange,
  onSpeciesChange,
}: WhatIsBugFilterProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  // Lock body scroll on the mobile bottom sheet (audit re-check).
  useEffect(() => {
    if (!open) return;
    if (typeof window === "undefined") return;
    if (!window.matchMedia("(max-width: 640px)").matches) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  // Fetch search results when the picker is open. Empty query is allowed
  // — the backend returns the all-groups list so the dropdown shows
  // candidates immediately, matching AllOrChipsFilter behavior.
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const handle = setTimeout(() => {
      fetch(`/api/search/insect?q=${encodeURIComponent(query)}`, { signal: controller.signal })
        .then((r) => r.json())
        .then((d: { results: SearchResult[] }) => setResults(d.results))
        .catch(() => { /* ignore aborts */ });
    }, 120);
    return () => { clearTimeout(handle); controller.abort(); };
  }, [query, open]);

  const totalSelected = selectedGroups.length + selectedSpecies.length;
  const chipLabel = summaryLabel(selectedGroups, selectedSpecies);

  function pickResult(r: SearchResult) {
    if (r.kind === "group") {
      if (!selectedGroups.includes(r.value)) onGroupsChange([...selectedGroups, r.value]);
    } else {
      if (!selectedSpecies.includes(r.value)) onSpeciesChange([...selectedSpecies, r.value]);
    }
    setQuery("");
    inputRef.current?.focus();
  }

  function removeGroup(v: string) {
    onGroupsChange(selectedGroups.filter((g) => g !== v));
  }
  function removeSpecies(v: string) {
    onSpeciesChange(selectedSpecies.filter((s) => s !== v));
  }

  return (
    <div ref={containerRef} className={styles.wrap}>
      <button
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={chipLabel}
        className={`${styles.chip} ${totalSelected === 0 ? styles.empty : styles.selectedSummary} ${open ? styles.open : ""}`}
        onClick={() => setOpen((o) => !o)}
      >
        {chipLabel}
        <ChevronDown />
      </button>

      {open && (
        <>
          <div className={styles.scrim} onClick={() => setOpen(false)} aria-hidden="true" />
          <div className={styles.picker} role="dialog">
            <div className={styles.sheetHandle} aria-hidden="true" />

            {totalSelected > 0 && (
              <div className={styles.selectionsZone}>
                <div className={styles.selectionsHeader}>selected ({totalSelected})</div>
                <div className={styles.selectionsList}>
                  {selectedGroups.map((g) => (
                    <span key={`g-${g}`} className={`${styles.selectionChip} ${styles.selectedGroup}`}>
                      <span className={styles.kindBadge}>group</span>
                      <span>{g}</span>
                      <button
                        type="button"
                        aria-label={`remove ${g}`}
                        className={styles.removeBtn}
                        onClick={() => removeGroup(g)}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  {selectedSpecies.map((s) => (
                    <span key={`s-${s}`} className={`${styles.selectionChip} ${styles.selectedSpecies}`}>
                      <span className={styles.kindBadge}>species</span>
                      <span>{s}</span>
                      <button
                        type="button"
                        aria-label={`remove ${s}`}
                        className={styles.removeBtn}
                        onClick={() => removeSpecies(s)}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            )}

            <input
              ref={inputRef}
              type="text"
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="type to search bugs…"
              className={styles.search}
              onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}
            />

            <div className={styles.candidatesHeader}>
              {query ? "search results" : "bug types"}
            </div>
            <ul role="listbox" className={styles.list}>
              {results.map((r) => {
                const alreadySelected =
                  (r.kind === "group" && selectedGroups.includes(r.value)) ||
                  (r.kind === "species" && selectedSpecies.includes(r.value));
                if (alreadySelected) return null;
                return (
                  <li
                    key={`${r.kind}-${r.value}`}
                    role="option"
                    aria-selected={false}
                    className={styles.row}
                    onClick={() => pickResult(r)}
                  >
                    <span className={styles.kindBadge}>{r.kind}</span>
                    <span className={styles.rowLabel}>{r.label}</span>
                    <span className={styles.rowCount}>{r.count.toLocaleString()}</span>
                  </li>
                );
              })}
              {results.length === 0 && (
                <li className={styles.empty}>
                  {query ? "no matches" : "loading…"}
                </li>
              )}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
```

Add these new styles to `app/components/filters/WhatIsBugFilter.module.css` (append at the end before the existing media queries, or insert before the `.picker` rule so the cascade order is preserved):

```css
/* New summary-chip state — paint matches .empty visually but the
   border-color is the lilac of a populated selection. Audit re-check
   needed under /audit. */
.chip.selectedSummary {
  background: var(--accent-lilac-soft);
  border-color: var(--accent-lilac-border);
  color: var(--text-primary);
}
.chip.selectedSummary:hover { border-color: var(--accent-lilac); }

/* Selections zone inside the picker — listed above the search input. */
.selectionsZone {
  margin-bottom: var(--s4);
  padding-bottom: var(--s4);
  border-bottom: 1px solid var(--surface-2);
}
.selectionsHeader {
  font-size: var(--text-xs);
  text-transform: lowercase;
  letter-spacing: 0.05em;
  opacity: 0.6;
  margin-bottom: var(--s3);
  font-style: italic;
}
.selectionsList {
  display: flex;
  flex-wrap: wrap;
  gap: var(--s3);
}
.selectionChip {
  display: inline-flex;
  align-items: center;
  gap: var(--s2);
  padding: var(--s2) var(--s5);
  border-radius: var(--r-pill);
  border: 1px solid var(--accent-lilac-border);
  background: var(--accent-lilac-soft);
  color: var(--text-primary);
  font-size: var(--text-sm);
}

.candidatesHeader {
  font-size: var(--text-xs);
  text-transform: lowercase;
  letter-spacing: 0.05em;
  opacity: 0.6;
  margin-top: var(--s4);
  margin-bottom: var(--s3);
  font-style: italic;
}
```

- [ ] **Step 4: Run the tests and verify they pass**

```
npx vitest run --project browser tests/components/WhatIsBugFilter.test.tsx
```

Expected: PASS — all 5 tests green (2 existing empty-state, 1 default-candidates from Task 3, 2 new summary + 1 selections-zone, 1 selections-zone-absent).

Also run the home redesign e2e to confirm nothing already-passing is broken (this is a quick check; full e2e in Task 9):

```
npx playwright test --grep "WhatIsBugFilter autocomplete"
```

Expected: PASS (test should still work because typing "but" still returns results).

- [ ] **Step 5: Commit**

```bash
git -C /Users/adoll/projects/line-of-bugs add \
  app/components/filters/WhatIsBugFilter.tsx \
  app/components/filters/WhatIsBugFilter.module.css \
  tests/components/WhatIsBugFilter.test.tsx
git -C /Users/adoll/projects/line-of-bugs commit --only --no-gpg-sign \
  -m "feat(filters): WhatIsBugFilter summary chip + selections inside picker

Replaces the in-row chip-wall (which broke the gallery filter row layout
when 7+ selections existed) with a single summary chip; selections now
live inside the picker as removable chips above the search input.
Mirrors AllOrChipsFilter's open-and-see-everything rhythm." \
  -- app/components/filters/WhatIsBugFilter.tsx \
     app/components/filters/WhatIsBugFilter.module.css \
     tests/components/WhatIsBugFilter.test.tsx
```

---

## Task 5: DiceRoll — visual rewrite (icon + copy + chip style + animation)

**Files:**
- Modify: `app/components/filters/DiceRoll.tsx` (icon, copy, sparkle spans)
- Modify: `app/globals.css:672-715` (border, animation keyframes)
- Test:   `tests/components/DiceRoll.test.tsx:14-17` (aria-label match)

- [ ] **Step 1: Update existing tests to match new copy**

In `tests/components/DiceRoll.test.tsx`, change line 16:

```ts
    await expect.element(screen.getByRole("button", { name: /surprise me/i })).toBeInTheDocument();
```

to:

```ts
    await expect.element(screen.getByRole("button", { name: /^roll$/i })).toBeInTheDocument();
```

Also add a new test for the dice icon presence:

```ts
  it("renders a dice icon (img) inside the button", async () => {
    const screen = await render(<DiceRoll onRoll={() => {}} />);
    const btn = screen.getByRole("button");
    const img = btn.element().querySelector("img");
    expect(img).not.toBeNull();
    expect(img!.getAttribute("src")).toBe("/icons/phosphor/dice-five-duotone.svg");
  });
```

- [ ] **Step 2: Run the tests and verify the rendering tests fail**

```
npx vitest run --project browser tests/components/DiceRoll.test.tsx
```

Expected: 2 FAILs (the renamed aria-label test, and the new img test). The behavior tests (`is-rolling` class, `onRoll` after 500ms, no double-fire) still pass — those are addressed in Task 6.

- [ ] **Step 3: Rewrite the DiceRoll component visual**

Replace `app/components/filters/DiceRoll.tsx` rendering. The behavior section (the `roll` function) stays untouched in this task — Task 6 changes that. Replace the JSX return block:

Current (lines 60–78):

```tsx
  return (
    <button
      type="button"
      className={`dice-roll ${rolling ? "is-rolling" : ""} ${className ?? ""}`.trim()}
      onClick={roll}
      aria-label="surprise me — pick random filters"
      title="surprise me"
    >
      <span aria-hidden className="dice-roll-sparkle">
        {/* Pink 4-point sparkle — fits the pastel palette where the Fluent
            dice emoji clashed (red dots + white face). Phase F adjustment. */}
        <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
          <path d="M8 0 L9.5 6.5 L16 8 L9.5 9.5 L8 16 L6.5 9.5 L0 8 L6.5 6.5 Z" />
        </svg>
      </span>
      <span className="dice-roll-label">surprise me</span>
    </button>
  );
```

Replace with:

```tsx
  return (
    <button
      type="button"
      className={`dice-roll ${rolling ? "is-rolling" : ""} ${className ?? ""}`.trim()}
      onClick={roll}
      aria-label="roll"
      title="roll — clear and reroll filters"
    >
      <img
        src="/icons/phosphor/dice-five-duotone.svg"
        alt=""
        aria-hidden="true"
        width={18}
        height={18}
        draggable={false}
        decoding="async"
        className="dice-roll-icon"
      />
      <span className="dice-roll-label">roll</span>
      {/* 5 sparkles burst outward when .is-rolling is applied. Each
          is positioned absolutely and rotated to its angle; CSS handles
          the staggered keyframes. Render unconditionally so the
          animation has DOM nodes to animate without a remount. */}
      <span aria-hidden="true" className="dice-roll-spark dice-roll-spark--0" />
      <span aria-hidden="true" className="dice-roll-spark dice-roll-spark--1" />
      <span aria-hidden="true" className="dice-roll-spark dice-roll-spark--2" />
      <span aria-hidden="true" className="dice-roll-spark dice-roll-spark--3" />
      <span aria-hidden="true" className="dice-roll-spark dice-roll-spark--4" />
    </button>
  );
```

- [ ] **Step 4: Update the `.dice-roll` CSS in `app/globals.css`**

Replace lines 672–715 (the entire `/* Phase F (2026-05-17) — dice-roll … */` block through the `@media (prefers-reduced-motion: reduce)` block) with:

```css
/* 2026-05-18 — DiceRoll redesigned. Solid pink-soft border (matches
   the empty AllOrChipsFilter chip), pink-tinted Phosphor dice icon,
   tumble + sparkle-burst animation. Behavior: clears all 7 filter
   axes then applies a random subset immediately; the animation plays
   alongside, not as a gate. */
.dice-roll {
  position: relative;           /* anchor for absolute .dice-roll-spark */
  appearance: none;
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  background: color-mix(in srgb, var(--accent-pink) 12%, transparent);
  border: 1px solid var(--accent-pink-border);
  border-radius: 999px;
  padding: 0.5rem 0.9rem;
  color: var(--accent-pink);
  font-family: var(--font-display), serif;
  font-style: italic;
  font-size: 0.9rem;
  line-height: 1;
  cursor: pointer;
  overflow: visible;            /* sparkles escape the pill */
  transition: transform 200ms cubic-bezier(0.22, 1, 0.36, 1),
              box-shadow 200ms cubic-bezier(0.22, 1, 0.36, 1),
              background 200ms cubic-bezier(0.22, 1, 0.36, 1);
}
.dice-roll:hover {
  transform: translateY(-1px);
  background: color-mix(in srgb, var(--accent-pink) 22%, transparent);
  box-shadow: 0 0 18px color-mix(in srgb, var(--accent-pink) 45%, transparent);
}

/* Tint the monochrome Phosphor SVG to --accent-pink via the same CSS
   filter chain the gallery butterfly uses. */
.dice-roll-icon {
  display: inline-block;
  flex-shrink: 0;
  vertical-align: middle;
  filter: brightness(0) saturate(100%) invert(60%) sepia(70%) saturate(2000%) hue-rotate(290deg) brightness(105%) contrast(95%);
  transition: transform 400ms cubic-bezier(0.22, 1, 0.36, 1);
}
.dice-roll.is-rolling .dice-roll-icon {
  animation: diceWobble 400ms cubic-bezier(0.22, 1, 0.36, 1);
}
@keyframes diceWobble {
  0%   { transform: rotate(0deg); }
  20%  { transform: rotate(15deg); }
  40%  { transform: rotate(-15deg); }
  60%  { transform: rotate(15deg); }
  80%  { transform: rotate(-15deg); }
  100% { transform: rotate(0deg); }
}

/* Sparkle burst — 5 pink 4-point stars radiating outward. Each rotated
   to its own angle; CSS handles the radial translation via CSS custom
   property --angle so we can share one @keyframes rule. */
.dice-roll-spark {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 10px;
  height: 10px;
  margin-left: -5px;
  margin-top: -5px;
  pointer-events: none;
  opacity: 0;
  background-color: var(--accent-pink);
  /* 4-point star — same shape as the previous inline sparkle SVG */
  -webkit-mask: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><path d='M8 0 L9.5 6.5 L16 8 L9.5 9.5 L8 16 L6.5 9.5 L0 8 L6.5 6.5 Z'/></svg>") center / contain no-repeat;
          mask: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><path d='M8 0 L9.5 6.5 L16 8 L9.5 9.5 L8 16 L6.5 9.5 L0 8 L6.5 6.5 Z'/></svg>") center / contain no-repeat;
}
.dice-roll-spark--0 { --angle:   0deg; }
.dice-roll-spark--1 { --angle:  72deg; }
.dice-roll-spark--2 { --angle: 144deg; }
.dice-roll-spark--3 { --angle: 216deg; }
.dice-roll-spark--4 { --angle: 288deg; }

.dice-roll.is-rolling .dice-roll-spark {
  animation: sparkBurst 400ms cubic-bezier(0.22, 1, 0.36, 1) both;
}
.dice-roll.is-rolling .dice-roll-spark--0 { animation-delay: 200ms; }
.dice-roll.is-rolling .dice-roll-spark--1 { animation-delay: 240ms; }
.dice-roll.is-rolling .dice-roll-spark--2 { animation-delay: 280ms; }
.dice-roll.is-rolling .dice-roll-spark--3 { animation-delay: 320ms; }
.dice-roll.is-rolling .dice-roll-spark--4 { animation-delay: 360ms; }

@keyframes sparkBurst {
  0%   { transform: rotate(var(--angle)) translateY(0)     scale(0); opacity: 0; }
  30%  { transform: rotate(var(--angle)) translateY(-22px) scale(1.2); opacity: 1; }
  100% { transform: rotate(var(--angle)) translateY(-40px) scale(0); opacity: 0; }
}

.dice-roll.is-rolling {
  background: color-mix(in srgb, var(--accent-pink) 22%, transparent);
}

@media (prefers-reduced-motion: reduce) {
  .dice-roll.is-rolling .dice-roll-icon,
  .dice-roll.is-rolling .dice-roll-spark {
    animation: none;
  }
}
```

- [ ] **Step 5: Run the tests and verify all 5 pass**

```
npx vitest run --project browser tests/components/DiceRoll.test.tsx
```

Expected: PASS — the renamed aria-label, the new img test, and the three existing behavior tests are all green.

Visual smoke check: open `http://localhost:3000/gallery`, click the `roll` chip, watch for the dice icon wobbling and 5 pink sparkles bursting outward. Note: filter clear-and-apply still uses the Phase F additive behavior; Task 6 fixes that.

- [ ] **Step 6: Commit**

```bash
git -C /Users/adoll/projects/line-of-bugs add \
  app/components/filters/DiceRoll.tsx \
  app/globals.css \
  tests/components/DiceRoll.test.tsx
git -C /Users/adoll/projects/line-of-bugs commit --only --no-gpg-sign \
  -m "feat(dice): Phosphor dice icon + 'roll' copy + tumble & sparkle burst" \
  -- app/components/filters/DiceRoll.tsx app/globals.css tests/components/DiceRoll.test.tsx
```

---

## Task 6: DiceRoll — clear-then-roll behavior + immediate apply

**Files:**
- Modify: `app/components/filters/DiceRoll.tsx` (DiceRollState shape, roll() function)
- Modify: `app/gallery/_components/FilterChipsControls.tsx` (onDiceRoll wiring)
- Test:   `tests/components/DiceRoll.test.tsx`

- [ ] **Step 1: Update behavior tests**

Replace the second and third test in `tests/components/DiceRoll.test.tsx` (the `onRoll` after 500ms and the no-double-fire tests) with:

```ts
  it("invokes onRoll immediately with a clear-then-roll state shape", async () => {
    const onRoll = vi.fn();
    vi.spyOn(Math, "random").mockReturnValue(0.05);
    const screen = await render(<DiceRoll onRoll={onRoll} />);
    await screen.getByRole("button").click();
    // onRoll fires synchronously; no 500ms gate.
    expect(onRoll).toHaveBeenCalledTimes(1);
    const arg = onRoll.mock.calls[0]![0];
    // Every axis is present — cleared axes are [], rolled axes are non-empty.
    expect(arg).toHaveProperty("groups");
    expect(arg).toHaveProperty("species");
    expect(arg).toHaveProperty("views");
    expect(arg).toHaveProperty("lifeStages");
    expect(arg).toHaveProperty("sexes");
    expect(arg).toHaveProperty("subjects");
    expect(arg).toHaveProperty("insts");
    // species / sexes / insts are always cleared.
    expect(arg.species).toEqual([]);
    expect(arg.sexes).toEqual([]);
    expect(arg.insts).toEqual([]);
    // With Math.random = 0.05, all rollable axes are populated.
    expect(arg.groups.length).toBeGreaterThan(0);
    expect(arg.views.length).toBe(1);
    expect(arg.lifeStages.length).toBe(1);
    expect(arg.subjects.length).toBe(1);
  });

  it("with Math.random=0.99 every rollable axis is empty (just a clear)", async () => {
    const onRoll = vi.fn();
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    const screen = await render(<DiceRoll onRoll={onRoll} />);
    await screen.getByRole("button").click();
    expect(onRoll).toHaveBeenCalledTimes(1);
    const arg = onRoll.mock.calls[0]![0];
    expect(arg.groups).toEqual([]);
    expect(arg.views).toEqual([]);
    expect(arg.lifeStages).toEqual([]);
    expect(arg.subjects).toEqual([]);
  });

  it("ignores a second click while .is-rolling is active", async () => {
    const onRoll = vi.fn();
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    const screen = await render(<DiceRoll onRoll={onRoll} />);
    const btn = screen.getByRole("button");
    await btn.click();
    await btn.click();
    expect(onRoll).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(600);
  });

  it("adds .is-rolling at t=0 and removes it after 600ms", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    const screen = await render(<DiceRoll onRoll={() => {}} />);
    const btn = screen.getByRole("button");
    await btn.click();
    expect((btn.element() as HTMLElement).classList.contains("is-rolling")).toBe(true);
    vi.advanceTimersByTime(600);
    expect((btn.element() as HTMLElement).classList.contains("is-rolling")).toBe(false);
  });
```

- [ ] **Step 2: Run the tests and verify they fail**

```
npx vitest run --project browser tests/components/DiceRoll.test.tsx
```

Expected: FAIL — the current `roll` function fires `onRoll` after 500ms (not immediately) and produces an additive `DiceRollState` (absent keys → leave alone) rather than every-axis-present.

- [ ] **Step 3: Rewrite the DiceRoll state shape + roll function**

In `app/components/filters/DiceRoll.tsx`, replace lines 13–18 (the `DiceRollState` interface):

```ts
export interface DiceRollState {
  groups?: string[];
  views?: string[];
  lifeStages?: string[];
  subjects?: string[];
}
```

with:

```ts
/**
 * Every axis is always present. Cleared axes are `[]`; rolled axes are
 * non-empty. The parent's `onRoll` wires each axis directly into its
 * setter, so every roll starts from a clean slate (filters reset) and
 * lands on the random subset.
 */
export interface DiceRollState {
  groups: string[];
  species: string[];
  views: string[];
  lifeStages: string[];
  sexes: string[];
  subjects: string[];
  insts: string[];
}
```

Replace the `roll` function (lines 47–59):

```tsx
  function roll() {
    if (rolling) return;
    setRolling(true);
    const state: DiceRollState = {};
    if (Math.random() < 0.6) state.groups = pick(GROUPS_POOL, 1 + Math.floor(Math.random() * 3));
    if (Math.random() < 0.5) state.views = pick(["dorsal", "lateral", "ventral", "head"], 1);
    if (Math.random() < 0.3) state.lifeStages = pick(["adult", "larva", "nymph"], 1);
    if (Math.random() < 0.2) state.subjects = pick(["wild", "specimen", "captive"], 1);
    setTimeout(() => {
      setRolling(false);
      onRoll(state);
    }, 500);
  }
```

with:

```tsx
  function roll() {
    if (rolling) return;
    setRolling(true);
    // Every axis is present. Default: cleared ([]). Apply each random
    // pick with the Phase F probabilities. Species / sexes / institutions
    // are not currently rollable axes, so they are always cleared.
    const state: DiceRollState = {
      groups: [],
      species: [],
      views: [],
      lifeStages: [],
      sexes: [],
      subjects: [],
      insts: [],
    };
    if (Math.random() < 0.6) {
      state.groups = pick(GROUPS_POOL, 1 + Math.floor(Math.random() * 3));
    }
    if (Math.random() < 0.5) {
      state.views = pick(["dorsal", "lateral", "ventral", "head"], 1);
    }
    if (Math.random() < 0.3) {
      state.lifeStages = pick(["adult", "larva", "nymph"], 1);
    }
    if (Math.random() < 0.2) {
      state.subjects = pick(["wild", "specimen", "captive"], 1);
    }
    // Apply immediately — URL updates at t=0 so facets/grid start
    // loading right away while the animation plays alongside.
    onRoll(state);
    setTimeout(() => setRolling(false), 600);
  }
```

- [ ] **Step 4: Update the gallery wiring in `FilterChipsControls.tsx`**

In `app/gallery/_components/FilterChipsControls.tsx`, replace the `onDiceRoll` function (lines 95–100):

```tsx
  function onDiceRoll(state: DiceRollState) {
    if (state.groups !== undefined) setGroups(state.groups);
    if (state.views !== undefined) setViews(state.views);
    if (state.lifeStages !== undefined) setLife(state.lifeStages);
    if (state.subjects !== undefined) setSubjects(state.subjects);
  }
```

with:

```tsx
  function onDiceRoll(state: DiceRollState) {
    // Every axis is present (cleared ones are []); apply each directly.
    setGroups(state.groups);
    setSpecies(state.species);
    setViews(state.views);
    setLife(state.lifeStages);
    setSexes(state.sexes);
    setSubjects(state.subjects);
    setInsts(state.insts);
  }
```

- [ ] **Step 5: Run tests and verify all 6 pass**

```
npx vitest run --project browser tests/components/DiceRoll.test.tsx
```

Expected: PASS — img-test from Task 5 still green, plus 4 new behavior tests + the unchanged aria-label test = 6 passes.

Also typecheck:

```
npx tsc --noEmit
```

Expected: no errors — the `DiceRollState` shape changed but the only caller is `FilterChipsControls.tsx` (home's `applyDiceRoll` will be removed in Task 7).

- [ ] **Step 6: Commit**

```bash
git -C /Users/adoll/projects/line-of-bugs add \
  app/components/filters/DiceRoll.tsx \
  app/gallery/_components/FilterChipsControls.tsx \
  tests/components/DiceRoll.test.tsx
git -C /Users/adoll/projects/line-of-bugs commit --only --no-gpg-sign \
  -m "feat(dice): clear-all-axes-then-roll with immediate apply

Every roll starts from a clean slate: groups, species, views, life
stages, sexes, subjects, institutions are all reset to [] before the
random subset (60/50/30/20 probabilities) is applied. onRoll fires
synchronously; the 600ms timer now only governs the animation class." \
  -- app/components/filters/DiceRoll.tsx \
     app/gallery/_components/FilterChipsControls.tsx \
     tests/components/DiceRoll.test.tsx
```

---

## Task 7: Remove DiceRoll from HomeClient + clean dead CSS

**Files:**
- Modify: `app/components/home/HomeClient.tsx` (remove DiceRoll import + JSX + applyDiceRoll)
- Modify: `app/globals.css` (remove `.home-filter-row-trailing` block)

- [ ] **Step 1: Add an e2e regression guard test (failing first)**

Create `tests/e2e/home-no-dice.spec.ts`:

```ts
import { test, expect } from "@playwright/test";

test.describe("home — no DiceRoll", () => {
  test("home page renders no .dice-roll button", async ({ page }) => {
    await page.goto("/");
    // Wait for the filter section to be visible so we know rendering is done
    await expect(page.getByRole("combobox", { name: /all bug types/i })).toBeVisible();
    // Regression guard: dice lives on /gallery only.
    expect(await page.locator(".dice-roll").count()).toBe(0);
  });
});
```

- [ ] **Step 2: Run the spec to verify it currently fails**

```
npx playwright test tests/e2e/home-no-dice.spec.ts
```

Expected: FAIL — there's a `.dice-roll` element on home (Phase F left it in the trailing slot of the "what bug" row).

- [ ] **Step 3: Remove DiceRoll from HomeClient**

In `app/components/home/HomeClient.tsx`:

1. Remove the `DiceRoll`, `DiceRollState` imports (line 12):

```tsx
import { DiceRoll, type DiceRollState } from "@/app/components/filters/DiceRoll";
```

Delete this line entirely.

2. Replace the "what bug" FilterRow (lines 176–186):

```tsx
              <FilterRow
                label="what is bug?"
                trailing={<DiceRoll onRoll={(s) => applyDiceRoll(s, { setGroups, setViews, setLife, setSubjects })} />}
              >
                <WhatIsBugFilter
                  selectedGroups={groups}
                  selectedSpecies={species}
                  onGroupsChange={setGroups}
                  onSpeciesChange={setSpecies}
                />
              </FilterRow>
```

with:

```tsx
              <FilterRow label="what bug">
                <WhatIsBugFilter
                  selectedGroups={groups}
                  selectedSpecies={species}
                  onGroupsChange={setGroups}
                  onSpeciesChange={setSpecies}
                />
              </FilterRow>
```

(Note: the label rename from `what is bug?` → `what bug` is one of the four copy renames in Task 8 — applied here as part of removing the trailing slot since both touch the same JSX block.)

3. Remove the `applyDiceRoll` function (lines 280–298) and the `FilterRow.trailing` prop (line 270):

Replace the `FilterRow` component definition (lines 270–278):

```tsx
function FilterRow({ label, children, trailing }: { label: string; children: React.ReactNode; trailing?: React.ReactNode }) {
  return (
    <div className="home-filter-row">
      <span className="home-filter-row-label">{label}</span>
      <div className="home-filter-row-control">{children}</div>
      {trailing ? <div className="home-filter-row-trailing">{trailing}</div> : null}
    </div>
  );
}
```

with:

```tsx
function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="home-filter-row">
      <span className="home-filter-row-label">{label}</span>
      <div className="home-filter-row-control">{children}</div>
    </div>
  );
}
```

Delete the `applyDiceRoll` function entirely (lines 280–298 before the change, now renumbered).

- [ ] **Step 4: Remove the dead `.home-filter-row-trailing` CSS**

In `app/globals.css`, delete the block at lines 1371–1377:

```css
/* Phase F (2026-05-17) — trailing slot for the dice-roll button next to
   the "what is bug?" row, also used for any future row-level affordance. */
.home-filter-row-trailing {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
}
```

- [ ] **Step 5: Run all checks**

```
npx tsc --noEmit
npx playwright test tests/e2e/home-no-dice.spec.ts
```

Expected: tsc clean; new e2e test PASSES.

Also run the home redesign suite to confirm no regression:

```
npx playwright test tests/e2e/home-redesign.spec.ts
```

Expected: all previously-passing tests still pass. The label rename from `what is bug?` → `what bug` may break tests that depend on the literal string — fix them in Task 8.

- [ ] **Step 6: Commit**

```bash
git -C /Users/adoll/projects/line-of-bugs add \
  app/components/home/HomeClient.tsx \
  app/globals.css \
  tests/e2e/home-no-dice.spec.ts
git -C /Users/adoll/projects/line-of-bugs commit --only --no-gpg-sign \
  -m "feat(home): drop DiceRoll from home + clean .home-filter-row-trailing

DiceRoll is gallery-only per the 2026-05-18 spec. Also renames the
filter row label 'what is bug?' to 'what bug' (one of the copy renames
batched here because it lives in the same JSX block being edited)." \
  -- app/components/home/HomeClient.tsx \
     app/globals.css \
     tests/e2e/home-no-dice.spec.ts
```

---

## Task 8: Copy renames (3 remaining strings)

**Files:**
- Modify: `app/components/home/HomeClient.tsx:232` (empty-state copy)
- Modify: `app/gallery/_components/GalleryGrid.tsx:29` (empty-state copy)
- Modify: `app/gallery/_components/InfiniteScroller.tsx:113` (end-marker copy)

(The `what bug` rename was applied in Task 7 since it lived in the same JSX block.)

- [ ] **Step 1: Update each string**

In `app/components/home/HomeClient.tsx` line 232:

```tsx
              <WiltedFlower size={22} /> no insects match — try broadening the filters
```

→

```tsx
              <WiltedFlower size={22} /> no bugs found with those filters
```

In `app/gallery/_components/GalleryGrid.tsx` line 29:

```tsx
        <p className="gallery-empty-title">no insects match — try broadening the filters</p>
```

→

```tsx
        <p className="gallery-empty-title">no bugs found with those filters</p>
```

In `app/gallery/_components/InfiniteScroller.tsx` line 113:

```tsx
        <p className="gallery-end-marker">✿ that&apos;s every bug</p>
```

→

```tsx
        <p className="gallery-end-marker">✿ no more bugs</p>
```

- [ ] **Step 2: Update tests that reference the old copy**

Grep for the old strings:

```
git -C /Users/adoll/projects/line-of-bugs grep -n "that's every bug\|no insects match\|what is bug?"
```

Update any test file (`tests/**`) and e2e spec (`tests/e2e/**`) that asserts the old copy. Common locations: `tests/e2e/home-redesign.spec.ts`, `tests/e2e/gallery-filter.spec.ts`, `tests/e2e/round4-filters.spec.ts`.

For each match, replace the literal string per the rename table:
- `that's every bug` → `no more bugs`
- `no insects match — try broadening the filters` → `no bugs found with those filters`
- `what is bug?` → `what bug`

- [ ] **Step 3: Run the affected test files to verify they pass**

```
npx playwright test tests/e2e/home-redesign.spec.ts
npx playwright test tests/e2e/gallery-filter.spec.ts
```

Expected: PASS — all tests green with the new copy.

If `home-redesign.spec.ts` test 2 ("filter rows render with all-or-chips empty state") asserts that `what bug` row label is visible, you may need to update the regex inside the test loop. The current loop iterates the empty-chip labels (`all bug types`, etc.) which are unchanged — only the row label `what is bug?` was renamed, and that label is rendered by `FilterRow`, not by the combobox. A grep for `what is bug` in tests will catch any remaining references.

- [ ] **Step 4: Final tsc + unit suite sweep**

```
npx tsc --noEmit
npx vitest run
```

Expected: clean tsc; all unit tests pass.

- [ ] **Step 5: Commit**

```bash
git -C /Users/adoll/projects/line-of-bugs add \
  app/components/home/HomeClient.tsx \
  app/gallery/_components/GalleryGrid.tsx \
  app/gallery/_components/InfiniteScroller.tsx \
  $(git -C /Users/adoll/projects/line-of-bugs grep -l "no bugs found with those filters\|no more bugs" tests/ 2>/dev/null | tr '\n' ' ')
git -C /Users/adoll/projects/line-of-bugs status --short
git -C /Users/adoll/projects/line-of-bugs commit --only --no-gpg-sign \
  -m "chore(copy): empty-state and end-marker rewrites

- 'no insects match — try broadening the filters' → 'no bugs found
  with those filters' (home + gallery empty states)
- 'that's every bug' → 'no more bugs' (gallery infinite scroller end)" \
  -- $(git -C /Users/adoll/projects/line-of-bugs diff --cached --name-only | tr '\n' ' ')
```

(The `git diff --cached --name-only` resolves to the actual staged file list so the `--only` constraint is correct even if test files were edited.)

---

## Task 9: E2E — gallery filter chip + dice regressions

**Files:**
- Create: `tests/e2e/gallery-filter-chips.spec.ts`
- Create: `tests/e2e/gallery-dice.spec.ts`

- [ ] **Step 1: Write `gallery-filter-chips.spec.ts`**

Create `tests/e2e/gallery-filter-chips.spec.ts`:

```ts
import { test, expect } from "@playwright/test";

test.describe("gallery filter chips — single-line row regression", () => {
  test("selecting multiple bug types keeps the filter row at one line", async ({ page }) => {
    await page.goto("/gallery");
    // Open the "what bug" picker and select 3 groups
    await page.getByRole("combobox", { name: /all bug types/i }).click();
    // Wait for the default-groups list to render
    await page.waitForResponse((r) => r.url().includes("/api/search/insect"));
    for (const group of ["butterflies", "moths", "beetles"]) {
      await page.getByRole("option").filter({ hasText: new RegExp(`^${group}`, "i") }).first().click();
    }
    // Close the picker
    await page.keyboard.press("Escape");

    // Chip text reflects 3 selections
    await expect(page.getByRole("combobox", { name: /3 bug types/i })).toBeVisible();

    // Filter row should remain visually a single line.
    const rowBox = await page.locator(".gallery-filter-row").boundingBox();
    expect(rowBox).not.toBeNull();
    expect(rowBox!.height).toBeLessThanOrEqual(80);
  });

  test("selections zone inside picker lists removable chips", async ({ page }) => {
    await page.goto("/gallery?type=butterflies%2Cmoths");
    await page.getByRole("combobox", { name: /2 bug types/i }).click();
    await expect(page.getByText(/^selected \(2\)$/i)).toBeVisible();
    await page.getByRole("button", { name: /remove butterflies/i }).click();
    // Combobox count updates
    await expect(page.getByRole("combobox", { name: /1 bug type/i })).toBeVisible();
  });
});
```

- [ ] **Step 2: Write `gallery-dice.spec.ts`**

Create `tests/e2e/gallery-dice.spec.ts`:

```ts
import { test, expect } from "@playwright/test";

test.describe("gallery dice — clear-then-roll", () => {
  test("clicking 'roll' clears existing filters and applies a random subset", async ({ page }) => {
    // Pre-load with filters set via URL params
    await page.goto("/gallery?view=dorsal&life=adult&sex=female&inst=USNM");

    // Sanity check the chips are populated
    await expect(page.getByRole("combobox", { name: /1 bug type|all bug types/i })).toBeVisible();

    // Click the dice
    await page.locator(".dice-roll").click();

    // Wait for the URL to settle (give the router a tick + facets refetch)
    await page.waitForLoadState("networkidle");

    // Every preset filter param should be gone
    const url = new URL(page.url());
    expect(url.searchParams.get("inst")).toBeNull();
    expect(url.searchParams.get("sex")).toBeNull();
    // view and life may or may not be present depending on the random
    // roll — assert they are NOT the preset values
    expect(url.searchParams.get("view")).not.toBe("dorsal");
    expect(url.searchParams.get("life")).not.toBe("adult");

    // At least one tile rendered after the roll
    await expect(page.locator(".grid-item-image").first()).toBeVisible();
  });
});
```

- [ ] **Step 3: Run both e2e specs**

```
npx playwright test tests/e2e/gallery-filter-chips.spec.ts tests/e2e/gallery-dice.spec.ts
```

Expected: PASS on both. If `gallery-dice` flakes because the random roll happens to pick `view=dorsal` again, the assertions on `.not.toBe(...)` would mis-fire — re-run; the odds are low (1/4 × 0.5 = 0.125 for view to be picked at all, then 1/4 to match). If consistently flaky, switch to checking against the literal pre-roll URL string rather than per-param.

- [ ] **Step 4: Commit**

```bash
git -C /Users/adoll/projects/line-of-bugs add \
  tests/e2e/gallery-filter-chips.spec.ts \
  tests/e2e/gallery-dice.spec.ts
git -C /Users/adoll/projects/line-of-bugs commit --only --no-gpg-sign \
  -m "test(e2e): gallery filter chips single-line + dice clear-then-roll" \
  -- tests/e2e/gallery-filter-chips.spec.ts tests/e2e/gallery-dice.spec.ts
```

---

## Task 10: Final verification

No code changes — just running the suite end-to-end before handoff.

- [ ] **Step 1: TypeScript check**

```
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 2: Full unit test suite (both projects)**

```
npx vitest run
```

Expected: all node + browser tests pass. Watch for the search-insect, WhatIsBugFilter, DiceRoll, and any HomeClient.poolCopy tests.

- [ ] **Step 3: Build**

```
npm --prefix /Users/adoll/projects/line-of-bugs run build
```

Expected: build succeeds with no type errors, no missing imports (the removed `DiceRoll` import in HomeClient is gone).

- [ ] **Step 4: Smoke e2e — Phase F regressions still pass**

```
npx playwright test tests/e2e/home-redesign.spec.ts tests/e2e/session.spec.ts tests/e2e/gallery-filter.spec.ts
```

Expected: all green. The pool-count test, novelty test, and start-session test should be unaffected by this work.

- [ ] **Step 5: Visual smoke check (Claude responsibility)**

Open `http://localhost:3000/gallery` and:

1. Click `all bug types ▾` — picker opens with 10 group options visible immediately (no typing needed). ✓
2. Select 4 groups + 3 species (use search to find species). ✓
3. Confirm the gallery filter row stays single-line; chip reads `7 bug types`. ✓
4. Reopen the picker; confirm selections zone lists all 7 with `×` buttons. ✓
5. Remove 1 species via `×`; chip updates to `6 bug types`. ✓
6. Click `roll` — dice icon wobbles, 5 pink sparkles burst outward, all 7 filter axes clear, a fresh random subset applies. ✓
7. Open `http://localhost:3000/` — confirm no `.dice-roll` chip is present on home; the "what bug" row label reads `what bug` (not `what is bug?`). ✓

If any step fails or feels off, stop and re-investigate — do not declare done.

- [ ] **Step 6: No commit (verification-only task).**

---

## Spec coverage cross-check

| Spec requirement | Task(s) |
|---|---|
| Chip stays single-cell wide on selection | 4 |
| Chip shows count when selected | 4 |
| Picker selections zone (top) | 4 |
| Picker default candidates on open | 1 + 3 |
| Picker placeholder `type to search bugs…` | 4 (inside rewrite) |
| Mobile sheet still works | 4 (unchanged sheet CSS path) |
| Backend `/api/search/insect` empty-q | 1 |
| Phosphor dice icon | 2 + 5 |
| Solid pink-soft border (drop dashed) | 5 |
| Copy `roll` | 5 |
| Clear all 7 filter axes on click | 6 |
| Apply immediately (no setTimeout gate) | 6 |
| Tumble + sparkle burst animation | 5 |
| `prefers-reduced-motion` skip | 5 |
| Remove DiceRoll from home | 7 |
| Remove `.home-filter-row-trailing` | 7 |
| Copy renames (4 strings) | 7 (one) + 8 (three) |
| Unit tests: WhatIsBugFilter default + summary + selections | 3 + 4 |
| Unit tests: DiceRoll clear + immediate + roll class | 6 |
| E2E: filter row single-line | 9 |
| E2E: dice clear + apply | 9 |
| E2E: no dice on home | 7 |
| `/audit` follow-up | (out of scope — deferred) |
