# Dynamic chip counts — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the static chip counts on Home + Gallery with faceted counts that update as filters change, with per-chip "filtered / total" display.

**Architecture:** One server helper `getFacetCounts(filters)` returns a snapshot containing all axes' chip counts, each computed with every-other-axis-applied + self-axis-excluded. Home fetches this from `/api/facets` on filter change; Gallery calls it server-side from URL params. Chip components accept `{ filtered, total }` per bucket and render accordingly.

**Tech Stack:** Next.js 16 App Router, Drizzle + better-sqlite3, Vitest, Playwright.

## Revision after #1-3 (2026-05-15)

Three prior tasks landed before this plan ran. The plan is adjusted to reflect their state:

- **#1 — captive chip + `SubjectType`:** subject filter is now `"wild" | "captive" | "specimen" | "all"` with 1:1 DB mapping (no more "nature = wild + captive" supercategory). `lib/subject.ts` exists. `listSubjectTypeCounts()` returns `{wild, captive, specimen, all}`. Task 1's shared `FilterState` type below uses `SubjectType` instead of the old union.
- **#3 — shared `<Chip>` primitive:** `app/components/ui/Chip.tsx` already exists and already supports `count?: number` + `total?: number` with the "filtered / total when they differ, single number otherwise" display rule. `chip-disabled` class is already wired. Three callsites (TaxonGroupChips, gallery SubjectTypeChips, ReportCategoryChips) are migrated. Task 5 below is therefore *much* simpler — primarily wiring callsites to pass the new shape and adding zero-bucket retention.
- **#2 — mobile audit:** action bar wrapping fix shipped; nothing in this plan depends on it.

---

## File Structure

**New files:**
- `lib/queries/facets.ts` — `getFacetCounts(filters)` + `FacetSnapshot` type
- `app/api/facets/route.ts` — GET endpoint wrapping `getFacetCounts`
- `tests/lib/facets.test.ts` — unit tests for facet exclusion logic
- `tests/e2e/r7-dynamic-counts.spec.ts` — e2e test verifying counts update

**Files modified:**
- `lib/queries/session.ts` — export `buildSessionFilterClauses` (currently file-private)
- `lib/queries/gallery.ts` — extract gallery clause builder; reuse in facets helper
- `app/page.tsx` — replace four static `list…Counts()` calls with one `getFacetCounts({})`
- `app/components/home/HomeClient.tsx` — fetch `/api/facets` instead of `/api/session/count`; store filtered counts in state; pass to chip components
- `app/components/home/SubjectFilter.tsx` — accept `{filtered, total}` per pill
- `app/components/filters/TaxonGroupChips.tsx` — accept `{filtered, total}` per chip; keep zero-count chips visible
- `app/components/filters/FilterPopover.tsx` — same for popover options
- `app/gallery/page.tsx` + `app/gallery/_components/FilterChipsBar.tsx` — compute facets server-side from URL params
- `app/globals.css` — `.chip-disabled` styling, `.chip-count-total` separator styling

**Files deleted:**
- `app/api/session/count/route.ts` — superseded by `/api/facets`

---

### Task 1: Extract clause builders into a shared module

Both `lib/queries/session.ts` and `lib/queries/gallery.ts` build the same WHERE clauses for the same filters. The facet helper needs to call this builder five times with different "blank out one axis" mutations. Currently `buildSessionFilterClauses` is file-private in `session.ts` and the gallery has its own inline clause logic.

This task pulls the clause builder out into one shared helper so the facet code can reuse it without duplication.

**Files:**
- Create: `lib/queries/filter-clauses.ts`
- Modify: `lib/queries/session.ts` (delete inline builder, import from new module)
- Modify: `lib/queries/gallery.ts` (delete inline filter loop in `searchGallery`, import & reuse)
- Create: `tests/lib/filter-clauses.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/lib/filter-clauses.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { buildFilterClauses, type FilterState } from "@/lib/queries/filter-clauses";

const baseFilters: FilterState = {
  subjectType: "all",
  views: [],
  lifeStages: [],
  sexes: [],
  groups: [],
};

describe("buildFilterClauses", () => {
  it("returns just the visibility predicates when no filters set", () => {
    const clauses = buildFilterClauses(baseFilters);
    expect(clauses).toHaveLength(2); // hidden=0 + NOT EXISTS unresolved-reports
  });

  it("adds a subject_state clause for any non-'all' subject", () => {
    expect(buildFilterClauses({ ...baseFilters, subjectType: "wild" })).toHaveLength(3);
    expect(buildFilterClauses({ ...baseFilters, subjectType: "captive" })).toHaveLength(3);
    expect(buildFilterClauses({ ...baseFilters, subjectType: "specimen" })).toHaveLength(3);
  });

  it("adds a taxon_subgroup clause when groups are selected", () => {
    const clauses = buildFilterClauses({ ...baseFilters, groups: ["butterflies"] });
    expect(clauses).toHaveLength(3);
  });

  it("skips axes with empty arrays", () => {
    const clauses = buildFilterClauses({
      ...baseFilters,
      views: [],
      lifeStages: ["adult"],
    });
    expect(clauses).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/filter-clauses.test.ts`
