# Design Pass v2 — Phase C: Gallery Rewrite

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Port the home page's filter pattern to the gallery (horizontal), collapse order-only iNat IDs on tiles, drop the duplicate taxon-group chip, add cute icon + skeleton-shimmer loading + sad-bug empty state, then delete the now-orphaned filter components.

**Architecture:** Replace the gallery's `FilterChipsBar` / `FilterChipsControls` with a horizontal row of `AllOrChipsFilter`s (the component shipped in Phase A). Tile-level visual polish via `GridTile` + CSS. Final cleanup deletes `FilterBar.tsx`, `FilterPopover.tsx`, `TaxonGroupChips.tsx` now that nobody imports them.

**Tech Stack:** Next.js 16, React 19, TypeScript, existing `AllOrChipsFilter` + `GridTile`.

**Spec:** `docs/superpowers/specs/2026-05-16-design-pass-v2-design.md` (Gallery section)

---

## File Structure

**Modified**
- `app/gallery/page.tsx` — uses new filter row, passes facet snapshot
- `app/gallery/_components/FilterChipsBar.tsx` — replaced by `GalleryFilterRow` (or rewrite in place)
- `app/gallery/_components/FilterChipsControls.tsx` — replaced by URL-write wrapper around `AllOrChipsFilter` rows
- `app/gallery/_components/GridTile.tsx` — order-only-ID display, drop taxon chip, hover glow
- `app/gallery/loading.tsx` — skeleton-tile shimmer
- `app/globals.css` — gallery filter row layout, skeleton shimmer keyframes, tile hover

**Deleted**
- `app/components/filters/FilterBar.tsx` (orphaned after Phase C)
- `app/components/filters/FilterPopover.tsx` (orphaned after Phase C)
- `app/components/filters/TaxonGroupChips.tsx` (orphaned after Phase C)

---

## Task 1: Gallery filter row — horizontal AllOrChipsFilter

**Files:**
- Modify: `app/gallery/_components/FilterChipsControls.tsx` — rewrite as horizontal row of AllOrChipsFilter
- Modify: `app/gallery/_components/FilterChipsBar.tsx` — pass facet data to new control
- Modify: `app/gallery/page.tsx` — ensure facet snapshot reaches the row
- Modify: `app/globals.css` — `.gallery-filter-row` horizontal layout

- [ ] **Step 1: Read existing gallery filter code**

Read `app/gallery/_components/FilterChipsBar.tsx` and `FilterChipsControls.tsx` to understand current data flow. The bar is a server component that loads facets; controls is a client component that writes URL state.

- [ ] **Step 2: Rewrite FilterChipsControls to use AllOrChipsFilter**

Replace `app/gallery/_components/FilterChipsControls.tsx` with a horizontal-row variant. Mirror the home page's pattern:

```tsx
"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { AllOrChipsFilter, type AllOrChipsOption } from "@/app/components/filters/AllOrChipsFilter";
import { SpeciesAutocomplete } from "@/app/gallery/_components/SpeciesAutocomplete";
import type { FacetCount, FacetSnapshot } from "@/lib/queries/facets";
import type { SubjectType } from "@/lib/subject";

interface Props {
  initialSubject: SubjectType;
  initialFacets: FacetSnapshot;
  // institutions are gallery-only and loaded SSR (large enum; we don't
  // recompute counts per filter — see gallery/page.tsx)
  institutionOptions: AllOrChipsOption[];
}

function asOptions(items: FacetCount[]): AllOrChipsOption[] {
  return items.map((i) => ({ value: i.name, label: i.name, count: i.count }));
}

function parseList(v: string | null): string[] {
  return v ? v.split(",").filter(Boolean) : [];
}

const SUBJECT_BASE = [
  { value: "wild", label: "wild" },
  { value: "specimen", label: "specimen" },
  { value: "captive", label: "captive" },
];

export function FilterChipsControls({ initialSubject, initialFacets, institutionOptions }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [, startTransition] = useTransition();

  const initialSubjectList = initialSubject === "all" ? [] : [initialSubject];
  const [subjects, setSubjects] = useState<string[]>(initialSubjectList);
  const [groups, setGroups] = useState<string[]>(parseList(params.get("type")));
  const [views, setViews] = useState<string[]>(parseList(params.get("view")));
  const [life, setLife] = useState<string[]>(parseList(params.get("life")));
  const [sexes, setSexes] = useState<string[]>(parseList(params.get("sex")));
  const [insts, setInsts] = useState<string[]>(parseList(params.get("inst")));
  const [species, setSpecies] = useState<string[]>(parseList(params.get("q")));

  // Live facet refresh — same pattern as home
  const [facets, setFacets] = useState<FacetSnapshot>(initialFacets);

  useEffect(() => {
    const next = new URLSearchParams();
    if (subjects.length === 1) next.set("subject", subjects[0]!);
    if (groups.length) next.set("type", groups.join(","));
    if (views.length) next.set("view", views.join(","));
    if (life.length) next.set("life", life.join(","));
    if (sexes.length) next.set("sex", sexes.join(","));
    if (insts.length) next.set("inst", insts.join(","));
    if (species.length) next.set("q", species.join(","));
    const qs = next.toString();
    const target = qs ? `${pathname}?${qs}` : pathname;
    startTransition(() => router.replace(target, { scroll: false }));
  }, [subjects, groups, views, life, sexes, insts, species, pathname, router]);

  // Refetch facets on filter change
  useEffect(() => {
    const q = new URLSearchParams();
    q.set("subject", subjects.length === 1 ? subjects[0]! : "all");
    if (views.length) q.set("view", views.join(","));
    if (life.length) q.set("life", life.join(","));
    if (sexes.length) q.set("sex", sexes.join(","));
    if (groups.length) q.set("type", groups.join(","));
    if (insts.length) q.set("inst", insts.join(","));
    if (species.length) q.set("q", species.join(","));
    const controller = new AbortController();
    const handle = setTimeout(() => {
      fetch(`/api/facets?${q.toString()}`, { signal: controller.signal })
        .then((r) => r.json())
        .then((d: FacetSnapshot) => setFacets(d))
        .catch(() => { /* leave last-known facets */ });
    }, 80);
    return () => { clearTimeout(handle); controller.abort(); };
  }, [subjects, groups, views, life, sexes, insts, species]);

  const subjectOpts: AllOrChipsOption[] = SUBJECT_BASE.map((s) => ({
    ...s,
    count: facets.subject[s.value as "wild" | "specimen" | "captive"] ?? 0,
  }));

  function addSpecies(t: string) { if (!species.includes(t)) setSpecies([...species, t]); }
  function removeSpecies(t: string) { setSpecies(species.filter((s) => s !== t)); }

  return (
    <div className="gallery-filter-row">
      <AllOrChipsFilter
        label="photo type"
        emptyLabel="all photo types"
        options={subjectOpts}
        selected={subjects}
        onChange={setSubjects}
      />
      <AllOrChipsFilter
        label="bug type"
        emptyLabel="all bug types"
        options={asOptions(facets.taxonGroups)}
        selected={groups}
        onChange={setGroups}
      />
      <AllOrChipsFilter
        label="view"
        emptyLabel="all views"
        options={asOptions(facets.views)}
        selected={views}
        onChange={setViews}
      />
      <AllOrChipsFilter
        label="life stage"
        emptyLabel="all life stages"
        options={asOptions(facets.lifeStages)}
        selected={life}
        onChange={setLife}
      />
      <AllOrChipsFilter
        label="sex"
        emptyLabel="all sexes"
        options={asOptions(facets.sexes)}
        selected={sexes}
        onChange={setSexes}
      />
      <AllOrChipsFilter
        label="institution"
        emptyLabel="all institutions"
        options={institutionOptions}
        selected={insts}
        onChange={setInsts}
      />
      <div className="gallery-filter-row-species">
        <SpeciesAutocomplete selected={species} onAdd={addSpecies} onRemove={removeSpecies} />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Update FilterChipsBar to pass institution data**

Edit `app/gallery/_components/FilterChipsBar.tsx` to:
- Keep its SSR facet fetch
- Pass `institutionOptions` (loaded via existing `listInstitutions()` query) into `FilterChipsControls`

The exact diff depends on the current shape — keep the surrounding logic; only the prop passing changes.

- [ ] **Step 4: Add CSS for the horizontal row**

Append to `app/globals.css`:

```css
.gallery-filter-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.6rem 0.75rem;
  padding: 0.75rem 0;
  margin-bottom: 1rem;
}
.gallery-filter-row-species {
  flex: 1 1 18rem;
  min-width: 16rem;
}
@media (max-width: 720px) {
  .gallery-filter-row {
    flex-direction: column;
    align-items: stretch;
  }
  .gallery-filter-row-species { flex: none; }
}
```

- [ ] **Step 5: tsc + tests**

Run:
```bash
npx tsc --noEmit && npx vitest run --reporter=default
```
Expected: clean, 149+ tests pass.

- [ ] **Step 6: Commit**

```bash
git add app/gallery/_components/FilterChipsControls.tsx app/gallery/_components/FilterChipsBar.tsx app/globals.css
git commit --no-gpg-sign -m "feat(gallery): horizontal AllOrChipsFilter row replaces FilterChipsBar stack"
```

---

## Task 2: GridTile — order-only-ID + drop taxon chip + hover glow

**Files:**
- Modify: `app/gallery/_components/GridTile.tsx`
- Modify: `app/globals.css`
- Test: existing GridTile tests if any (read `tests/components/GridTile.test.tsx`); add cases for order-only

- [ ] **Step 1: Read GridTile + write failing test for order-only display**

Inspect `app/gallery/_components/GridTile.tsx` — typically renders thumbnail + common name + scientific name + taxon-group chip.

Add (or extend) `tests/components/GridTile.test.tsx`:

```tsx
it("collapses order-only iNat IDs and drops the taxon-group chip", async () => {
  const row = {
    image_id: "test-id",
    thumbnail_filename: "x.jpg",
    common_name: "butterflies, moths or skippers",
    taxon_species: "Lepidoptera",
    taxon_order: "Lepidoptera",
    taxon_subgroup: "moth",
    width: 1024, height: 768,
  };
  const screen = await render(<GridTile row={row as any} />);
  await expect.element(screen.getByText(/Butterflies, Moths Or Skippers/i)).toBeInTheDocument();
  await expect.element(screen.getByText(/\(order\)/i)).toBeInTheDocument();
  // No scientific repeat, no taxon-group chip
  const sci = screen.container().querySelector(".grid-item-species");
  expect(sci).toBeNull();
  const chip = screen.container().querySelector(".grid-item-taxon-chip");
  expect(chip).toBeNull();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/components/GridTile.test.tsx`
Expected: FAIL — current tile renders both lines + chip.

- [ ] **Step 3: Update GridTile**

In `GridTile.tsx`:
- Import `isOrderOnlyId` from `@/lib/text-format`
- Compute `const orderOnly = isOrderOnlyId(row.common_name, row.taxon_species, row.taxon_order)`
- Render: if `orderOnly` → show common name with `(order)` hint, skip the `.grid-item-species` span and the taxon-group chip
- Drop the `<span class="grid-item-taxon-chip">…</span>` (or equivalent) entirely — the audit said it duplicates filter state info on every tile

- [ ] **Step 4: Add hover glow + remove orphan chip CSS**

In `app/globals.css`, find `.grid-item` and add:

```css
.grid-item {
  transition: transform 200ms cubic-bezier(0.22, 1, 0.36, 1),
              box-shadow 200ms cubic-bezier(0.22, 1, 0.36, 1);
}
.grid-item:hover {
  transform: scale(1.02);
  box-shadow: 0 0 18px color-mix(in srgb, var(--accent-pink) 35%, transparent);
}
.grid-item-order-hint {
  font-style: italic;
  font-size: 0.75em;
  opacity: 0.6;
  margin-left: 0.25rem;
}
```

Search for `.grid-item-taxon-chip` references and delete the CSS block if it's now dead.

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/components/GridTile.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add app/gallery/_components/GridTile.tsx app/globals.css tests/components/GridTile.test.tsx
git commit --no-gpg-sign -m "feat(gallery): collapse order-only IDs on tiles + drop dup taxon chip + hover glow"
```

---

## Task 3: Gallery header — cute butterfly icon

**Files:**
- Modify: `app/gallery/page.tsx`

- [ ] **Step 1: Add the icon**

In `app/gallery/page.tsx`, find the gallery title heading (something like `<h1>gallery</h1>`). Replace with:

```tsx
import { CuteButterfly } from "@/app/components/icons";
// ...
<h1 className="gallery-title">
  gallery <CuteButterfly size={36} className="gallery-title-icon" loading="eager" />
</h1>
```

- [ ] **Step 2: Add CSS**

Append to `app/globals.css`:

```css
.gallery-title {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
}
.gallery-title-icon {
  transition: transform 300ms cubic-bezier(0.22, 1, 0.36, 1);
}
.gallery-title:hover .gallery-title-icon {
  transform: translateY(-2px) rotate(-8deg);
}
```

- [ ] **Step 3: tsc**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add app/gallery/page.tsx app/globals.css
git commit --no-gpg-sign -m "feat(gallery): cute butterfly next to title"
```

---

## Task 4: Skeleton-tile shimmer + sad-bug empty state

**Files:**
- Modify: `app/gallery/loading.tsx`
- Modify: `app/gallery/page.tsx` (Suspense fallback uses same skeleton block — verify)
- Modify: `app/globals.css`

- [ ] **Step 1: Read existing skeleton**

`app/gallery/loading.tsx` already renders skeleton tiles. Currently they have a static opacity animation. Replace the animation with a smoother shimmer.

Append/replace the relevant block in `app/globals.css`:

```css
.skeleton-tile {
  position: relative;
  overflow: hidden;
  background: var(--surface-1);
  border-radius: 1rem;
  aspect-ratio: 1;
}
.skeleton-tile::after {
  content: "";
  position: absolute;
  inset: 0;
  background: linear-gradient(
    90deg,
    transparent 0%,
    color-mix(in srgb, var(--accent-pink) 10%, transparent) 50%,
    transparent 100%
  );
  animation: shimmerSweep 1.6s ease-in-out infinite;
}
@keyframes shimmerSweep {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(100%); }
}
@media (prefers-reduced-motion: reduce) {
  .skeleton-tile::after { animation: none; opacity: 0.5; }
}
```

- [ ] **Step 2: Empty-state with sad-bug doodle**

In `app/gallery/page.tsx` (or wherever the empty-results message renders), use:

```tsx
import { SadBug } from "@/app/components/icons";
// ...
<div className="gallery-empty">
  <SadBug size={48} />
  <p>no insects match — try broadening the filters</p>
</div>
```

Append CSS:

```css
.gallery-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
  padding: 4rem 1rem;
  color: var(--text-muted);
}
```

- [ ] **Step 3: tsc**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add app/gallery/loading.tsx app/gallery/page.tsx app/globals.css
git commit --no-gpg-sign -m "feat(gallery): shimmer skeleton + sad-bug empty state"
```

