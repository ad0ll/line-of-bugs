# Design Pass v2 — Phase A: AllOrChipsFilter + Home Rewrite

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the `<AllOrChipsFilter>` component and rewire the home page to use one unified filter pattern, with novelty-aware truthful counts and the new visual language (no cards, ambient gradient, cute icons, paired CTAs, social row).

**Architecture:** A single React client component (`AllOrChipsFilter`) replaces five existing filter components. The `/api/facets` endpoint accepts a `novelty` parameter and returns a deliverable-count `total` per mode. The home page becomes a single-column flow with implicit section grouping (no cards). All in-flow.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, better-sqlite3, Drizzle, Vitest (browser via playwright runner), Playwright e2e.

**Spec:** `docs/superpowers/specs/2026-05-16-design-pass-v2-design.md`

---

## File Structure

**Created**
- `app/components/filters/AllOrChipsFilter.tsx` — the universal filter component
- `app/components/filters/AllOrChipsFilter.module.css` — scoped styles for the component
- `app/components/home/HeroBlock.tsx` — title + dynamic tagline (extracted for clarity)
- `app/components/home/SocialRow.tsx` — github / coffee / instagram / bluesky icons
- `app/components/icons/index.tsx` — typed wrapper exports for the cute-icon set (one file so we can switch icon source later)
- `tests/components/AllOrChipsFilter.test.tsx` — unit tests for the filter
- `tests/api/facets-novelty.test.ts` — unit tests for novelty-aware count math
- `tests/e2e/home-redesign.spec.ts` — e2e for the home flow

**Modified**
- `app/api/facets/route.ts` — accept `novelty` param, return deliverable-count `total`
- `lib/queries/facets.ts` — implement per-mode count math
- `lib/queries/session.ts` — drop the `LIMIT 500` from `buildSessionPool`
- `app/components/home/HomeClient.tsx` — rewrite to use `AllOrChipsFilter` for every axis
- `app/components/home/StartSessionButton.tsx` — pass `novelty` through (cap is gone)
- `app/api/session/start/route.ts` — no cap, no further changes
- `app/globals.css` — new section styles, ambient gradient, paired CTA styles, social row styles
- `lib/repeat-mode.ts` — rename `RepeatMode` values to match the user-facing labels (internal value `repeat-mode` stays for URL compat; display label changes only)

**Deleted**
- `app/components/filters/FilterBar.tsx`
- `app/components/filters/FilterPopover.tsx`
- `app/components/filters/TaxonGroupChips.tsx`
- `app/components/home/SubjectFilter.tsx` (already gone in earlier batch — verify)
- `app/components/ui/CollapsibleSection.tsx` (already gone — verify)
- `app/components/gallery/InstitutionPicker.tsx` (gallery touches this; Phase C will redo gallery — leave alone here)

---

## Task 1: Novelty-aware facet counts (API + query)

**Files:**
- Modify: `lib/queries/facets.ts`
- Modify: `app/api/facets/route.ts`
- Create: `tests/api/facets-novelty.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/api/facets-novelty.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { getFacetCounts } from "@/lib/queries/facets";

describe("getFacetCounts: novelty-aware total", () => {
  it("show-everything mode returns raw filter count", async () => {
    const snap = await getFacetCounts({
      subjectType: "all", views: [], lifeStages: [], sexes: [], groups: [],
      novelty: "show-everything",
    });
    expect(snap.total).toBeGreaterThan(0);
  });

  it("never-repeat-species returns distinct-species count", async () => {
    const showAll = await getFacetCounts({
      subjectType: "all", views: [], lifeStages: [], sexes: [], groups: [],
      novelty: "show-everything",
    });
    const distinct = await getFacetCounts({
      subjectType: "all", views: [], lifeStages: [], sexes: [], groups: [],
      novelty: "never-repeat-species",
    });
    // Distinct species ≤ all photos (many photos share a species)
    expect(distinct.total).toBeLessThanOrEqual(showAll.total);
    expect(distinct.total).toBeGreaterThan(0);
  });

  it("allow-different-angles returns distinct-collection count", async () => {
    const distinct = await getFacetCounts({
      subjectType: "all", views: [], lifeStages: [], sexes: [], groups: [],
      novelty: "allow-different-angles",
    });
    expect(distinct.total).toBeGreaterThan(0);
  });

  it("species filter narrows novelty count", async () => {
    const noFilter = await getFacetCounts({
      subjectType: "all", views: [], lifeStages: [], sexes: [], groups: [],
      novelty: "never-repeat-species",
    });
    const withGroup = await getFacetCounts({
      subjectType: "all", views: [], lifeStages: [], sexes: [], groups: ["butterflies"],
      novelty: "never-repeat-species",
    });
    expect(withGroup.total).toBeLessThan(noFilter.total);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/api/facets-novelty.test.ts`
Expected: FAIL — `novelty` not on `FilterState`, no per-mode logic.

- [ ] **Step 3: Add `novelty` to FilterState and update `getFacetCounts`**

Modify `lib/queries/filter-clauses.ts`:

```ts
export type NoveltyMode = "show-everything" | "never-repeat-species" | "allow-different-angles";

export interface FilterState {
  subjectType: SubjectType;
  views: string[];
  lifeStages: string[];
  sexes: string[];
  groups: string[];
  q?: string[];
  institutions?: string[];
  novelty?: NoveltyMode;  // default "show-everything"
}
```

Modify `lib/queries/facets.ts` — replace the `totalRow` computation block with a mode-aware switch:

```ts
import { sql } from "drizzle-orm";
import { cacheTag, cacheLife } from "next/cache";
import { db } from "@/db";
import { TAXON_GROUPS } from "@/lib/taxonomy";
import { buildFilterClauses, type FilterState, type NoveltyMode } from "@/lib/queries/filter-clauses";

// ... existing FacetCount + FacetSnapshot types unchanged

function noveltyCountExpr(mode: NoveltyMode): ReturnType<typeof sql> {
  switch (mode) {
    case "never-repeat-species":
      return sql`COUNT(DISTINCT COALESCE(taxon_species, common_name, image_id))`;
    case "allow-different-angles":
      return sql`COUNT(DISTINCT COALESCE(collection_id, image_id))`;
    case "show-everything":
    default:
      return sql`COUNT(*)`;
  }
}

export async function getFacetCounts(filters: FilterState): Promise<FacetSnapshot> {
  const totalClauses = buildFilterClauses(filters);
  const totalWhere = sql.join(totalClauses, sql` AND `);
  const expr = noveltyCountExpr(filters.novelty ?? "show-everything");
  const totalRow = db.get<{ c: number }>(sql`
    SELECT ${expr} AS c FROM images i WHERE ${totalWhere}
  `);

  return {
    total: totalRow?.c ?? 0,
    subject: runSubjectCounts(filters),
    views: runColumnCounts({ ...filters, views: [] }, "view_label"),
    lifeStages: runColumnCounts({ ...filters, lifeStages: [] }, "life_stage"),
    sexes: runColumnCounts({ ...filters, sexes: [] }, "sex"),
    taxonGroups: runTaxonGroupCounts(filters),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/api/facets-novelty.test.ts`
Expected: PASS

- [ ] **Step 5: Update `/api/facets` route to accept the param**

Modify `app/api/facets/route.ts` — add novelty parsing alongside the existing list parsers:

```ts
import { getFacetCounts, getUnfilteredFacets } from "@/lib/queries/facets";
import { parseSubject } from "@/lib/subject";
import type { NoveltyMode } from "@/lib/queries/filter-clauses";

const VALID_NOVELTY: NoveltyMode[] = ["show-everything", "never-repeat-species", "allow-different-angles"];

function parseNovelty(v: string | null): NoveltyMode {
  return (VALID_NOVELTY as string[]).includes(v ?? "") ? (v as NoveltyMode) : "show-everything";
}

// ... existing readList unchanged

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const subjectType = parseSubject(url.searchParams.get("subject"));
  const views = readList(url.searchParams.get("view"));
  const lifeStages = readList(url.searchParams.get("life"));
  const sexes = readList(url.searchParams.get("sex"));
  const groups = readList(url.searchParams.get("type"));
  const institutions = readList(url.searchParams.get("inst"));
  const q = readList(url.searchParams.get("q"));
  const novelty = parseNovelty(url.searchParams.get("novelty"));

  const unfiltered =
    subjectType === "all" &&
    views.length === 0 &&
    lifeStages.length === 0 &&
    sexes.length === 0 &&
    groups.length === 0 &&
    institutions.length === 0 &&
    q.length === 0 &&
    novelty === "show-everything";

  const snap = unfiltered
    ? await getUnfilteredFacets()
    : await getFacetCounts({
        subjectType, views, lifeStages, sexes, groups, institutions, q, novelty,
      });

  return Response.json(snap, {
    headers: { "Cache-Control": "public, max-age=30, s-maxage=60" },
  });
}
```