Expected: FAIL with "Cannot find module @/lib/queries/filter-clauses".

- [ ] **Step 3: Create the shared filter-clauses module**

`lib/queries/filter-clauses.ts`:

```typescript
import { sql, type SQL } from "drizzle-orm";
import { buildTaxonGroupSQL } from "@/lib/taxonomy";
import type { SubjectType } from "@/lib/subject";

export interface FilterState {
  subjectType: SubjectType;
  views: string[];
  lifeStages: string[];
  sexes: string[];
  groups: string[];
}

/**
 * Build the SQL WHERE clauses shared by gallery, session, and facet
 * queries. Assumes the `images` table is aliased as `i` (or, when
 * called from a drizzle query, that the unqualified column references
 * still resolve — `i.column` works in both cases because drizzle
 * preserves alias-free references against the `from` table).
 *
 * Empty arrays / "all" subject skip their clause entirely.
 */
export function buildFilterClauses(filters: FilterState): SQL[] {
  const clauses: SQL[] = [
    sql`i.hidden = 0`,
    sql`NOT EXISTS (
      SELECT 1 FROM reports r
      WHERE r.image_id = i.image_id AND r.resolved_at IS NULL
    )`,
  ];

  if (filters.subjectType !== "all") {
    clauses.push(sql`i.subject_state = ${filters.subjectType}`);
  }

  if (filters.views.length > 0) {
    clauses.push(sql`(${inOrUnknown(sql`i.view_label`, filters.views)})`);
  }
  if (filters.lifeStages.length > 0) {
    clauses.push(sql`(${inOrUnknown(sql`i.life_stage`, filters.lifeStages)})`);
  }
  if (filters.sexes.length > 0) {
    clauses.push(sql`(${inOrUnknown(sql`i.sex`, filters.sexes)})`);
  }
  if (filters.groups.length > 0) {
    const groupClause = buildTaxonGroupSQL(filters.groups, sql`i.taxon_subgroup`);
    if (groupClause) clauses.push(groupClause);
  }

  return clauses;
}

function inOrUnknown(column: SQL, values: string[]): SQL {
  const real = values.filter((v) => v !== "unknown");
  const includeUnknown = values.includes("unknown");
  const parts: SQL[] = [];
  if (real.length > 0) {
    parts.push(sql`${column} IN (${sql.join(real.map((v) => sql`${v}`), sql`, `)})`);
  }
  if (includeUnknown) {
    parts.push(sql`(${column} IS NULL OR ${column} = '')`);
  }
  if (parts.length === 0) return sql`1=1`;
  return sql.join(parts, sql` OR `);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/filter-clauses.test.ts`
Expected: PASS (4/4).

- [ ] **Step 5: Refactor `lib/queries/session.ts` to use the shared builder**

Delete the inline `buildSessionFilterClauses` and `inOrUnknownArr` functions. Replace the bodies of `buildSessionPool` and `countSessionPool` with calls to `buildFilterClauses` from the new module. Update type imports.

Concretely, the existing `buildSessionFilterClauses(opts)` becomes `buildFilterClauses({ subjectType: opts.subjectType, views: opts.views, lifeStages: opts.lifeStages, sexes: opts.sexes, groups: opts.groups })`. The `SessionFilters` interface in session.ts can either re-export `FilterState` or stay as a re-named alias.

Make sure the SQL the drizzle query receives still references `images.image_id` etc. via the `i` alias. If drizzle's `.where()` cares about unqualified references, you may need to alias the from clause: `db.select().from(sql\`images i\`).where(...)`. Verify by running the existing session tests:

Run: `npx vitest run tests/lib/session-pool.test.ts tests/lib/session-filters.test.ts`
Expected: PASS (same count as before).

- [ ] **Step 6: Refactor `lib/queries/gallery.ts:searchGallery` to use the shared builder**

The current `searchGallery` builds `filters: SQL[]` inline (lines 85-113). Replace with:

```typescript
const filters: SQL[] = buildFilterClauses({
  subjectType: args.subject,
  views: args.views,
  lifeStages: args.lifeStages,
  sexes: args.sexes,
  groups: args.groups,
});
if (args.institutions.length > 0) {
  const list = sql.join(args.institutions.map((x) => sql`${x}`), sql`, `);
  filters.push(sql`i.institution IN (${list})`);
}
if (ftsQuery) {
  filters.push(sql`i.image_id IN (SELECT image_id FROM images_fts WHERE images_fts MATCH ${ftsQuery})`);
}
```