---

## Task 5: Delete orphaned filter components

**Files:**
- Delete: `app/components/filters/FilterBar.tsx`
- Delete: `app/components/filters/FilterPopover.tsx`
- Delete: `app/components/filters/TaxonGroupChips.tsx`

- [ ] **Step 1: Confirm no remaining importers**

Run:
```bash
grep -rn "FilterBar\|FilterPopover\|TaxonGroupChips" app/ tests/ --include="*.ts" --include="*.tsx" | grep -v "AllOrChipsFilter"
```
Expected: zero results.

If anything remains, fix the importer first (or delete its test).

- [ ] **Step 2: Delete**

```bash
git rm app/components/filters/FilterBar.tsx app/components/filters/FilterPopover.tsx app/components/filters/TaxonGroupChips.tsx
```

Also search for and delete any tests that reference them:
```bash
ls tests/components/ | grep -E "FilterBar|FilterPopover|TaxonGroupChips"
```

- [ ] **Step 3: Sweep dead CSS**

Search globals.css for selectors specific to the deleted components (e.g., `.filter-popover`, `.taxon-group-chips`) and remove blocks that no longer apply.

- [ ] **Step 4: tsc + tests**

```bash
npx tsc --noEmit && npx vitest run --reporter=default
```
Expected: clean, all tests pass.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit --no-gpg-sign -m "chore(filters): delete orphaned FilterBar/FilterPopover/TaxonGroupChips"
```

---

## Final verification

- [ ] **Step 1: Full suite**

```bash
npx tsc --noEmit && npx vitest run --reporter=default && npx playwright test --reporter=line
```
Expected: all green.

- [ ] **Step 2: Visual MCP smoke**

Navigate to `/gallery` at 1440×900 and 375×800. Screenshot. Confirm:
- Cute butterfly next to "gallery" title
- Horizontal filter row with chip+autocomplete pattern (matches home)
- Tile name blocks correctly handle order-only IDs (one display + "(order)" hint)
- No taxon-group chip on tiles
- Tile hover glow visible on mouseover
- Skeleton tiles shimmer during initial load

- [ ] **Step 3: Build**

```bash
npm run build 2>&1 | tail -10
```
Expected: build succeeds.