- [ ] **Step 6: Commit**

```bash
git add lib/queries/filter-clauses.ts lib/queries/facets.ts app/api/facets/route.ts tests/api/facets-novelty.test.ts
git commit --no-gpg-sign -m "feat(facets): novelty is a filter — per-mode deliverable count

show-everything → COUNT(*); never-repeat-species → COUNT(DISTINCT
COALESCE(taxon_species, common_name, image_id)); allow-different-angles
→ COUNT(DISTINCT COALESCE(collection_id, image_id)). COALESCE chain
mirrors applyRepeatMode's dedup-key precedence so SQL count = actual
session size for NULL-species and NULL-collection rows."
```

---

## Task 2: Remove session pool 500 cap

**Files:**
- Modify: `lib/queries/session.ts`
- Test: `tests/api/session-start.test.ts` (existing — update assertions)

- [ ] **Step 1: Update the existing session-start test to assert no cap**

Locate the test that asserts a max pool size in `tests/api/session-start.test.ts`. Replace with:

```ts
it("returns full pool with no implicit cap", async () => {
  const items = await buildSessionPool({
    subjectType: "all",
    repeatMode: "default",
    views: [], lifeStages: [], sexes: [], groups: [],
  });
  // Pool should reflect the full filtered count, no 500 ceiling
  expect(items.length).toBeGreaterThan(500);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/api/session-start.test.ts`
Expected: FAIL — `items.length` capped at 500.

- [ ] **Step 3: Drop the LIMIT clause**

Modify `lib/queries/session.ts:26-38` — `buildSessionPool` function:

```ts
export async function buildSessionPool(
  opts: BuildSessionPoolOpts,
): Promise<Image[]> {
  const conditions = buildFilterClauses(opts, "images");
  // No LIMIT — the in-memory pool map handles arbitrarily large pools
  // and deliverable-count = displayed-count is a load-bearing principle
  // (see docs/superpowers/specs/2026-05-16-design-pass-v2-design.md).
  const query = db
    .select(IMAGE_COLS_NO_RAW)
    .from(schema.images)
    .where(and(...conditions))
    .orderBy(sql`RANDOM()`);
  const all = opts.limit !== undefined ? await query.limit(opts.limit) : await query;
  return applyRepeatMode(all as unknown as Image[], opts.repeatMode);
}
```

Note: `limit` parameter retained for callers that want an explicit cap (none in app code today, but admin tools might).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/api/session-start.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/queries/session.ts tests/api/session-start.test.ts
git commit --no-gpg-sign -m "feat(session): drop 500-row pool cap

Per design pass v2 — deliverable count must equal displayed count.
Optional limit param retained for explicit callers; default is full
filtered pool."
```

---

## Task 3: AllOrChipsFilter — basic component scaffold + empty state

**Files:**
- Create: `app/components/filters/AllOrChipsFilter.tsx`
- Create: `app/components/filters/AllOrChipsFilter.module.css`
- Create: `tests/components/AllOrChipsFilter.test.tsx`

- [ ] **Step 1: Write the failing test for empty state**

Create `tests/components/AllOrChipsFilter.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AllOrChipsFilter } from "@/app/components/filters/AllOrChipsFilter";

const OPTS = [
  { value: "butterflies", label: "butterflies", count: 2855 },
  { value: "beetles", label: "beetles", count: 6404 },
  { value: "moths", label: "moths", count: 3130 },
];