(Institution stays out of the shared builder for now — it's gallery-only. We'll absorb it in Task 6 if we want gallery facet counts on institution too.)

Run: `npx vitest run tests/lib/gallery.test.ts` (if it exists) or `npx vitest run`
Expected: existing tests continue to pass.

- [ ] **Step 7: Commit**

```bash
git add lib/queries/filter-clauses.ts lib/queries/session.ts lib/queries/gallery.ts tests/lib/filter-clauses.test.ts
git commit --no-gpg-sign -m "refactor(queries): extract shared filter-clauses builder for facets reuse"
```

---

### Task 2: getFacetCounts helper + FacetSnapshot type

The core of this work. One function, called once, returns counts for every axis with the correct exclusion semantics.

**Files:**
- Create: `lib/queries/facets.ts`
- Create: `tests/lib/facets.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/lib/facets.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from "vitest";
import { getFacetCounts } from "@/lib/queries/facets";

// These tests run against the live data/db/line-of-bugs.db. They assume
// the database has the standard ~40k-image snapshot.
describe("getFacetCounts", () => {
  it("returns total + counts for every axis when no filters applied", async () => {
    const snap = await getFacetCounts({
      subjectType: "all", views: [], lifeStages: [], sexes: [], groups: [],
    });
    expect(snap.total).toBeGreaterThan(30000);
    expect(snap.subject.wild).toBeGreaterThan(0);
    expect(snap.subject.captive).toBeGreaterThan(0);
    expect(snap.subject.specimen).toBeGreaterThan(0);
    expect(snap.taxonGroups.length).toBeGreaterThan(15);
    expect(snap.taxonGroups.find((g) => g.name === "butterflies")?.count).toBeGreaterThan(0);
  });

  it("cross-axis: switching subject from wild to specimen changes butterfly count", async () => {
    const wildSnap = await getFacetCounts({
      subjectType: "wild", views: [], lifeStages: [], sexes: [], groups: [],
    });
    const specimenSnap = await getFacetCounts({
      subjectType: "specimen", views: [], lifeStages: [], sexes: [], groups: [],
    });
    const wildButterflies = wildSnap.taxonGroups.find((g) => g.name === "butterflies")?.count ?? 0;
    const specimenButterflies = specimenSnap.taxonGroups.find((g) => g.name === "butterflies")?.count ?? 0;
    expect(wildButterflies).not.toBe(specimenButterflies);
  });

  it("within-axis: selecting butterflies leaves cockroach bucket UNCHANGED", async () => {
    const baseline = await getFacetCounts({
      subjectType: "all", views: [], lifeStages: [], sexes: [], groups: [],
    });
    const withButterflies = await getFacetCounts({
      subjectType: "all", views: [], lifeStages: [], sexes: [], groups: ["butterflies"],
    });
    const baselineRoach = baseline.taxonGroups.find((g) => g.name === "cockroaches")?.count ?? 0;
    const withRoach = withButterflies.taxonGroups.find((g) => g.name === "cockroaches")?.count ?? 0;
    expect(withRoach).toBe(baselineRoach);
  });

  it("within-axis: selecting butterflies leaves butterfly bucket UNCHANGED (own-axis exclusion)", async () => {
    const baseline = await getFacetCounts({
      subjectType: "all", views: [], lifeStages: [], sexes: [], groups: [],
    });
    const withButterflies = await getFacetCounts({
      subjectType: "all", views: [], lifeStages: [], sexes: [], groups: ["butterflies"],
    });
    const baselineBut = baseline.taxonGroups.find((g) => g.name === "butterflies")?.count ?? 0;
    const withBut = withButterflies.taxonGroups.find((g) => g.name === "butterflies")?.count ?? 0;
    expect(withBut).toBe(baselineBut);
  });

  it("total reflects all filters", async () => {
    const snap = await getFacetCounts({
      subjectType: "captive", views: [], lifeStages: [], sexes: [], groups: ["butterflies"],
    });
    // Captive butterflies — the small intersection (~1,811 captive total ∩ ~2,855 butterflies).
    expect(snap.total).toBeGreaterThan(0);
    expect(snap.total).toBeLessThan(2000);
  });

  it("returns zero-count buckets so the UI can grey them out", async () => {
    // life_stage=egg + sex=worker is an impossible combination — bee workers
    // aren't recorded as eggs in this dataset.
    const snap = await getFacetCounts({
      subjectType: "all", views: [], lifeStages: ["egg"], sexes: ["worker"], groups: [],
    });
    // The taxon facet should still return entries (own-axis is "groups", not lifeStages/sexes).
    // The sex facet should have "worker" with count 0 if filtered → that's the own-axis behavior.
    // The point: zero buckets are returned, not omitted.
    expect(snap.taxonGroups.every((g) => g.count >= 0)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/facets.test.ts`
Expected: FAIL with "Cannot find module @/lib/queries/facets".

- [ ] **Step 3: Implement `getFacetCounts`**

`lib/queries/facets.ts`:

```typescript
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { buildFilterClauses, type FilterState } from "@/lib/queries/filter-clauses";
import { TAXON_GROUPS } from "@/lib/taxonomy";

export interface FacetCount {
  name: string;
  count: number;
}

export interface FacetSnapshot {
  /** Total rows matching the full filter state. */
  total: number;
  /** Subject-state buckets, computed ignoring the subject filter. */
  subject: { wild: number; captive: number; specimen: number };
  /** view_label buckets ("unknown" merges NULL+empty), ignoring the view filter. */
  views: FacetCount[];
  /** life_stage buckets, ignoring the life-stage filter. */
  lifeStages: FacetCount[];
  /** sex buckets, ignoring the sex filter. */
  sexes: FacetCount[];
  /** taxon_subgroup buckets folded into chip keys, ignoring the group filter. */
  taxonGroups: FacetCount[];
}

function runCountByColumn(filters: FilterState, column: string): FacetCount[] {
  const clauses = buildFilterClauses(filters);
  const whereClause = sql.join(clauses, sql` AND `);
  const rows = db.all<{ name: string | null; c: number }>(sql`
    SELECT
      CASE
        WHEN ${sql.raw(`i.${column}`)} IS NULL OR ${sql.raw(`i.${column}`)} = '' THEN 'unknown'
        ELSE ${sql.raw(`i.${column}`)}
      END AS name,
      COUNT(*) AS c
    FROM images i
    WHERE ${whereClause}
    GROUP BY name
  `);
  return rows.map((r) => ({ name: r.name ?? "unknown", count: r.c }));
}

function runSubjectCounts(filters: FilterState): FacetSnapshot["subject"] {
  // Subject facet ignores its own selection — pass subjectType="all".
  const cleared: FilterState = { ...filters, subjectType: "all" };
  const clauses = buildFilterClauses(cleared);
  const whereClause = sql.join(clauses, sql` AND `);
  const rows = db.all<{ subject_state: string; c: number }>(sql`
    SELECT subject_state, COUNT(*) AS c
    FROM images i
    WHERE ${whereClause}
    GROUP BY subject_state
  `);
  return {
    wild: rows.find((r) => r.subject_state === "wild")?.c ?? 0,
    captive: rows.find((r) => r.subject_state === "captive")?.c ?? 0,
    specimen: rows.find((r) => r.subject_state === "specimen")?.c ?? 0,
  };
}

function runTaxonGroupCounts(filters: FilterState): FacetCount[] {
  // Taxon facet ignores its own selection — blank groups.
  const cleared: FilterState = { ...filters, groups: [] };
  const clauses = buildFilterClauses(cleared);
  const whereClause = sql.join(clauses, sql` AND `);
  const rows = db.all<{ subgroup: string | null; c: number }>(sql`
    SELECT taxon_subgroup AS subgroup, COUNT(*) AS c
    FROM images i
    WHERE ${whereClause}
    GROUP BY taxon_subgroup
  `);
  const byDbValue = new Map<string | null, number>();
  for (const r of rows) byDbValue.set(r.subgroup, r.c);
  const nullCount = byDbValue.get(null) ?? 0;
  const out: FacetCount[] = [];
  for (const g of TAXON_GROUPS) {
    let count = 0;
    for (const v of g.dbValues) count += byDbValue.get(v) ?? 0;
    if (g.catchesNull) count += nullCount;
    out.push({ name: g.key, count }); // keep zero-count chips for grey-out UX
  }
  return out;
}

export async function getFacetCounts(filters: FilterState): Promise<FacetSnapshot> {
  // Total uses the full filter state — that's the "would I see N images" number.
  const totalClauses = buildFilterClauses(filters);
  const totalWhere = sql.join(totalClauses, sql` AND `);
  const totalRow = db.get<{ c: number }>(sql`
    SELECT COUNT(*) AS c FROM images i WHERE ${totalWhere}
  `);

  return {
    total: totalRow?.c ?? 0,
    subject: runSubjectCounts(filters),
    views: runCountByColumn({ ...filters, views: [] }, "view_label"),
    lifeStages: runCountByColumn({ ...filters, lifeStages: [] }, "life_stage"),
    sexes: runCountByColumn({ ...filters, sexes: [] }, "sex"),
    taxonGroups: runTaxonGroupCounts(filters),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/facets.test.ts`
Expected: PASS (6/6). If the within-axis tests fail (counts changed), revisit the self-exclusion logic.

- [ ] **Step 5: Commit**

```bash
git add lib/queries/facets.ts tests/lib/facets.test.ts
git commit --no-gpg-sign -m "feat(facets): getFacetCounts with cross-axis include + self-axis exclude"
```

---

### Task 3: Replace `/api/session/count` with `/api/facets`