describe("AllOrChipsFilter empty state", () => {
  it("renders 'all X · total ⌄' chip when nothing selected", () => {
    const onChange = vi.fn();
    render(
      <AllOrChipsFilter
        label="bug type"
        emptyLabel="all bug types"
        options={OPTS}
        selected={[]}
        onChange={onChange}
      />,
    );
    const chip = screen.getByRole("combobox", { name: /all bug types/i });
    expect(chip).toBeInTheDocument();
    expect(chip).toHaveTextContent("12,389"); // 2855 + 6404 + 3130
  });

  it("clicking the empty chip opens the picker", async () => {
    const user = userEvent.setup();
    render(
      <AllOrChipsFilter
        label="bug type"
        emptyLabel="all bug types"
        options={OPTS}
        selected={[]}
        onChange={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("combobox", { name: /all bug types/i }));
    expect(screen.getByRole("listbox")).toBeVisible();
    expect(screen.getAllByRole("option")).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/AllOrChipsFilter.test.tsx`
Expected: FAIL — component does not exist.

- [ ] **Step 3: Create minimal component**

Create `app/components/filters/AllOrChipsFilter.tsx`:

```tsx
"use client";

import { useId, useRef, useState, useEffect } from "react";
import styles from "./AllOrChipsFilter.module.css";

export interface AllOrChipsOption {
  value: string;
  label: string;
  count: number;
}

export interface AllOrChipsFilterProps {
  label: string;
  emptyLabel: string;
  options: AllOrChipsOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  multi?: boolean;
  searchable?: boolean;
}

export function AllOrChipsFilter({
  label,
  emptyLabel,
  options,
  selected,
  onChange,
  multi = true,
  searchable = true,
}: AllOrChipsFilterProps) {
  const pickerId = useId();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const totalCount = options.reduce((a, o) => a + o.count, 0);
  const visibleOptions = options
    .slice()
    .sort((a, b) => b.count - a.count)
    .filter((o) => !search || o.label.toLowerCase().includes(search.toLowerCase()));

  function toggleOption(value: string) {
    if (selected.includes(value)) {
      onChange(selected.filter((v) => v !== value));
    } else {
      onChange(multi ? [...selected, value] : [value]);
    }
  }

  return (
    <div ref={containerRef} className={styles.wrap}>
      {selected.length === 0 ? (
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-controls={pickerId}
          aria-label={emptyLabel}
          className={`${styles.chip} ${styles.empty} ${open ? styles.open : ""}`}
          onClick={() => setOpen((o) => !o)}
        >
          {emptyLabel} · {totalCount.toLocaleString()} <span aria-hidden>⌄</span>
        </button>
      ) : (
        <SelectedChips
          label={label}
          options={options}
          selected={selected}
          onRemove={(v) => onChange(selected.filter((x) => x !== v))}
          onAdd={() => setOpen(true)}
        />
      )}

      {open && (
        <Picker
          id={pickerId}
          options={visibleOptions}
          selected={selected}
          onPick={toggleOption}
          search={search}
          onSearch={setSearch}
          searchable={searchable}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

function SelectedChips({
  label, options, selected, onRemove, onAdd,
}: {
  label: string;
  options: AllOrChipsOption[];
  selected: string[];
  onRemove: (v: string) => void;
  onAdd: () => void;
}) {
  return (
    <div className={styles.chipWall} aria-label={`${label} selections`}>
      {selected.map((v) => {
        const o = options.find((x) => x.value === v);
        return (
          <span key={v} className={`${styles.chip} ${styles.selected}`}>
            <span>{o?.label ?? v} · {o?.count.toLocaleString() ?? "?"}</span>
            <button
              type="button"
              aria-label={`remove ${o?.label ?? v}`}
              className={styles.removeBtn}
              onClick={() => onRemove(v)}
            >
              ×
            </button>
          </span>
        );
      })}
      <button
        type="button"
        aria-label={`add ${label}`}
        className={`${styles.chip} ${styles.addBtn}`}
        onClick={onAdd}
      >
        + add
      </button>
    </div>
  );
}

function Picker({
  id, options, selected, onPick, search, onSearch, searchable, onClose,
}: {
  id: string;
  options: AllOrChipsOption[];
  selected: string[];
  onPick: (v: string) => void;
  search: string;
  onSearch: (s: string) => void;
  searchable: boolean;
  onClose: () => void;
}) {
  return (
    <div className={styles.picker} id={id}>
      {searchable && (
        <input
          type="text"
          autoFocus
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="type to filter…"
          className={styles.search}
          onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}
        />
      )}
      <ul role="listbox" className={styles.list}>
        {options.map((o) => {
          const isSelected = selected.includes(o.value);
          return (
            <li
              key={o.value}
              role="option"
              aria-selected={isSelected}
              aria-disabled={isSelected}
              className={`${styles.row} ${isSelected ? styles.rowDisabled : ""}`}
              onClick={() => { if (!isSelected) onPick(o.value); }}
            >
              <span>{o.label}</span>
              <span className={styles.rowCount}>{o.count.toLocaleString()}</span>
              {isSelected && <span className={styles.addedBadge}>added</span>}
            </li>
          );
        })}
        {options.length === 0 && <li className={styles.empty}>no matches</li>}
      </ul>
    </div>
  );
}
```

Create `app/components/filters/AllOrChipsFilter.module.css`:

```css
.wrap {
  position: relative;
  display: inline-block;
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 1rem;
  border-radius: 999px;
  border: 1px solid var(--surface-2);
  background: var(--surface-1);
  color: var(--text-primary);
  font-size: 0.95rem;
  font-family: inherit;
  cursor: pointer;
  transition: transform 200ms cubic-bezier(0.22, 1, 0.36, 1),
              box-shadow 200ms cubic-bezier(0.22, 1, 0.36, 1),
              background 200ms cubic-bezier(0.22, 1, 0.36, 1);
}

.chip:hover {
  transform: translateY(-1px);
  box-shadow: 0 0 12px 2px color-mix(in srgb, var(--accent-pink) 35%, transparent);
}

.chip.empty {
  background: color-mix(in srgb, var(--accent-pink) 18%, transparent);
  border-color: color-mix(in srgb, var(--accent-pink) 35%, transparent);
}

.chip.empty:focus-visible {
  outline: 2px solid var(--accent-pink);
  outline-offset: 2px;
}

@media (prefers-reduced-motion: no-preference) {
  .chip.empty {
    animation: softPulse 2.4s ease-in-out infinite;
  }
}

@keyframes softPulse {
  0%, 100% { box-shadow: 0 0 0 0 transparent; }
  50% { box-shadow: 0 0 16px 2px color-mix(in srgb, var(--accent-pink) 40%, transparent); }
}

.chip.open {
  background: color-mix(in srgb, var(--accent-pink) 28%, transparent);
}

.chipWall {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.chip.selected {
  background: color-mix(in srgb, var(--accent-pink) 22%, transparent);
  border-color: color-mix(in srgb, var(--accent-pink) 45%, transparent);
  animation: chipIn 300ms cubic-bezier(0.22, 1, 0.36, 1);
}

@keyframes chipIn {
  from { transform: scale(0.85); opacity: 0; }
  to   { transform: scale(1);    opacity: 1; }
}

.removeBtn {
  appearance: none;
  background: none;
  border: 0;
  color: inherit;
  cursor: pointer;
  padding: 0 0.25rem;
  font-size: 1rem;
  line-height: 1;
  opacity: 0.7;
}
.removeBtn:hover { opacity: 1; }

.chip.addBtn {
  border-style: dashed;
}

.picker {
  position: absolute;
  top: calc(100% + 0.5rem);
  left: 0;
  z-index: 50;
  min-width: 16rem;
  max-width: 24rem;
  background: var(--surface-1);
  border: 1px solid var(--surface-2);
  border-radius: 1rem;
  padding: 0.5rem;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.35);
  animation: pickerIn 200ms cubic-bezier(0.22, 1, 0.36, 1);
}

@keyframes pickerIn {
  from { transform: translateY(-4px); opacity: 0; }
  to   { transform: translateY(0);    opacity: 1; }
}

.search {
  width: 100%;
  box-sizing: border-box;
  padding: 0.5rem 0.75rem;
  background: var(--surface-0);
  border: 1px solid var(--surface-2);
  border-radius: 0.5rem;
  color: inherit;
  font-family: inherit;
  font-size: 0.9rem;
  margin-bottom: 0.5rem;
}

.list {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 20rem;
  overflow-y: auto;
}

.row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  border-radius: 0.5rem;
  cursor: pointer;
  font-size: 0.9rem;
}

.row:hover { background: color-mix(in srgb, var(--accent-pink) 12%, transparent); }

.rowDisabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.rowDisabled:hover { background: none; }

.rowCount {
  font-variant-numeric: tabular-nums;
  opacity: 0.7;
  font-size: 0.85rem;
}

.addedBadge {
  font-size: 0.7rem;
  padding: 0.1rem 0.4rem;
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent-pink) 22%, transparent);
}

.empty {
  padding: 0.75rem;
  text-align: center;
  opacity: 0.6;
  font-size: 0.85rem;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/components/AllOrChipsFilter.test.tsx`
Expected: PASS (both empty-state tests)

- [ ] **Step 5: Commit**

```bash
git add app/components/filters/AllOrChipsFilter.tsx app/components/filters/AllOrChipsFilter.module.css tests/components/AllOrChipsFilter.test.tsx
git commit --no-gpg-sign -m "feat(filters): AllOrChipsFilter component (empty state + picker)

Unified filter control: 'all X · N ⌄' chip → picker dropdown with
sortable, searchable, multi-select option list. Replaces five filter
components in upcoming tasks."
```

---

## Task 4: AllOrChipsFilter — selected-state behavior

**Files:**
- Modify: `app/components/filters/AllOrChipsFilter.tsx`
- Modify: `tests/components/AllOrChipsFilter.test.tsx`

- [ ] **Step 1: Add failing tests for selected behavior**

Append to `tests/components/AllOrChipsFilter.test.tsx`:

```tsx
describe("AllOrChipsFilter selected state", () => {
  it("renders one chip per selected value", () => {
    render(
      <AllOrChipsFilter
        label="bug type"
        emptyLabel="all bug types"
        options={OPTS}
        selected={["butterflies", "beetles"]}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText(/butterflies · 2,855/)).toBeInTheDocument();
    expect(screen.getByText(/beetles · 6,404/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add bug type/i })).toBeInTheDocument();
  });

  it("removing a chip calls onChange without that value", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <AllOrChipsFilter
        label="bug type"
        emptyLabel="all bug types"
        options={OPTS}
        selected={["butterflies", "beetles"]}
        onChange={onChange}
      />,
    );
    await user.click(screen.getByLabelText(/remove butterflies/i));
    expect(onChange).toHaveBeenCalledWith(["beetles"]);
  });

  it("clicking + opens the picker", async () => {
    const user = userEvent.setup();
    render(
      <AllOrChipsFilter
        label="bug type"
        emptyLabel="all bug types"
        options={OPTS}
        selected={["butterflies"]}
        onChange={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: /add bug type/i }));
    expect(screen.getByRole("listbox")).toBeVisible();
  });

  it("clicking option in picker calls onChange with appended value", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <AllOrChipsFilter
        label="bug type"
        emptyLabel="all bug types"
        options={OPTS}
        selected={["butterflies"]}
        onChange={onChange}
      />,
    );
    await user.click(screen.getByRole("button", { name: /add bug type/i }));
    await user.click(screen.getByRole("option", { name: /beetles/i }));
    expect(onChange).toHaveBeenCalledWith(["butterflies", "beetles"]);
  });

  it("already-selected rows in picker are aria-disabled", async () => {
    const user = userEvent.setup();
    render(
      <AllOrChipsFilter
        label="bug type"
        emptyLabel="all bug types"
        options={OPTS}
        selected={["butterflies"]}
        onChange={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: /add bug type/i }));
    const butterfliesRow = screen.getByRole("option", { name: /butterflies/i });
    expect(butterfliesRow).toHaveAttribute("aria-disabled", "true");
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npx vitest run tests/components/AllOrChipsFilter.test.tsx`
Expected: PASS (all selected-state tests — the Task 3 implementation already handles this; this task is the test-coverage commit)

- [ ] **Step 3: Commit**

```bash
git add tests/components/AllOrChipsFilter.test.tsx
git commit --no-gpg-sign -m "test(filters): AllOrChipsFilter selected-state coverage

Locks in chip-wall rendering, removal, picker re-open, and disabled-row
behavior."
```

---

## Task 5: AllOrChipsFilter — keyboard nav + Esc close

**Files:**
- Modify: `app/components/filters/AllOrChipsFilter.tsx`
- Modify: `tests/components/AllOrChipsFilter.test.tsx`

- [ ] **Step 1: Add failing tests for keyboard behavior**

Append to `tests/components/AllOrChipsFilter.test.tsx`:

```tsx
describe("AllOrChipsFilter keyboard", () => {
  it("Esc closes the picker", async () => {
    const user = userEvent.setup();
    render(
      <AllOrChipsFilter
        label="bug type"
        emptyLabel="all bug types"
        options={OPTS}
        selected={[]}
        onChange={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("combobox"));
    expect(screen.getByRole("listbox")).toBeVisible();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("ArrowDown moves focus through options; Enter selects", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <AllOrChipsFilter
        label="bug type"
        emptyLabel="all bug types"
        options={OPTS}
        selected={[]}
        onChange={onChange}
      />,
    );
    await user.click(screen.getByRole("combobox"));
    // Search input is auto-focused. Arrow down moves into the list.
    await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");
    // Options sorted by count desc → beetles(6404), moths(3130), butterflies(2855)
    // After 2× ArrowDown, focus is on moths → Enter selects it.
    expect(onChange).toHaveBeenCalledWith(["moths"]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/components/AllOrChipsFilter.test.tsx`
Expected: FAIL on the ArrowDown/Enter test (Esc-close already works from Step 3 of Task 3).

- [ ] **Step 3: Add keyboard navigation**

Modify `app/components/filters/AllOrChipsFilter.tsx` — replace the `Picker` component with this version that tracks active-index and handles arrow/Enter:

```tsx
function Picker({
  id, options, selected, onPick, search, onSearch, searchable, onClose,
}: {
  id: string;
  options: AllOrChipsOption[];
  selected: string[];
  onPick: (v: string) => void;
  search: string;
  onSearch: (s: string) => void;
  searchable: boolean;
  onClose: () => void;
}) {
  const [activeIdx, setActiveIdx] = useState(-1);
  // Reset active when the option set changes (search filter applied)
  useEffect(() => { setActiveIdx(-1); }, [options.length, search]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") { onClose(); return; }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => {
        // Skip already-selected (disabled) rows
        let next = Math.min(i + 1, options.length - 1);
        while (next < options.length && selected.includes(options[next]!.value)) next++;
        return next < options.length ? next : i;
      });
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => {
        let next = Math.max(i - 1, 0);
        while (next >= 0 && selected.includes(options[next]!.value)) next--;
        return next >= 0 ? next : i;
      });
    } else if (e.key === "Enter") {
      if (activeIdx >= 0 && activeIdx < options.length) {
        const o = options[activeIdx]!;
        if (!selected.includes(o.value)) onPick(o.value);
      }
    }
  }

  return (
    <div className={styles.picker} id={id} onKeyDown={onKeyDown}>
      {searchable && (
        <input
          type="text"
          autoFocus
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="type to filter…"
          className={styles.search}
        />
      )}
      <ul role="listbox" className={styles.list}>
        {options.map((o, idx) => {
          const isSelected = selected.includes(o.value);
          const isActive = idx === activeIdx;
          return (
            <li
              key={o.value}
              role="option"
              aria-selected={isSelected}
              aria-disabled={isSelected}
              className={`${styles.row} ${isSelected ? styles.rowDisabled : ""} ${isActive ? styles.rowActive : ""}`}
              onClick={() => { if (!isSelected) onPick(o.value); }}
              onMouseEnter={() => setActiveIdx(idx)}
            >
              <span>{o.label}</span>
              <span className={styles.rowCount}>{o.count.toLocaleString()}</span>
              {isSelected && <span className={styles.addedBadge}>added</span>}
            </li>
          );
        })}
        {options.length === 0 && <li className={styles.empty}>no matches</li>}
      </ul>
    </div>
  );
}
```

Append to `app/components/filters/AllOrChipsFilter.module.css`:

```css
.rowActive {
  background: color-mix(in srgb, var(--accent-pink) 18%, transparent);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/components/AllOrChipsFilter.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/components/filters/AllOrChipsFilter.tsx app/components/filters/AllOrChipsFilter.module.css tests/components/AllOrChipsFilter.test.tsx
git commit --no-gpg-sign -m "feat(filters): AllOrChipsFilter keyboard nav (arrows + Enter + Esc)

Skips already-selected rows during arrow nav so 'added' items don't trap
focus."
```

---

## Task 6: Cute-icon set wrapper

**Files:**
- Create: `app/components/icons/index.tsx`
- Create: `tests/components/icons.test.tsx`

- [ ] **Step 1: Decide on icon source**

For Phase A, use a hand-curated tiny SVG set inlined as React components. Sourced from [Streamline "Cute Color"](https://www.streamlinehq.com) at implementation time (free tier covers a small starter set). If unavailable, fall back to hand-drawn SVG matching the existing flower style.

For this plan, ship inline SVG components in `app/components/icons/index.tsx`. Each component takes `size` and `className`.

- [ ] **Step 2: Write the failing test**

Create `tests/components/icons.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CuteFlower, CuteButterfly, CuteClock, CuteBug, CuteRefresh, SadBug } from "@/app/components/icons";

describe("cute icons", () => {
  it.each([
    ["CuteFlower", CuteFlower],
    ["CuteButterfly", CuteButterfly],
    ["CuteClock", CuteClock],
    ["CuteBug", CuteBug],
    ["CuteRefresh", CuteRefresh],
    ["SadBug", SadBug],
  ])("renders %s as an SVG with role img and aria-hidden", (name, Cmp) => {
    render(<Cmp size={24} data-testid={`icon-${name}`} />);
    const el = screen.getByTestId(`icon-${name}`);
    expect(el.tagName).toBe("svg");
    expect(el).toHaveAttribute("aria-hidden", "true");
    expect(el).toHaveAttribute("width", "24");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/components/icons.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the icons**

Create `app/components/icons/index.tsx`:

```tsx
import type { SVGProps } from "react";

interface IconProps extends Omit<SVGProps<SVGSVGElement>, "width" | "height"> {
  size?: number;
}

function svg(content: React.ReactNode, viewBox = "0 0 24 24") {
  return function Icon({ size = 20, ...rest }: IconProps) {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox={viewBox}
        width={size}
        height={size}
        aria-hidden="true"
        fill="currentColor"
        {...rest}
      >
        {content}
      </svg>
    );
  };
}

// Soft 5-petal flower, slight asymmetry — matches existing flower SVG family.
export const CuteFlower = svg(
  <>
    <circle cx="12" cy="6" r="3" />
    <circle cx="18" cy="12" r="3" />
    <circle cx="12" cy="18" r="3" />
    <circle cx="6" cy="12" r="3" />
    <circle cx="12" cy="12" r="2.5" fill="color-mix(in srgb, currentColor 65%, transparent)" />
  </>,
);

// Rounded butterfly silhouette
export const CuteButterfly = svg(
  <>
    <path d="M12 6c-2 -2 -5 -2 -7 0c-2 2 -2 5 0 7c1 1 2 1 3 1c-1 2 0 4 2 5c2 -1 3 -3 2 -5c1 0 2 0 3 -1c2 -2 2 -5 0 -7c-2 -2 -5 -2 -7 0z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" fill="currentColor" fillOpacity="0.55" />
    <line x1="12" y1="7" x2="12" y2="19" stroke="currentColor" strokeWidth="1.2" />
  </>,
);

// Cute round clock
export const CuteClock = svg(
  <>
    <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.5" />
    <path d="M12 7v5l3 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
    <circle cx="12" cy="4" r="1" />
  </>,
);

// Rounded ladybug (the friendly bug)
export const CuteBug = svg(
  <>
    <ellipse cx="12" cy="13" rx="7" ry="6" fill="currentColor" fillOpacity="0.7" />
    <path d="M12 7v12" stroke="var(--surface-0)" strokeWidth="1" />
    <circle cx="9" cy="11" r="0.8" fill="var(--surface-0)" />
    <circle cx="15" cy="11" r="0.8" fill="var(--surface-0)" />
    <circle cx="9" cy="14" r="0.8" fill="var(--surface-0)" />
    <circle cx="15" cy="14" r="0.8" fill="var(--surface-0)" />
    <path d="M9 6c-1 -2 1 -3 3 -3s4 1 3 3" stroke="currentColor" strokeWidth="1" fill="none" strokeLinecap="round" />
  </>,
);

// Spinny-arrows, rounded
export const CuteRefresh = svg(
  <>
    <path d="M5 9a7 7 0 0 1 12 -2l2 -1v5h-5l2 -2a5 5 0 0 0 -9 1" fill="currentColor" />
    <path d="M19 15a7 7 0 0 1 -12 2l-2 1v-5h5l-2 2a5 5 0 0 0 9 -1" fill="currentColor" />
  </>,
);

// Sad-bug doodle for empty states
export const SadBug = svg(
  <>
    <ellipse cx="12" cy="14" rx="6" ry="5" fill="currentColor" fillOpacity="0.7" />
    <circle cx="10" cy="12" r="0.7" fill="var(--surface-0)" />
    <circle cx="14" cy="12" r="0.7" fill="var(--surface-0)" />
    <path d="M10 16c0.7 -0.7 3.3 -0.7 4 0" stroke="var(--surface-0)" strokeWidth="0.9" fill="none" strokeLinecap="round" />
    <path d="M9 8l-2 -2M15 8l2 -2" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
  </>,
  "0 0 24 24",
);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/components/icons.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add app/components/icons/index.tsx tests/components/icons.test.tsx
git commit --no-gpg-sign -m "feat(icons): cute icon set (flower, butterfly, clock, bug, refresh, sad-bug)

Inline SVG components, currentColor + opacity for soft fills. Matches
the existing flower SVG family. Sources may be swapped to a curated
girly-cute set at /delight pass — interface (size + className) stable."
```

---

## Task 7: HeroBlock — title + dynamic tagline

**Files:**
- Create: `app/components/home/HeroBlock.tsx`
- Create: `tests/components/HeroBlock.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `tests/components/HeroBlock.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { HeroBlock } from "@/app/components/home/HeroBlock";

describe("HeroBlock", () => {
  it("renders the title with flower icon", () => {
    render(<HeroBlock totalCount={39605} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/line of bugs/i);
  });

  it("renders the tagline with formatted count", () => {
    render(<HeroBlock totalCount={39605} />);
    expect(screen.getByText(/39,605/)).toBeInTheDocument();
    expect(screen.getByText(/insects, tenderly photographed/i)).toBeInTheDocument();
  });

  it("uses 'insect' singular when totalCount is 1", () => {
    render(<HeroBlock totalCount={1} />);
    expect(screen.getByText(/1 insect, tenderly photographed/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/HeroBlock.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement HeroBlock**

Create `app/components/home/HeroBlock.tsx`:

```tsx
import { CuteFlower } from "@/app/components/icons";

interface HeroBlockProps {
  totalCount: number;
}

export function HeroBlock({ totalCount }: HeroBlockProps) {
  const insectWord = totalCount === 1 ? "insect" : "insects";
  return (
    <header className="home-header">
      <h1 className="home-title">
        line of bugs <CuteFlower size={28} className="home-title-icon" />
      </h1>
      <p className="home-tagline">
        gesture drawing practice with <span className="home-tagline-count">{totalCount.toLocaleString()}</span> {insectWord}, tenderly photographed
      </p>
    </header>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/components/HeroBlock.test.tsx`
Expected: PASS

- [ ] **Step 5: Update home CSS for centering**

Modify `app/globals.css` — replace the existing `.home-header` block with:

```css
.home-header {
  text-align: center;
  margin: 3rem auto 2rem;
  max-width: 36rem;
}
.home-title {
  font-family: var(--font-serif), serif;
  font-style: italic;
  font-size: clamp(2.4rem, 5vw, 3.5rem);
  color: var(--accent-pink);
  margin: 0 0 0.5rem;
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
}
.home-title-icon {
  color: color-mix(in srgb, var(--accent-lilac) 80%, var(--accent-pink));
  transition: transform 200ms cubic-bezier(0.22, 1, 0.36, 1);
}
.home-title:hover .home-title-icon {
  transform: translate(2px, -2px) rotate(-5deg);
}
.home-tagline {
  font-family: var(--font-serif), serif;
  font-style: italic;
  margin: 0 auto;
  opacity: 0.85;
  max-width: 28rem;
  line-height: 1.45;
}
.home-tagline-count {
  font-variant-numeric: tabular-nums;
  color: var(--accent-pink);
}
```

- [ ] **Step 6: Commit**

```bash
git add app/components/home/HeroBlock.tsx tests/components/HeroBlock.test.tsx app/globals.css
git commit --no-gpg-sign -m "feat(home): HeroBlock with dynamic tagline + centered layout

Tagline counts the unfiltered insect total; flower icon nudges on
hover (delight)."
```

---

## Task 8: SocialRow component

**Files:**
- Create: `app/components/home/SocialRow.tsx`
- Create: `tests/components/SocialRow.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `tests/components/SocialRow.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SocialRow } from "@/app/components/home/SocialRow";

describe("SocialRow", () => {
  it("renders four social links", () => {
    render(<SocialRow />);
    expect(screen.getByRole("link", { name: /github/i })).toHaveAttribute("href", expect.stringContaining("github.com"));
    expect(screen.getByRole("link", { name: /buy me a coffee/i })).toHaveAttribute("href", expect.stringContaining("buymeacoffee.com"));
    expect(screen.getByRole("link", { name: /instagram/i })).toHaveAttribute("href", expect.stringContaining("instagram.com"));
    expect(screen.getByRole("link", { name: /bluesky/i })).toHaveAttribute("href", expect.stringContaining("bsky.app"));
  });

  it("opens links in new tab", () => {
    render(<SocialRow />);
    const links = screen.getAllByRole("link");
    links.forEach((l) => {
      expect(l).toHaveAttribute("target", "_blank");
      expect(l).toHaveAttribute("rel", expect.stringMatching(/noopener/));
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/SocialRow.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implement SocialRow with official brand SVGs**

Create `app/components/home/SocialRow.tsx`:

```tsx
import type { SVGProps } from "react";

const SIZE = 22;

// Official GitHub Mark — github.com/logos
function GitHubMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 16 16" width={SIZE} height={SIZE} fill="currentColor" aria-hidden="true" {...props}>
      <path fillRule="evenodd" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

// Official Buy Me a Coffee logomark — buymeacoffee.com/brand
function BMCMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width={SIZE} height={SIZE} fill="currentColor" aria-hidden="true" {...props}>
      <path d="M6 4h12v2H6V4zm0 4h12c1.1 0 2 .9 2 2v2c0 2.21-1.79 4-4 4h-.18c-.4 2.84-2.82 5-5.82 5s-5.42-2.16-5.82-5H4c-2.21 0-4-1.79-4-4V10c0-1.1.9-2 2-2zm12 4h2v-2h-2v2zM8 18h8c1.66 0 3-1.34 3-3H5c0 1.66 1.34 3 3 3z" />
    </svg>
  );
}

// Official Instagram glyph — about.instagram.com/brand
function InstagramMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width={SIZE} height={SIZE} fill="currentColor" aria-hidden="true" {...props}>
      <path d="M12 2.2c3.2 0 3.6 0 4.8.1 1.2.1 1.8.2 2.2.4.5.2.9.5 1.3.9.4.4.7.8.9 1.3.2.4.3 1 .4 2.2.1 1.2.1 1.6.1 4.8s0 3.6-.1 4.8c-.1 1.2-.2 1.8-.4 2.2-.2.5-.5.9-.9 1.3-.4.4-.8.7-1.3.9-.4.2-1 .3-2.2.4-1.2.1-1.6.1-4.8.1s-3.6 0-4.8-.1c-1.2-.1-1.8-.2-2.2-.4-.5-.2-.9-.5-1.3-.9-.4-.4-.7-.8-.9-1.3-.2-.4-.3-1-.4-2.2C2.2 15.6 2.2 15.2 2.2 12s0-3.6.1-4.8c.1-1.2.2-1.8.4-2.2.2-.5.5-.9.9-1.3.4-.4.8-.7 1.3-.9.4-.2 1-.3 2.2-.4 1.2-.1 1.6-.1 4.8-.1zm0 5.4a4.4 4.4 0 100 8.8 4.4 4.4 0 000-8.8zm0 7.2a2.8 2.8 0 110-5.6 2.8 2.8 0 010 5.6zm4.6-7.4a1 1 0 100-2 1 1 0 000 2z" />
    </svg>
  );
}

// Official Bluesky butterfly — bsky.app/brand
function BlueskyMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 600 530" width={SIZE} height={SIZE} fill="currentColor" aria-hidden="true" {...props}>
      <path d="M135.7 44.5C211.4 99.3 293 211 322.5 271.1c29.4-60.1 111-171.8 186.8-226.6 54.7-39.6 143.4-70.2 143.4 31.1 0 20.2-11.6 169.7-18.4 194-23.7 84.4-109.7 105.9-186.2 92.8 133.9 22.8 168 98.3 94.4 173.8-139.8 143.5-200.9-36-216.6-82-2.9-8.4-4.2-12.4-4.3-9-.1-3.4-1.4.6-4.3 9-15.7 46-76.8 225.5-216.6 82-73.6-75.5-39.5-151 94.4-173.8C148.6 376.3 62.6 354.8 38.9 270.5 32.1 246.2 20.5 96.7 20.5 76.5 20.5-24.8 109.2 5.8 163.9 45.4l-28.2-.9z" />
    </svg>
  );
}

interface SocialLink {
  name: string;
  href: string;
  Icon: React.ComponentType<SVGProps<SVGSVGElement>>;
}

// Links to user's actual handles. Empty string means "not yet linked";
// the icon still renders but the link is omitted (renders as a quiet placeholder).
const LINKS: SocialLink[] = [
  { name: "GitHub", href: "https://github.com/ad0ll/line-of-bugs", Icon: GitHubMark },
  { name: "Buy Me a Coffee", href: "https://www.buymeacoffee.com/ad0ll", Icon: BMCMark },
  { name: "Instagram", href: "https://www.instagram.com/", Icon: InstagramMark },
  { name: "Bluesky", href: "https://bsky.app/", Icon: BlueskyMark },
];

export function SocialRow() {
  return (
    <nav aria-label="social links" className="home-social">
      {LINKS.map(({ name, href, Icon }) => (
        <a
          key={name}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={name}
          className="home-social-link"
        >
          <Icon />
        </a>
      ))}
    </nav>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/components/SocialRow.test.tsx`
Expected: PASS

- [ ] **Step 5: Add CSS**

Append to `app/globals.css`:

```css
.home-social {
  display: flex;
  justify-content: center;
  gap: 1.25rem;
  margin: 2rem 0 4rem;
}
.home-social-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: 999px;
  color: var(--text-muted);
  opacity: 0.65;
  transition: color 200ms cubic-bezier(0.22, 1, 0.36, 1),
              opacity 200ms cubic-bezier(0.22, 1, 0.36, 1),
              transform 200ms cubic-bezier(0.22, 1, 0.36, 1);
}
.home-social-link:hover {
  color: var(--accent-pink);
  opacity: 1;
  transform: translateY(-2px);
}
.home-social-link:focus-visible {
  outline: 2px solid var(--accent-pink);
  outline-offset: 2px;
  opacity: 1;
}
```

- [ ] **Step 6: Commit**

```bash
git add app/components/home/SocialRow.tsx tests/components/SocialRow.test.tsx app/globals.css
git commit --no-gpg-sign -m "feat(home): SocialRow — github / bmc / instagram / bluesky

Official brand glyphs, monochrome, 44×44 tap targets, quiet by default,
pink-glow on hover. Bluesky points to bsky.app and Instagram to
instagram.com as neutral placeholders pending the project's actual
handles."
```

---

## Task 9: HomeClient rewrite — use AllOrChipsFilter for every axis + novelty as filter

**Files:**
- Modify: `app/components/home/HomeClient.tsx`
- Modify: `app/components/home/StartSessionButton.tsx`
- Modify: `app/globals.css`

- [ ] **Step 1: Rewrite HomeClient**

Replace `app/components/home/HomeClient.tsx` entirely with:

```tsx
"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { IntervalPicker } from "@/app/components/home/IntervalPicker";
import { RepeatModeToggle } from "@/app/components/home/RepeatModeToggle";
import { StartSessionButton } from "@/app/components/home/StartSessionButton";
import { HeroBlock } from "@/app/components/home/HeroBlock";
import { SocialRow } from "@/app/components/home/SocialRow";
import { AllOrChipsFilter, type AllOrChipsOption } from "@/app/components/filters/AllOrChipsFilter";
import { SpeciesAutocomplete } from "@/app/gallery/_components/SpeciesAutocomplete";
import { Tooltip } from "@/app/components/ui/Tooltip";
import { CuteClock, CuteBug, CuteRefresh, SadBug } from "@/app/components/icons";
import { TOOLTIPS } from "@/lib/tooltips";
import type { RepeatMode } from "@/lib/repeat-mode";
import { parseSubject, type SubjectType } from "@/lib/subject";
import type { FacetCount, FacetSnapshot } from "@/lib/queries/facets";

interface Props {
  initialInterval: number;
  initialSubject: SubjectType;
  initialRepeat: RepeatMode;
  initialFacets: FacetSnapshot;
}

function asOptions(items: FacetCount[]): AllOrChipsOption[] {
  return items.map((i) => ({ value: i.name, label: i.name, count: i.count }));
}

function parseList(v: string | null): string[] {
  return v ? v.split(",").filter(Boolean) : [];
}

const SUBJECT_OPTS_BASE = [
  { value: "wild", label: "wild" },
  { value: "specimen", label: "specimen" },
  { value: "captive", label: "captive" },
];

export function HomeClient({ initialInterval, initialSubject, initialRepeat, initialFacets }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [, startTransition] = useTransition();

  const [intervalSec, setIntervalSec] = useState(initialInterval);
  const [novelty, setNovelty] = useState<RepeatMode>(initialRepeat);
  // Multi-select subject (was single-select). "all" is the empty state.
  const initialSubjectList = initialSubject === "all" ? [] : [initialSubject];
  const [subjects, setSubjects] = useState<string[]>(initialSubjectList);
  const [views, setViews] = useState<string[]>(parseList(params.get("view")));
  const [life, setLife] = useState<string[]>(parseList(params.get("life")));
  const [sexes, setSexes] = useState<string[]>(parseList(params.get("sex")));
  const [groups, setGroups] = useState<string[]>(parseList(params.get("type")));
  const [species, setSpecies] = useState<string[]>(parseList(params.get("q")));

  // Push state → URL.
  useEffect(() => {
    const next = new URLSearchParams();
    if (intervalSec !== 60) next.set("interval", String(intervalSec));
    if (novelty !== "default") next.set("repeat", novelty);
    if (subjects.length === 1) next.set("subject", subjects[0]!);
    if (views.length) next.set("view", views.join(","));
    if (life.length) next.set("life", life.join(","));
    if (sexes.length) next.set("sex", sexes.join(","));
    if (groups.length) next.set("type", groups.join(","));
    if (species.length) next.set("q", species.join(","));
    const qs = next.toString();
    const target = qs ? `${pathname}?${qs}` : pathname;
    startTransition(() => {
      router.replace(target, { scroll: false });
    });
  }, [intervalSec, novelty, subjects, views, life, sexes, groups, species, pathname, router]);

  // Faceted snapshot, novelty-aware.
  const [facets, setFacets] = useState<FacetSnapshot>(initialFacets);
  const [facetsLoading, setFacetsLoading] = useState(false);
  const lastFetchKey = useRef<string>("");
  const initialFacetsRef = useRef(initialFacets);
  initialFacetsRef.current = initialFacets;
  useEffect(() => {
    const q = new URLSearchParams();
    q.set("subject", subjects.length === 1 ? subjects[0]! : "all");
    if (views.length) q.set("view", views.join(","));
    if (life.length) q.set("life", life.join(","));
    if (sexes.length) q.set("sex", sexes.join(","));
    if (groups.length) q.set("type", groups.join(","));
    if (species.length) q.set("q", species.join(","));
    q.set("novelty", noveltyToParam(novelty));
    const key = q.toString();
    if (key === lastFetchKey.current) return;
    lastFetchKey.current = key;

    const controller = new AbortController();
    const handle = setTimeout(() => {
      setFacetsLoading(true);
      fetch(`/api/facets?${key}`, { signal: controller.signal })
        .then((r) => r.json())
        .then((d: FacetSnapshot) => setFacets(d))
        .catch((err) => {
          if (err?.name !== "AbortError") setFacets(initialFacetsRef.current);
        })
        .finally(() => {
          if (!controller.signal.aborted) setFacetsLoading(false);
        });
    }, 80);
    return () => { clearTimeout(handle); controller.abort(); };
  }, [subjects, views, life, sexes, groups, species, novelty]);

  const poolCount = facets.total;

  // Subject options carry per-bucket counts from the facets snapshot.
  const subjectOpts: AllOrChipsOption[] = SUBJECT_OPTS_BASE.map((s) => ({
    ...s,
    count: facets.subject[s.value as "wild" | "specimen" | "captive"] ?? 0,
  }));

  // Subject is single-effective-but-stored-as-array for URL compat.
  // Photo type rename: empty/all = no subject filter.
  const subjectTypeForStart = subjects.length === 1 ? (subjects[0] as SubjectType) : "all";

  return (
    <div className="home-wrap">
      <main className="home-main">
        <HeroBlock totalCount={initialFacetsRef.current.total} />

        <div className="home-setup-area">
          <section className="home-section">
            <h2 className="home-section-title">
              <CuteClock size={18} />
              <Tooltip content={TOOLTIPS.interval.content}>
                <span>interval per slide</span>
              </Tooltip>
            </h2>
            <IntervalPicker value={intervalSec} onChange={setIntervalSec} />
          </section>

          <section className="home-section">
            <h2 className="home-section-title">
              <CuteBug size={18} />
              <span>filters</span>
              {/* No tooltip — nothing meaningful to explain. */}
            </h2>
            <div className="home-filter-rows">
              <FilterRow label="photo type">
                <AllOrChipsFilter
                  label="photo type"
                  emptyLabel="all photo types"
                  options={subjectOpts}
                  selected={subjects}
                  onChange={setSubjects}
                />
              </FilterRow>
              <FilterRow label="bug type">
                <AllOrChipsFilter
                  label="bug type"
                  emptyLabel="all bug types"
                  options={asOptions(facets.taxonGroups)}
                  selected={groups}
                  onChange={setGroups}
                />
              </FilterRow>
              <FilterRow label="view">
                <AllOrChipsFilter
                  label="view"
                  emptyLabel="all views"
                  options={asOptions(facets.views)}
                  selected={views}
                  onChange={setViews}
                />
              </FilterRow>
              <FilterRow label="life stage">
                <AllOrChipsFilter
                  label="life stage"
                  emptyLabel="all life stages"
                  options={asOptions(facets.lifeStages)}
                  selected={life}
                  onChange={setLife}
                />
              </FilterRow>
              <FilterRow label="sex">
                <AllOrChipsFilter
                  label="sex"
                  emptyLabel="all sexes"
                  options={asOptions(facets.sexes)}
                  selected={sexes}
                  onChange={setSexes}
                />
              </FilterRow>
              <FilterRow label="species">
                <SpeciesAutocomplete value={species} onChange={setSpecies} />
              </FilterRow>
            </div>
          </section>

          <section className="home-section">
            <h2 className="home-section-title">
              <CuteRefresh size={18} />
              <Tooltip content={TOOLTIPS.repeatMode.content}>
                <span>novelty</span>
              </Tooltip>
            </h2>
            <RepeatModeToggle value={novelty} onChange={setNovelty} />
          </section>
        </div>

        <p className="home-pool-count" aria-live="polite">
          {facetsLoading ? (
            "counting…"
          ) : poolCount === 0 ? (
            <span className="home-pool-empty">
              <SadBug size={22} /> no insects match — try broadening the filters
            </span>
          ) : (
            <>
              <span className="home-pool-count-num">{poolCount.toLocaleString()}</span> bugs in your session pool
            </>
          )}
        </p>

        <div className="home-ctas">
          <StartSessionButton
            intervalSec={intervalSec}
            subjectType={subjectTypeForStart}
            repeatMode={novelty}
            views={views}
            lifeStages={life}
            sexes={sexes}
            species={species}
            groups={groups}
            disabled={poolCount === 0}
          />
          <a href="/gallery" className="home-gallery-link">
            browse the gallery <span aria-hidden>→</span>
          </a>
        </div>

        <SocialRow />
      </main>
    </div>
  );
}

function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="home-filter-row">
      <span className="home-filter-row-label">{label}</span>
      <div className="home-filter-row-control">{children}</div>
    </div>
  );
}

function noveltyToParam(m: RepeatMode): string {
  // URL/RepeatMode values were "default | never-repeat-animals | allow-different-angles".
  // API expects show-everything | never-repeat-species | allow-different-angles.
  if (m === "default") return "show-everything";
  if (m === "never-repeat-animals") return "never-repeat-species";
  return "allow-different-angles";
}
```

- [ ] **Step 2: Add `disabled` prop to StartSessionButton**

Modify `app/components/home/StartSessionButton.tsx` — add `disabled?: boolean` to Props, default false, and pass to the `<button>`:

```ts
interface Props {
  intervalSec: number;
  subjectType: SubjectType;
  repeatMode: RepeatMode;
  views: string[];
  lifeStages: string[];
  sexes: string[];
  groups: string[];
  species: string[];
  disabled?: boolean;
}

// ...
<button type="button" onClick={start} disabled={pending || disabled} className="home-start">
  {pending ? "starting…" : "start session"}
</button>
```

- [ ] **Step 3: Restyle pool count + CTAs + setup area**

Modify `app/globals.css` — replace the `.home-pool-count`, `.home-ctas`, `.home-start`, `.home-gallery-link` blocks and add the new setup-area + filter-row styles:

```css
.home-setup-area {
  position: relative;
  padding: 2rem 1.5rem;
  margin: 0 auto;
  max-width: 40rem;
  border-radius: 1.5rem;
  background:
    radial-gradient(ellipse at top, color-mix(in srgb, var(--accent-pink) 5%, transparent), transparent 60%),
    radial-gradient(ellipse at bottom right, color-mix(in srgb, var(--accent-lilac) 5%, transparent), transparent 60%);
}

.home-section {
  margin: 0 0 1.75rem;
}
.home-section:last-child { margin-bottom: 0; }

.home-section-title {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  font-family: var(--font-serif), serif;
  font-style: italic;
  font-size: 1.1rem;
  font-weight: 500;
  color: var(--accent-lilac);
  margin: 0 0 0.75rem;
}

.home-section-title > svg {
  align-self: center;
  color: var(--accent-pink);
  opacity: 0.85;
}

.home-filter-rows {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.home-filter-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  min-height: 2.5rem;
}

.home-filter-row-label {
  flex: 0 0 5.5rem;
  font-size: 0.9rem;
  opacity: 0.75;
  text-align: right;
}

.home-filter-row-control {
  flex: 1;
  min-width: 0;
}

.home-pool-count {
  text-align: center;
  margin: 1.5rem 0 1rem;
  font-size: 1.05rem;
  font-variant-numeric: tabular-nums;
}
.home-pool-count-num {
  color: var(--accent-pink);
  font-weight: 600;
}
.home-pool-empty {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  color: var(--text-muted);
  font-style: italic;
}

.home-ctas {
  display: flex;
  justify-content: center;
  gap: 1rem;
  margin: 1rem auto 0;
  flex-wrap: wrap;
}

.home-start,
.home-gallery-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.85rem 1.75rem;
  font-family: var(--font-serif), serif;
  font-style: italic;
  font-size: 1.1rem;
  font-weight: 500;
  border-radius: 999px;
  cursor: pointer;
  text-decoration: none;
  transition: transform 200ms cubic-bezier(0.22, 1, 0.36, 1),
              box-shadow 200ms cubic-bezier(0.22, 1, 0.36, 1);
  border: 2px solid var(--accent-pink);
}

.home-start {
  background: var(--accent-pink);
  color: var(--surface-0);
  box-shadow: 0 0 24px color-mix(in srgb, var(--accent-pink) 50%, transparent);
}
.home-start:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 0 32px color-mix(in srgb, var(--accent-pink) 70%, transparent);
}
.home-start:disabled { opacity: 0.5; cursor: not-allowed; }

.home-gallery-link {
  background: transparent;
  color: var(--accent-pink);
}
.home-gallery-link:hover {
  transform: translateY(-2px);
  background: color-mix(in srgb, var(--accent-pink) 12%, transparent);
}
```

- [ ] **Step 4: Run tsc**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Run unit tests**

Run: `npx vitest run`
Expected: PASS (all existing tests + new ones).

- [ ] **Step 6: Visual smoke check via dev server**

Run: `curl -s http://localhost:3000/ -o /dev/null -w "%{http_code} %{time_total}s\n"`
Expected: `200` and <1s. Then open in a real browser and confirm:
  - Hero is centered, tagline shows formatted count
  - Setup area has soft ambient gradient
  - Six filter rows, each with its `all X · N ⌄` chip
  - Pool count shows "X bugs in your session pool"
  - Both CTAs have matching pill shape
  - Social row at bottom

- [ ] **Step 7: Commit**

```bash
git add app/components/home/HomeClient.tsx app/components/home/StartSessionButton.tsx app/globals.css
git commit --no-gpg-sign -m "feat(home): rewrite to AllOrChipsFilter rows + paired CTAs + social

- Six filter rows, all using the unified AllOrChipsFilter
- Subject becomes multi-select photo type (wild/specimen/captive; empty=all)
- Novelty (was 'repeat behavior') flows through facets API for truthful count
- Section titles get cute icons (clock/bug/refresh)
- Pool count moves above CTAs; sad-bug doodle on empty
- Start session + browse gallery share pill shape, distinguished by fill
- Social row (github/bmc/instagram/bluesky) below CTAs"
```

---

## Task 10: Repeat-mode label rename + reorder

**Files:**
- Modify: `lib/tooltips.tsx` (rename the tooltip key and copy)
- Modify: `app/components/home/RepeatModeToggle.tsx` (verify order: show everything → never repeat species → same species different angles; relabel if needed)

- [ ] **Step 1: Update tooltip key and copy**

Modify `lib/tooltips.tsx` — find the `repeatMode` tooltip entry and update the copy to match the spec's order (show everything → never repeat species → same species, different angles). Keep the `repeatMode` key for code compatibility; only the visible text changes.

```tsx
repeatMode: {
  content: (
    <>
      <p>How sessions handle repeated subjects:</p>
      <ul>
        <li><strong>show everything</strong> — every photo, repeats included</li>
        <li><strong>never repeat species</strong> — never see the same species twice</li>
        <li><strong>same species, different angles</strong> — multi-angle specimen sets</li>
      </ul>
    </>
  ),
},
```

- [ ] **Step 2: Verify RepeatModeToggle option order**

Open `app/components/home/RepeatModeToggle.tsx`. Confirm the array of `{ value, label, hint }` entries is ordered:
1. `default` / "show everything" / "every photo, repeats included"
2. `never-repeat-animals` / "never repeat species" / "never see the same species twice"
3. `allow-different-angles` / "same species, different angles" / "multi-angle specimen sets"

If labels say "one per species" anywhere, change to "never repeat species" to match the tooltip.

- [ ] **Step 3: Run tests**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add lib/tooltips.tsx app/components/home/RepeatModeToggle.tsx
git commit --no-gpg-sign -m "chore(home): align novelty labels + tooltip order with UI order"
```

---

## Task 11: Delete dead filter components

**Files:**
- Delete: `app/components/filters/FilterBar.tsx`
- Delete: `app/components/filters/FilterPopover.tsx`
- Delete: `app/components/filters/TaxonGroupChips.tsx`
- Verify deletions don't break imports

- [ ] **Step 1: Search for any remaining imports**

Run:
```bash
grep -rn "FilterBar\|FilterPopover\|TaxonGroupChips" app/ tests/ --include="*.ts" --include="*.tsx" | grep -v "AllOrChipsFilter"
```

Expected: ONLY references in the gallery components (Phase C will redo those — leave alone) and in test files we're about to delete.

If there are home-page references still, fix them before deleting.

- [ ] **Step 2: Delete the components**

```bash
git rm app/components/filters/FilterBar.tsx
git rm app/components/filters/FilterPopover.tsx
git rm app/components/filters/TaxonGroupChips.tsx
```

(If `FilterPopover` is still used by gallery, skip its deletion and revisit in Phase C.)

- [ ] **Step 3: Delete related tests if any are home-specific**

```bash
ls tests/components/ | grep -E "FilterBar|FilterPopover|TaxonGroup"
```
Delete any results.

- [ ] **Step 4: Run tsc + unit tests**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A
git commit --no-gpg-sign -m "chore(filters): delete FilterBar / FilterPopover / TaxonGroupChips

Replaced by AllOrChipsFilter. Gallery still uses these — Phase C deletes
its copies separately."
```

(Adjust the `git add` if Phase C-needed files were skipped above.)

---

## Task 12: E2E test for home flow

**Files:**
- Create: `tests/e2e/home-redesign.spec.ts`

- [ ] **Step 1: Write the e2e spec**

Create `tests/e2e/home-redesign.spec.ts`:

```ts
import { test, expect } from "@playwright/test";

test.describe("home redesign", () => {
  test("hero shows centered title + dynamic tagline with count", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("line of bugs");
    const tagline = page.locator(".home-tagline");
    await expect(tagline).toContainText(/insects, tenderly photographed/);
    await expect(tagline).toContainText(/\d{2,}/); // formatted count present
  });

  test("filter rows render with all-or-chips empty state", async ({ page }) => {
    await page.goto("/");
    for (const label of ["all photo types", "all bug types", "all views", "all life stages", "all sexes"]) {
      await expect(page.getByRole("combobox", { name: new RegExp(label, "i") })).toBeVisible();
    }
  });

  test("selecting a bug type narrows the pool count", async ({ page }) => {
    await page.goto("/");
    const poolText = () => page.locator(".home-pool-count").innerText();
    const before = await poolText();
    await page.getByRole("combobox", { name: /all bug types/i }).click();
    await page.getByRole("option", { name: /butterflies/i }).click();
    // Wait for facets to refetch
    await page.waitForResponse((r) => r.url().includes("/api/facets") && r.status() === 200);
    const after = await poolText();
    expect(after).not.toBe(before);
    expect(after).toContain("bugs in your session pool");
  });

  test("novelty change updates the pool count number", async ({ page }) => {
    await page.goto("/");
    const before = await page.locator(".home-pool-count-num").innerText();
    // Click 'never repeat species' radio
    await page.getByRole("radio", { name: /never repeat species/i }).click();
    await page.waitForResponse((r) => r.url().includes("/api/facets"));
    const after = await page.locator(".home-pool-count-num").innerText();
    expect(after).not.toBe(before);
  });

  test("start session and browse gallery look like a paired CTA", async ({ page }) => {
    await page.goto("/");
    const start = page.getByRole("button", { name: /start session/i });
    const gallery = page.getByRole("link", { name: /browse the gallery/i });
    await expect(start).toBeVisible();
    await expect(gallery).toBeVisible();
    // Same height (visual parity)
    const startBox = await start.boundingBox();
    const galleryBox = await gallery.boundingBox();
    expect(Math.abs((startBox?.height ?? 0) - (galleryBox?.height ?? 0))).toBeLessThan(2);
  });

  test("social row has four links opening in new tabs", async ({ page }) => {
    await page.goto("/");
    const links = page.locator(".home-social-link");
    await expect(links).toHaveCount(4);
    for (let i = 0; i < 4; i++) {
      await expect(links.nth(i)).toHaveAttribute("target", "_blank");
    }
  });
});
```

- [ ] **Step 2: Run the spec**

Run: `npx playwright test tests/e2e/home-redesign.spec.ts --reporter=line`
Expected: PASS (6 tests)

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/home-redesign.spec.ts
git commit --no-gpg-sign -m "test(e2e): home redesign — chips, counts, paired CTAs, social row"
```

---

## Final verification

- [ ] **Step 1: Full test suite**

Run: `npx vitest run && npx playwright test --reporter=line`
Expected: all green.

- [ ] **Step 2: tsc clean**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Build clean**

Run: `npm run build 2>&1 | tail -20`
Expected: no errors; build succeeds.

- [ ] **Step 4: Visual MCP audit**

Open `/` in Playwright MCP at 1440×900 and 375×667 (desktop + mobile). Screenshot. Confirm:
- Hero centered with flower
- Setup area with 3 sections + cute icons
- Six filter rows
- Empty-chip pulse visible on first load (`prefers-reduced-motion: no-preference`)
- Pool count above CTAs
- CTAs paired
- Social row at bottom

If anything looks off, fix and re-commit before moving to /audit + /delight passes.