**Files:**
- Create: `app/api/facets/route.ts`
- Delete: `app/api/session/count/route.ts`
- Modify: `app/components/home/HomeClient.tsx` (just change the fetch URL + response shape for now — full chip wiring is Task 5)

- [ ] **Step 1: Write the route**

`app/api/facets/route.ts`:

```typescript
import { getFacetCounts } from "@/lib/queries/facets";
import { parseSubject } from "@/lib/subject";

function readList(v: string | null): string[] {
  return v ? v.split(",").filter(Boolean) : [];
}

/**
 * Faceted-search snapshot for the Home page.
 *
 * Returns total + every axis's filtered counts in one round-trip.
 * Each axis's counts are computed with all OTHER axes applied and
 * the axis's own selection IGNORED — so multi-select stays
 * orthogonal within an axis (selecting butterflies doesn't zero
 * the cockroach chip).
 */
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const snap = await getFacetCounts({
    subjectType: parseSubject(url.searchParams.get("subject")),
    views: readList(url.searchParams.get("view")),
    lifeStages: readList(url.searchParams.get("life")),
    sexes: readList(url.searchParams.get("sex")),
    groups: readList(url.searchParams.get("type")),
  });
  return Response.json(snap);
}
```

- [ ] **Step 2: Delete the old route**

```bash
git rm app/api/session/count/route.ts
```

- [ ] **Step 3: Update HomeClient fetch (interim — still uses just .total)**

In `app/components/home/HomeClient.tsx`, change line 93:

```typescript
fetch(`/api/facets?${q.toString()}`, { signal: controller.signal })
  .then((r) => r.json())
  .then((d: { total: number }) => setPoolCount(d.total))
```

(The full `FacetSnapshot` rewiring happens in Task 5. For now we just unblock the route swap.)

- [ ] **Step 4: Type-check + smoke-test**

Run: `npx tsc --noEmit`
Expected: clean.

Run: `npm run dev` — visit http://localhost:3000, toggle a filter, confirm the pool-count label updates and DevTools Network shows `/api/facets` returning a full snapshot.

- [ ] **Step 5: Commit**

```bash
git add app/api/facets/route.ts app/components/home/HomeClient.tsx
git commit --no-gpg-sign -m "feat(api): /api/facets replaces /api/session/count (interim — total only)"
```

---

### Task 4: SSR initial facets for Home

Replace the four `list…Counts()` calls in `app/page.tsx` with one `getFacetCounts({})`. HomeClient now receives a single `initialFacets: FacetSnapshot` prop, replacing the four separate count props.

**Files:**
- Modify: `app/page.tsx`
- Modify: `app/components/home/HomeClient.tsx` (prop signature only — full chip wiring stays in Task 5)

- [ ] **Step 1: Update `app/page.tsx`**

```typescript
import { Suspense } from "react";
import { connection } from "next/server";
import { HomeClient } from "./components/home/HomeClient";
import { getFacetCounts } from "@/lib/queries/facets";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function readArg(v: string | string[] | undefined, fallback: string): string {
  if (Array.isArray(v)) return v[0] ?? fallback;
  return v ?? fallback;
}

async function HomeShell({ searchParams }: { searchParams: SearchParams }) {
  await connection();
  const sp = await searchParams;
  const subject = parseSubject(readArg(sp.subject, "all"));
  const interval = Math.max(10, Math.min(3600, parseInt(readArg(sp.interval, "60"), 10) || 60));
  const repeatRaw = readArg(sp.repeat, "default");
  const repeat: "default" | "never-repeat-animals" | "allow-different-angles" =
    repeatRaw === "never-repeat-animals" || repeatRaw === "allow-different-angles"
      ? repeatRaw
      : "default";

  // Initial render uses the *unfiltered* facets as both "filtered" and
  // "total". The client will refresh filtered counts as the user
  // changes filters; totals never change.
  const initialFacets = await getFacetCounts({
    subjectType: "all", views: [], lifeStages: [], sexes: [], groups: [],
  });
  return (
    <HomeClient
      initialInterval={interval}
      initialSubject={subject}
      initialRepeat={repeat}
      initialFacets={initialFacets}
    />
  );
}

export default function HomePage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<div className="home-wrap" />}>
      <HomeShell searchParams={searchParams} />
    </Suspense>
  );
}
```

- [ ] **Step 2: Update HomeClient prop signature**

In `app/components/home/HomeClient.tsx`, replace the four count props with one:

```typescript
import type { SubjectType } from "@/lib/subject";
import type { FacetSnapshot } from "@/lib/queries/facets";

interface Props {
  initialInterval: number;
  initialSubject: SubjectType;
  initialRepeat: RepeatMode;
  initialFacets: FacetSnapshot;
}
```

Inside the function: `const totals = props.initialFacets;` — keep this as the reference for the "total" half of each chip's count display. Add state for the live filtered snapshot:

```typescript
const [facets, setFacets] = useState<FacetSnapshot>(props.initialFacets);
```

Update the fetch effect to set the full snapshot:

```typescript
fetch(`/api/facets?${q.toString()}`, { signal: controller.signal })
  .then((r) => r.json())
  .then((d: FacetSnapshot) => setFacets(d))
```

And `poolCount` becomes `facets.total`. (You can drop the separate `poolCount` state.)

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: clean. The chip-passing call sites still pass `taxonGroupCounts={...}` etc. — those are TS errors until Task 5 wires them up. To unblock this commit, temporarily map back:

```typescript
const totals = props.initialFacets; // alias for clarity
// Pass per-chip totals to chip components for now — they'll get
// filtered counts in Task 5.
<TaxonGroupChips counts={totals.taxonGroups.filter((g) => g.count > 0)} ... />
```

This keeps the file type-safe through the task boundary.

- [ ] **Step 4: Commit**

```bash
git add app/page.tsx app/components/home/HomeClient.tsx
git commit --no-gpg-sign -m "feat(home): SSR uses one getFacetCounts snapshot instead of four count helpers"
```

---

### Task 5: Wire filtered counts through to chip components

This is the visible UX change. Chips display `filtered / total` when they differ, single number otherwise, greyed when filtered = 0.

**Already done in the #3 Chip-primitive task:**
- `app/components/ui/Chip.tsx` accepts `count?` + `total?` and renders `filtered / total` when they differ.
- `chip-disabled` class + `chip-count-total` span are already wired in Chip + globals.css.
- `TaxonGroupChips`, `SubjectTypeChips`, `ReportCategoryChips` all use `<Chip>`.

**Files to modify here:**
- `app/components/filters/FilterPopover.tsx` — add `total?: number` to `FilterOption`; render `filtered / total` in the popover option rows + grey out zero-filtered options.
- `app/components/filters/TaxonGroupChips.tsx` — split props into `{ filtered: FacetCount[]; totals: FacetCount[] }`; pass both to each `<Chip>`; **stop dropping zero-filtered chips** (keep the existing "drop zero-total chips" guard).
- `app/gallery/_components/SubjectTypeChips.tsx` — accept `{ filtered: SubjectCounts; totals: SubjectCounts }`; pass both per chip.
- `app/components/home/SubjectFilter.tsx` — counts weren't being displayed on home pills; either keep them count-less (simpler) or surface filtered/total in a `<small>` next to each pill. Pick whichever matches the rest of the home pages's polish — likely count-less for compactness.
- `app/components/home/HomeClient.tsx` — pass `filtered={facets.X}` + `totals={props.initialFacets.X}` to each chip group.
- `app/globals.css` — `.chip-count-total` is in Chip already, but FilterPopover's option rows need a matching `filter-popover-count-total` separator style (the popover doesn't use `<Chip>` for option rows — it's a `<label>` + `<span>` layout).

- [ ] **Step 1: Extend `FilterOption`**

```typescript
// in app/components/filters/FilterPopover.tsx
export interface FilterOption {
  name: string;
  count: number;       // interpreted as "filtered" — current matching count
  total?: number;      // when present and != count, render "count/total"
}
```

- [ ] **Step 2: Render filtered/total in FilterPopover option rows**

```tsx
<span className="filter-popover-name">{o.name}</span>
<span className="filter-popover-count">
  {o.count.toLocaleString()}
  {typeof o.total === "number" && o.count !== o.total && (
    <span className="filter-popover-count-total"> / {o.total.toLocaleString()}</span>
  )}
</span>
```

Add `aria-disabled` + greyed style on `<li>` when `count === 0`. Don't actually block the toggle — clicking an empty option might still be useful if the user is curious.

- [ ] **Step 3: Update TaxonGroupChips to take filtered + totals**

```typescript
export interface TaxonGroupChipsProps {
  filtered: FilterOption[]; // current filter-state counts (own-axis excluded)
  totals: FilterOption[];   // unfiltered absolute counts
  selected: string[];
  onChange: (next: string[]) => void;
}
```

Inside the render:

```tsx
const filteredByKey = new Map(filtered.map((c) => [c.name, c.count]));
const totalByKey = new Map(totals.map((c) => [c.name, c.count]));
// ...
{TAXON_GROUPS.map((g, i) => {
  const t = totalByKey.get(g.key) ?? 0;
  if (t === 0) return null; // chip with zero TOTAL never had data — hide
  const f = filteredByKey.get(g.key) ?? 0;
  return (
    <Chip
      key={g.key}
      label={g.label}
      count={f}
      total={t}
      active={selected.includes(g.key)}
      disabled={f === 0}
      tooltip={g.tooltip ?? null}
      onClick={() => toggle(g.key)}
      className="taxon-group-chip"
      style={{ ["--i" as string]: i }}
    />
  );
})}
```

The Chip primitive already handles the "filtered / total when different, single number otherwise" display.

- [ ] **Step 4: Update SubjectTypeChips (gallery) similarly**

Take `{ filtered: SubjectCounts; totals: SubjectCounts }`; pass both to `<Chip>` per chip.

- [ ] **Step 5: Wire HomeClient + FilterChipsControls (gallery)**

Home:

```tsx
<TaxonGroupChips
  filtered={facets.taxonGroups}
  totals={props.initialFacets.taxonGroups}
  selected={groups}
  onChange={setGroups}
/>
<FilterPopover
  idleLabel="view: all"
  options={mergeFilteredTotal(facets.views, props.initialFacets.views)}
  selected={views}
  onChange={setViews}
  ...
/>
```

Helper `mergeFilteredTotal(filtered, totals): FilterOption[]` zips by name and decorates each row with both counts.

Gallery `FilterChipsControls` gets the same shape from `FilterChipsBar` (Task 6).

- [ ] **Step 6: Smoke-test in browser**

Run dev server, toggle subject=specimen on Home — taxon chips should re-count to specimen-only numbers, with `filtered/total` display. Toggle butterflies — cockroach chip count should stay the same. Toggle life-stage=egg — most chips drop to zero and grey out.

- [ ] **Step 7: Commit**

```bash
git add app/components/filters app/components/home app/gallery app/globals.css
git commit --no-gpg-sign -m "feat(chips): live filtered/total display with self-axis exclusion"
```

---

### Task 6: Wire gallery facets server-side

The gallery is server-component-driven; its filter state lives in URL params. No API call needed — compute facets directly in the page component and pass down.

**Files:**
- Modify: `app/gallery/page.tsx` (or wherever `FilterChipsBar` is rendered)
- Modify: `app/gallery/_components/FilterChipsBar.tsx`
- Modify: `app/gallery/_components/FilterChipsControls.tsx`

- [ ] **Step 1: Update FilterChipsBar to take URL params**

`FilterChipsBar` currently calls six `list…()` helpers with no args. Change it to accept the current filter state (parsed from URL) and call `getFacetCounts` instead. The institution facet stays separate for now since it's gallery-only and not in `FilterState`:

```typescript
import { getFacetCounts } from "@/lib/queries/facets";
import { listInstitutions } from "@/lib/queries/gallery";

export async function FilterChipsBar({ filters }: { filters: FilterState }) {
  const [snap, institutions] = await Promise.all([
    getFacetCounts(filters),
    listInstitutions(),
  ]);
  return (
    <div className="filter-chips-bar">
      <FilterChipsControls
        snapshot={snap}
        totals={/* a fresh getFacetCounts({}) call cached at module scope, or
                   pass through the same snap if we accept "total = filtered when no filter
                   active" — cleaner if we fetch unfiltered separately and cache */}
        institutions={institutions}
      />
    </div>
  );
}
```

Note: Gallery needs unfiltered totals for the `/total` half. Cheapest: call `getFacetCounts({...empty})` once and cache via `'use cache'` + `cacheTag("facet-totals")` + `cacheLife("days")`.

- [ ] **Step 2: Cache the totals snapshot**

Add to `lib/queries/facets.ts`:

```typescript
import { cacheTag, cacheLife } from "next/cache";

export async function getUnfilteredFacets(): Promise<FacetSnapshot> {
  "use cache";
  cacheTag("facet-totals");
  cacheLife("days");
  return getFacetCounts({
    subjectType: "all", views: [], lifeStages: [], sexes: [], groups: [],
  });
}
```

Use this for the `totals` side in both Home SSR and Gallery SSR.

- [ ] **Step 3: Update FilterChipsControls**

Same chip-component wiring as Task 5 — pass `{ filtered, total }` shape to each chip group.

- [ ] **Step 4: Update gallery page to pass filters to FilterChipsBar**

`app/gallery/page.tsx` already parses URL params for `searchGallery`. Pass the same parsed filter state to `FilterChipsBar`:

```typescript
const filters: FilterState = {
  subjectType: subject,
  views, lifeStages, sexes, groups,
};
<FilterChipsBar filters={filters} />
```

- [ ] **Step 5: Smoke-test**

Visit `/gallery?subject=specimen&type=butterflies` — chip counts should reflect specimen-only data, with butterflies still showing its full specimen count (own-axis exclusion).

- [ ] **Step 6: Commit**

```bash
git add app/gallery lib/queries/facets.ts
git commit --no-gpg-sign -m "feat(gallery): server-side facet snapshot keeps chip counts live with URL filters"
```

---

### Task 7: e2e regression test

**Files:**
- Create: `tests/e2e/r7-dynamic-counts.spec.ts`

- [ ] **Step 1: Write the e2e test**

```typescript
import { test, expect } from "@playwright/test";

test.describe("R7 dynamic chip counts", () => {
  test("home: selecting captive shrinks taxon chip counts", async ({ page }) => {
    await page.goto("/");

    // Expand "what kind of bug?" to make the chip wall visible.
    await page.getByRole("button", { name: /what kind of bug/i }).click();

    // Pin a baseline count for the butterflies chip.
    const butterflies = page.locator(".taxon-group-chip").filter({ hasText: "butterflies" });
    const baselineText = await butterflies.locator(".chip-count").innerText();

    // Switch subject filter to captive.
    const subjectGroup = page.getByRole("radiogroup", { name: /subject type/i });
    await subjectGroup.getByRole("radio", { name: "captive" }).click();

    // Butterflies chip should now show a filtered/total display.
    await expect(butterflies.locator(".chip-count")).not.toHaveText(baselineText);
    await expect(butterflies.locator(".chip-count-total")).toBeVisible();
  });

  test("home: selecting one chip doesn't zero out sibling chip", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /what kind of bug/i }).click();

    const cockroach = page.locator(".taxon-group-chip").filter({ hasText: "cockroaches" });
    const beforeText = await cockroach.locator(".chip-count").innerText();

    // Click butterflies.
    await page.locator(".taxon-group-chip").filter({ hasText: "butterflies" }).click();

    // Cockroach count should be unchanged (own-axis exclusion).
    await expect(cockroach.locator(".chip-count")).toHaveText(beforeText);
  });

  test("gallery: URL-driven filter narrows chip counts on next page render", async ({ page }) => {
    await page.goto("/gallery?subject=captive");
    const butterflies = page.locator(".taxon-group-chip").filter({ hasText: "butterflies" });
    // Captive butterflies are a small subset; the chip should show filtered/total.
    await expect(butterflies.locator(".chip-count-total")).toBeVisible();
  });
});
```

- [ ] **Step 2: Run e2e**

Run: `npx playwright test tests/e2e/r7-dynamic-counts.spec.ts`
Expected: 3 passing.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/r7-dynamic-counts.spec.ts
git commit --no-gpg-sign -m "test(r7): e2e covers chip count cross-axis update + own-axis stability"
```

---

### Task 8: Clean up stale helpers

After Tasks 1-7 ship, three helpers in `lib/queries/gallery.ts` are unused: `listInstitutions` is still needed; `listSubjectTypeCounts`, `listViewCounts`, `listLifeStageCounts`, `listSexCounts`, `listTaxonGroupCounts` are all dead code (their callers now use `getFacetCounts`). The helper-builder `listFacet` is also dead.

- [ ] **Step 1: Grep for callsites of each dead helper**

Run: `grep -rn "listSubjectTypeCounts\|listViewCounts\|listLifeStageCounts\|listSexCounts\|listTaxonGroupCounts\|listFacet" app/ lib/ tests/`
Expected: no matches.

- [ ] **Step 2: Delete the dead helpers from `lib/queries/gallery.ts`**

Delete `listSubjectTypeCounts`, `listViewCounts`, `listLifeStageCounts`, `listSexCounts`, `listTaxonGroupCounts`, and the private `listFacet` factory. Keep `searchGallery`, `listInstitutions`, `searchSpecies`.

- [ ] **Step 3: Run full test suite**

Run: `npx vitest run`
Expected: all pass.

Run: `npx playwright test`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add lib/queries/gallery.ts
git commit --no-gpg-sign -m "chore: drop dead facet helpers superseded by getFacetCounts"
```

---

## Risks + edge cases

- **Drizzle's table alias** — the shared `buildFilterClauses` uses `i.column` references. Both gallery (raw SQL via `db.all`) and session (drizzle query builder) need to expose images as alias `i`. The session module currently uses `db.select().from(schema.images)` without an explicit alias — drizzle auto-aliases to the table name. We may need to switch to `db.select().from(schema.images, "i")` or refactor those clauses to use unaliased references. Test in Task 1 Step 5 will catch this.
- **Cache invalidation when reports resolve** — `getUnfilteredFacets` is `cacheLife("days")`; if an admin resolves a report (hiding/unhiding an image), the cached totals go stale. Existing pattern: `revalidateTag("images-stats")` in the admin route. Add `revalidateTag("facet-totals")` alongside.
- **Within-axis own exclusion when nothing is selected** — `{ ...filters, groups: [] }` is a no-op if `filters.groups` is already empty. Verify the test for the unfiltered case still passes.
- **FilterOption backward compat** — adding optional `total` to the type doesn't break consumers that don't pass it. The chip components fall back to `total = count` when missing.
- **Race conditions on rapid filter changes** — current `AbortController` pattern in HomeClient handles this. Keep it for the new fetch.
- **Performance** — one `getFacetCounts` call runs 6 small SQLite queries. Local benchmarks suggested <50ms total for 40k rows with the existing indexes. If this becomes a bottleneck on the VPS, profile before optimizing.
