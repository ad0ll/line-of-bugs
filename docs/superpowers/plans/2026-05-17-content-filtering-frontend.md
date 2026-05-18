# Content Filtering Frontend Integration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop serving images whose `gate_decisions.decision = 'reject'` from the public gallery, session pool, autocomplete, and direct-imageId lookups.

**Architecture:** Add a third `NOT EXISTS (gate_decisions)` clause to `lib/queries/filter-clauses.ts:buildFilterClauses` so every callsite that uses the helper picks it up for free. Patch the three queries that filter manually instead of through the helper (`getImage`, `listInstitutions`, `searchSpecies`) so they enforce the same predicate. No new tables, no new endpoints — pure query change.

**Tech Stack:** Drizzle ORM, better-sqlite3, Vitest, Next.js App Router.

**Spec:** `docs/superpowers/specs/2026-05-17-content-filtering-design.md`

**Depends on:** Plan 1 (`docs/superpowers/plans/2026-05-17-content-filtering-data-layer.md`) — the `gate_decisions` table must exist and be populated before this plan lands. Verify with:

```bash
sqlite3 data/db/line-of-bugs.db \
  "SELECT COUNT(*), SUM(decision='reject') FROM gate_decisions;"
```

Expected: total count > 0 (Plan 1 backfilled), reject count > 0 (some images flagged by rule/hand/ML).

---

## File structure

**Modified:**
- `lib/queries/filter-clauses.ts:72-83` — third NOT EXISTS clause in `buildFilterClauses`
- `lib/queries/session.ts:61-77` — `getImage` direct-id-lookup gets the same clause
- `lib/queries/gallery.ts:122-139` — `listInstitutions` raw SQL gets the same clause
- `lib/queries/gallery.ts:150-179` — `searchSpecies` raw SQL gets the same clause
- `app/api/search/insect/route.ts:26-53` — autocomplete raw SQL (Task 6, group + species)
- `tests/fixtures/init-db.ts` — add `gate_decisions` CREATE TABLE + `markRejected()` helper
- `tests/lib/filter-clauses.test.ts` — unit test the new clause; update existing count assertions (2 → 3)
- `tests/api/search-insect.test.ts` — append Task 6 coverage for autocomplete gate filtering
- `vitest.config.ts` — alias `next/cache` to `tests/stubs/next-cache.ts` for the node test project

**Created:**
- `tests/lib/gate-decisions-filter.test.ts` — focused integration tests proving rejected images are excluded from gallery/session/count/getImage/listInstitutions/searchSpecies
- `tests/stubs/next-cache.ts` — no-op `cacheTag`/`cacheLife`/`revalidateTag` for the Vitest node harness (real `next/cache` requires `cacheComponents` config only honored by Next.js dev/build)

---

## Why this is short

The data layer (Plan 1) precomputes the decision into `gate_decisions`. The frontend reads "is this image rejected?" with one indexed NOT EXISTS lookup. The two existing visibility checks (`hidden = 0` and the unresolved-report NOT EXISTS) already prove the pattern works at scale; we're adding a third clause of the same shape.

Vacuous truth makes the rollout safe: an image with no `gate_decisions` row passes the filter (matching the "innocent until proven flagged" default the spec describes). After Plan 1's `--all` backfill, every image has a row, so this case shouldn't happen, but the predicate would still behave correctly if it did.

**Out of scope:**

- **Cache invalidation when gate decisions change.** Current cache map (from `lib/queries/gallery.ts`, `lib/queries/facets.ts`, `actions/_invalidation.ts`):

  | Tag | Producer | cacheLife | Currently invalidated by |
  |---|---|---|---|
  | `gallery-results` | `searchGallery()` | hours | `submitReport`, `dismissReport`, `hideImage`, `deleteImage` |
  | `institutions` | `listInstitutions()` | days | **(never)** |
  | `species-index` | `searchSpecies()` | hours | `deleteImage` only |
  | `images-stats` | `getUnfilteredFacets()` | days | `submitReport`, `hideImage`, `deleteImage` |

  After Plan 1's `recompute_gate.py` rewrites `gate_decisions`, no invalidation fires automatically. A freshly-rejected image stays in `gallery-results` for up to `cacheLife("hours")` and in `images-stats`/`institutions` for up to `cacheLife("days")` unless something else triggers the existing invalidators (e.g., a report submit). Ops workaround: after running `recompute_gate.py --all` or a retrain pipeline run, manually call `revalidateTag` for all four tags via an admin endpoint, or `rm -rf .next/cache && systemctl restart line-of-bugs`. Webhook-based revalidation (label_server → Next.js revalidate-on-write) is a follow-up plan.

- **Admin UI to view/edit gate decisions.** Lives in Plan 4 (validator React port).

- **Admin enrichment endpoints intentionally don't filter `gate_decisions`.** `app/api/admin/sketchfab/species/route.ts` returns species needing enrichment; rejected images still need enrichment as a data-quality task independent of visibility. `app/api/healthz/route.ts` counts ALL images for monitoring (visible + hidden). These bypass the gate by design.

- **Per-route crop-image rendering changes.** The spec explicitly punts this to per-route logic — `detections.crop_x/y/w/h` are available but the production tile renderer keeps using full images for now.

---

## Task 1: Extend test fixtures — gate_decisions table + markRejected helper

**Files:**
- Modify: `tests/fixtures/init-db.ts` — add CREATE TABLE + export `markRejected()`

**Background:**
The Vitest in-memory DB seeded by `tests/setup-node.ts → initTestDb()` mirrors the production schema. With Plan 1 landed, `gate_decisions` is part of the real schema; the test fixture must include it or the new `NOT EXISTS` clause we add in Task 2 will throw `no such table: gate_decisions` from every existing test that touches a filter helper.

We also want a tiny seeder helper so individual integration tests can mark a known fixture image as rejected and verify the filter excludes it.

- [ ] **Step 1: Write the failing test for the helper**

Add to `tests/lib/filter-clauses.test.ts` at the top:

```typescript
import { describe, it, expect } from "vitest";
import { sqlite } from "@/db";
import { markRejected } from "../fixtures/init-db";

describe("markRejected fixture helper", () => {
  it("inserts a gate_decisions row with decision='reject'", () => {
    const someImageId = "test-000";
    markRejected(someImageId, "test:setup");
    const row = sqlite
      .prepare("SELECT decision, reason FROM gate_decisions WHERE image_id = ?")
      .get(someImageId) as { decision: string; reason: string } | undefined;
    expect(row?.decision).toBe("reject");
    expect(row?.reason).toBe("test:setup");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test -- tests/lib/filter-clauses.test.ts
```

Expected: FAIL with `markRejected is not exported` or `no such table: gate_decisions`.

- [ ] **Step 3: Add gate_decisions to the schema + the helper**

Modify `tests/fixtures/init-db.ts`. After the `reports` CREATE TABLE block but before the index block, append to `SCHEMA_SQL`:

```sql

CREATE TABLE IF NOT EXISTS gate_decisions (
  image_id      text PRIMARY KEY NOT NULL,
  decision      text NOT NULL CHECK (decision IN ('keep','reject')),
  reason        text NOT NULL,
  reason_source text NOT NULL CHECK (reason_source IN ('hand','report','rule','ml','default')),
  computed_at   integer NOT NULL,
  model_version text,
  threshold_v   integer,
  FOREIGN KEY (image_id) REFERENCES images(image_id) ON UPDATE no action ON DELETE cascade
);
CREATE INDEX IF NOT EXISTS idx_gate_decisions_decision
  ON gate_decisions (decision);
```

Then at the bottom of the file, after `initTestDb()`, add:

```typescript
/**
 * Test helper: mark an image as rejected in gate_decisions. Used by
 * filter integration tests to verify the gallery/session/count helpers
 * exclude the row. reason_source defaults to 'rule' (most common path).
 */
export function markRejected(
  imageId: string,
  reason: string = "rule:bbox-content_no-bug",
  reasonSource: "hand" | "report" | "rule" | "ml" | "default" = "rule",
): void {
  sqlite
    .prepare(
      "INSERT INTO gate_decisions " +
      "(image_id, decision, reason, reason_source, computed_at) " +
      "VALUES (?, 'reject', ?, ?, unixepoch()) " +
      "ON CONFLICT(image_id) DO UPDATE SET " +
      "decision='reject', reason=excluded.reason, " +
      "reason_source=excluded.reason_source, " +
      "computed_at=excluded.computed_at",
    )
    .run(imageId, reason, reasonSource);
}

/**
 * Test helper: insert a 'keep' decision (used when a test wants to
 * confirm a kept-decision image stays visible).
 */
export function markKept(imageId: string): void {
  sqlite
    .prepare(
      "INSERT INTO gate_decisions " +
      "(image_id, decision, reason, reason_source, computed_at) " +
      "VALUES (?, 'keep', 'defaults_pass', 'default', unixepoch()) " +
      "ON CONFLICT(image_id) DO UPDATE SET " +
      "decision='keep', reason='defaults_pass', reason_source='default', " +
      "computed_at=unixepoch()",
    )
    .run(imageId);
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm run test -- tests/lib/filter-clauses.test.ts
```

Expected: PASS (existing tests + the new markRejected helper test).

- [ ] **Step 5: Verify the full Vitest suite still passes**

The schema change is additive (new table, FK to images), but every existing test that goes through `initTestDb` now creates the table. There shouldn't be regressions:

```bash
npm run test
```

Expected: every test PASS.

- [ ] **Step 6: Commit**

```bash
git add tests/fixtures/init-db.ts tests/lib/filter-clauses.test.ts
git commit --only --no-gpg-sign -- tests/fixtures/init-db.ts tests/lib/filter-clauses.test.ts -m "test: add gate_decisions to in-memory test schema + markRejected/markKept helpers"
```

---

## Task 2: Add gate_decisions NOT EXISTS clause to buildFilterClauses

**Files:**
- Modify: `lib/queries/filter-clauses.ts:72-83` — push the new clause
- Modify: `tests/lib/filter-clauses.test.ts` — update count assertions, add SQL token assertion

**Background:**
`buildFilterClauses` is consumed by `searchGallery` (gallery page), `buildSessionPool` / `countSessionPool` (session API), and `getFacetCounts` (sidebar counts). One change here fans out to four call sites.

The new clause mirrors the existing reports-NOT-EXISTS structure exactly — same `alias` handling, same SQL shape.

- [ ] **Step 1: Update unit tests in `tests/lib/filter-clauses.test.ts`**

Existing tests assert `toHaveLength(2)` / `(3)` / `(7)`. After Task 2, the base count is 3 (was 2). Bump every count by one, and add a new assertion for the gate SQL token. Full replacement of the `describe("buildFilterClauses", ...)` block:

```typescript
describe("buildFilterClauses", () => {
  it("returns just the three visibility predicates when no filters set", () => {
    expect(buildFilterClauses(base)).toHaveLength(3);
  });

  it("adds a subject_state clause for any non-'all' subject", () => {
    expect(buildFilterClauses({ ...base, subjectType: "wild" })).toHaveLength(4);
    expect(buildFilterClauses({ ...base, subjectType: "captive" })).toHaveLength(4);
    expect(buildFilterClauses({ ...base, subjectType: "specimen" })).toHaveLength(4);
  });

  it("adds a taxon_subgroup clause when groups are selected", () => {
    expect(buildFilterClauses({ ...base, groups: ["butterflies"] })).toHaveLength(4);
  });

  it("skips axes with empty arrays", () => {
    expect(buildFilterClauses({ ...base, lifeStages: ["adult"] })).toHaveLength(4);
  });

  it("stacks all axes when several are active", () => {
    const clauses = buildFilterClauses({
      ...base,
      subjectType: "wild",
      views: ["dorsal"],
      lifeStages: ["adult"],
      sexes: ["male"],
      groups: ["butterflies"],
    });
    // 3 base + subject + view + life + sex + group = 8
    expect(clauses).toHaveLength(8);
  });

  it("renders the gate_decisions NOT EXISTS clause referencing the alias", () => {
    const { sql: textI } = renderWhere(base);
    expect(textI).toContain("gate_decisions");
    expect(textI).toContain("decision = 'reject'");
    expect(textI).toMatch(/i\.image_id/);
  });

  it("renders subject_state via bound parameters (not inline)", () => {
    const { sql: text, params } = renderWhere({ ...base, subjectType: "wild" });
    expect(text).toContain("subject_state");
    expect(text).toContain("hidden = 0");
    expect(text).toContain("NOT EXISTS");
    expect(text).not.toContain("'wild'");
    expect(params).toContain("wild");
  });

  it("emits IN (...) for view_label and parameterizes every value", () => {
    const { sql: text, params } = renderWhere({
      ...base,
      views: ["dorsal", "ventral"],
    });
    expect(text).toContain("view_label");
    expect(text).toMatch(/IN \(\?, \?\)/);
    expect(text).not.toContain("'dorsal'");
    expect(text).not.toContain("'ventral'");
    expect(params).toEqual(expect.arrayContaining(["dorsal", "ventral"]));
  });

  it("expands the 'unknown' sentinel into an IS NULL / empty-string predicate", () => {
    const { sql: text, params } = renderWhere({
      ...base,
      lifeStages: ["adult", "unknown"],
    });
    expect(text).toContain("life_stage");
    expect(text).toContain("IS NULL");
    expect(text).toContain("OR");
    expect(params).not.toContain("unknown");
    expect(params).toContain("adult");
  });
});
```

(The `markRejected fixture helper` test from Task 1 stays at the top of the file, in its own describe block.)

- [ ] **Step 2: Run the unit tests to verify they fail**

```bash
npm run test -- tests/lib/filter-clauses.test.ts
```

Expected: every clause-count test FAILS (gets 2 where it expects 3, etc.), and the new gate-token test FAILS (no `gate_decisions` substring).

- [ ] **Step 3: Add the gate clause to `buildFilterClauses`**

In `lib/queries/filter-clauses.ts`, modify lines 76-83:

```typescript
  const outerImageId = sql.raw(`${alias}.image_id`);
  const clauses: SQL[] = [
    sql`hidden = 0`,
    sql`NOT EXISTS (
      SELECT 1 FROM reports r
      WHERE r.image_id = ${outerImageId} AND r.resolved_at IS NULL
    )`,
    sql`NOT EXISTS (
      SELECT 1 FROM gate_decisions g
      WHERE g.image_id = ${outerImageId} AND g.decision = 'reject'
    )`,
  ];
```

The three visibility predicates: `hidden` flag (admin moderation), unresolved report (user moderation), and gate_decisions reject (rule/ML/hand-derived auto-moderation).

- [ ] **Step 4: Run the unit tests to verify they pass**

```bash
npm run test -- tests/lib/filter-clauses.test.ts
```

Expected: all PASS.

- [ ] **Step 5: Run the full suite to catch downstream test regressions**

```bash
npm run test
```

Expected: all PASS. The existing tests that go through `buildFilterClauses` run against the in-memory DB whose schema we updated in Task 1, so the new clause's NOT EXISTS finds an empty `gate_decisions` table and never excludes anything.

If any test fails with `no such table: gate_decisions`, re-check Task 1.

- [ ] **Step 6: Commit**

```bash
git add lib/queries/filter-clauses.ts tests/lib/filter-clauses.test.ts
git commit --only --no-gpg-sign -- lib/queries/filter-clauses.ts tests/lib/filter-clauses.test.ts -m "feat(queries): exclude gate_decisions.decision='reject' from gallery + session + facet results"
```

---

## Task 3: Integration tests — rejected images stay out of gallery/session/count/facets

**Files:**
- Create: `tests/lib/gate-decisions-filter.test.ts`

**Background:**
Task 2's unit tests verify the SQL is rendered correctly. Task 3 verifies the runtime behavior — given a seeded image marked as `decision='reject'`, the gallery / session / count helpers actually exclude it.

This is the load-bearing acceptance test for the whole plan.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/gate-decisions-filter.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { sqlite } from "@/db";
import { markRejected, markKept } from "../fixtures/init-db";
import { searchGallery } from "@/lib/queries/gallery";
import { buildSessionPool, countSessionPool } from "@/lib/queries/session";
import { getFacetCounts } from "@/lib/queries/facets";

const ALL_FILTERS_NEUTRAL = {
  subjectType: "all" as const,
  views: [], lifeStages: [], sexes: [], groups: [],
};

describe("gate_decisions filter integration", () => {
  beforeEach(() => {
    // Reset gate_decisions between tests so a previous rejection
    // doesn't leak into the next test's baseline counts.
    sqlite.prepare("DELETE FROM gate_decisions").run();
  });

  it("excludes a rejected image from searchGallery results", async () => {
    const initial = await searchGallery({
      q: [], subject: "all", institutions: [],
      views: [], lifeStages: [], sexes: [], groups: [], page: 1,
    });
    const beforeIds = new Set(initial.rows.map((r) => r.image_id));
    expect(beforeIds.has("test-000")).toBe(true);
    const beforeTotal = initial.totalCount;

    markRejected("test-000", "rule:bbox-content_no-bug");

    const after = await searchGallery({
      q: [], subject: "all", institutions: [],
      views: [], lifeStages: [], sexes: [], groups: [], page: 1,
    });
    const afterIds = new Set(after.rows.map((r) => r.image_id));
    expect(afterIds.has("test-000")).toBe(false);
    expect(after.totalCount).toBe(beforeTotal - 1);
  });

  it("excludes a rejected image from buildSessionPool", async () => {
    markRejected("test-001", "ml:mask_blur_unusable:0.92");
    const pool = await buildSessionPool({
      ...ALL_FILTERS_NEUTRAL,
      repeatMode: "default",
    });
    const ids = new Set(pool.map((p) => p.imageId));
    expect(ids.has("test-001")).toBe(false);
  });

  it("excludes a rejected image from countSessionPool", async () => {
    const before = await countSessionPool(ALL_FILTERS_NEUTRAL);
    markRejected("test-002", "hand:mask:mask_blur_unusable");
    const after = await countSessionPool(ALL_FILTERS_NEUTRAL);
    expect(after).toBe(before - 1);
  });

  it("excludes a rejected image from getFacetCounts.total", async () => {
    const before = await getFacetCounts(ALL_FILTERS_NEUTRAL);
    markRejected("test-003");
    const after = await getFacetCounts(ALL_FILTERS_NEUTRAL);
    expect(after.total).toBe(before.total - 1);
  });

  it("a 'keep' decision row does not hide an image", async () => {
    markKept("test-004");
    const result = await searchGallery({
      q: [], subject: "all", institutions: [],
      views: [], lifeStages: [], sexes: [], groups: [], page: 1,
    });
    const ids = new Set(result.rows.map((r) => r.image_id));
    expect(ids.has("test-004")).toBe(true);
  });

  it("images with NO gate_decisions row are still served (vacuous truth)", async () => {
    // Sanity check: an empty gate_decisions table is the baseline.
    // No rejection rows means nothing excluded — every fixture image visible.
    const result = await searchGallery({
      q: [], subject: "all", institutions: [],
      views: [], lifeStages: [], sexes: [], groups: [], page: 1,
    });
    // 32 fixture images, all should be visible.
    expect(result.totalCount).toBe(32);
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

```bash
npm run test -- tests/lib/gate-decisions-filter.test.ts
```

Expected: all 6 PASS — Task 2 already made `buildFilterClauses` exclude reject rows, and `searchGallery` / `buildSessionPool` / `countSessionPool` / `getFacetCounts` all go through the helper.

If any fail, suspect cache wrapping: `searchGallery` is `"use cache"` and might serve a stale snapshot. Fix:

```typescript
// At top of test file:
import { revalidateTag } from "next/cache";

// In beforeEach:
beforeEach(() => {
  sqlite.prepare("DELETE FROM gate_decisions").run();
  revalidateTag("gallery-results");
  revalidateTag("images-stats");
});
```

(Whether you need this depends on how Next's test runtime handles `"use cache"` — Vitest without a Next.js dev server typically no-ops these, but the explicit invalidation is cheap insurance.)

- [ ] **Step 3: Commit**

```bash
git add tests/lib/gate-decisions-filter.test.ts
git commit --only --no-gpg-sign -- tests/lib/gate-decisions-filter.test.ts -m "test: gate_decisions filter excludes rejected images from gallery/session/count/facets"
```

---

## Task 4: Extend `getImage` direct-imageId lookup

**Files:**
- Modify: `lib/queries/session.ts:61-77` — add gate clause to the direct-id lookup
- Modify: `tests/lib/gate-decisions-filter.test.ts` — add test for getImage

**Background:**
`getImage(imageId)` serves the session-detail page and the direct bookmark-an-image route. Today it enforces `hidden = false` + the reports NOT EXISTS but doesn't go through `buildFilterClauses`, so it didn't pick up the gate clause from Task 2. A user with a bookmark to a rejected image would still see it — bypassing the public moderation.

- [ ] **Step 1: Add the failing test**

Append to `tests/lib/gate-decisions-filter.test.ts` inside the existing `describe` block:

```typescript
  it("getImage returns null for a rejected image", async () => {
    const { getImage } = await import("@/lib/queries/session");
    const before = await getImage("test-005");
    expect(before).toBeDefined();
    expect(before?.imageId).toBe("test-005");

    markRejected("test-005", "rule:bbox-content_no-bug");
    const after = await getImage("test-005");
    expect(after).toBeFalsy();   // null or undefined — both mean "not served"
  });
```

(`getImage` is `cache(...)` from React — Next.js test runtime typically no-ops the cache for unit-test purposes, but if you see flakiness here, add a fresh import or use `vi.resetModules()`.)

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test -- tests/lib/gate-decisions-filter.test.ts
```

Expected: the new test FAILS — getImage still returns the row even after markRejected.

- [ ] **Step 3: Add the gate clause to `getImage`**

In `lib/queries/session.ts`, modify the `getImage` body (lines 61-77):

```typescript
export const getImage = cache(async (imageId: string) => {
  return db
    .select(IMAGE_COLS_NO_RAW)
    .from(schema.images)
    .where(
      and(
        eq(schema.images.imageId, imageId),
        eq(schema.images.hidden, false),
        sql`NOT EXISTS (
          SELECT 1 FROM ${schema.reports}
          WHERE ${schema.reports.imageId} = ${schema.images.imageId}
            AND ${schema.reports.resolvedAt} IS NULL
        )`,
        sql`NOT EXISTS (
          SELECT 1 FROM gate_decisions g
          WHERE g.image_id = ${schema.images.imageId}
            AND g.decision = 'reject'
        )`,
      ),
    )
    .get();
});
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm run test -- tests/lib/gate-decisions-filter.test.ts
```

Expected: every test PASS, including the new getImage one.

- [ ] **Step 5: Commit**

```bash
git add lib/queries/session.ts tests/lib/gate-decisions-filter.test.ts
git commit --only --no-gpg-sign -- lib/queries/session.ts tests/lib/gate-decisions-filter.test.ts -m "feat(queries): getImage refuses to serve gate_decisions.decision='reject' images"
```

---

## Task 5: Extend `listInstitutions` and `searchSpecies` (raw SQL paths)

**Files:**
- Modify: `lib/queries/gallery.ts:122-139` — `listInstitutions`
- Modify: `lib/queries/gallery.ts:150-179` — `searchSpecies`
- Modify: `tests/lib/gate-decisions-filter.test.ts` — add tests for both

**Background:**
These two helpers don't use `buildFilterClauses` — they hand-roll the `hidden = 0` + reports NOT EXISTS predicate directly in the SQL. After Task 2, they're the only two callers that DIDN'T pick up the gate clause for free. They need the same NOT EXISTS clause appended.

`listInstitutions` powers the institutions facet sidebar. `searchSpecies` powers the autocomplete on the search bar. Both would surface rejected images otherwise (e.g., a species whose only specimen is rejected would still appear in autocomplete with `count: 1` — pointing the user at nothing).

- [ ] **Step 1: Add the failing tests**

Append to `tests/lib/gate-decisions-filter.test.ts`:

```typescript
  it("listInstitutions excludes counts from rejected images", async () => {
    // First seed an institution string on two fixture images (the base
    // fixture doesn't populate `institution`).
    sqlite
      .prepare("UPDATE images SET institution = ? WHERE image_id IN (?, ?)")
      .run("Test Museum", "test-006", "test-007");
    const { listInstitutions } = await import("@/lib/queries/gallery");
    const before = await listInstitutions();
    const beforeRow = before.find((r) => r.name === "Test Museum");
    expect(beforeRow?.count).toBe(2);

    markRejected("test-006");
    const after = await listInstitutions();
    const afterRow = after.find((r) => r.name === "Test Museum");
    expect(afterRow?.count).toBe(1);
  });

  it("searchSpecies excludes rejected images from autocomplete counts", async () => {
    const { searchSpecies } = await import("@/lib/queries/gallery");
    const before = await searchSpecies("butterfly");
    const beforeTotal = before.reduce((s, r) => s + r.count, 0);
    expect(beforeTotal).toBeGreaterThan(0);

    // Pick any butterfly and mark it rejected.
    const butterfly = sqlite
      .prepare("SELECT image_id FROM images WHERE taxon_subgroup = 'butterfly' LIMIT 1")
      .get() as { image_id: string };
    markRejected(butterfly.image_id);

    const after = await searchSpecies("butterfly");
    const afterTotal = after.reduce((s, r) => s + r.count, 0);
    expect(afterTotal).toBe(beforeTotal - 1);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm run test -- tests/lib/gate-decisions-filter.test.ts
```

Expected: the two new tests FAIL — counts don't drop after markRejected because these queries still ignore gate_decisions.

- [ ] **Step 3: Add the gate clause to `listInstitutions`**

In `lib/queries/gallery.ts`, modify lines 127-138 (the SQL template literal):

```typescript
  return db.all<InstitutionRow>(sql`
    SELECT i.institution AS name, COUNT(*) AS count
    FROM images i
    WHERE i.hidden = 0
      AND i.institution IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM reports r
        WHERE r.image_id = i.image_id AND r.resolved_at IS NULL
      )
      AND NOT EXISTS (
        SELECT 1 FROM gate_decisions g
        WHERE g.image_id = i.image_id AND g.decision = 'reject'
      )
    GROUP BY i.institution
    ORDER BY count DESC, name ASC
  `);
```

- [ ] **Step 4: Add the gate clause to `searchSpecies`**

In `lib/queries/gallery.ts`, modify the SQL inside `searchSpecies` (lines 162-178):

```typescript
  return db.all<SpeciesRow>(sql`
    WITH matches AS (
      SELECT i.common_name, i.taxon_species, i.taxon_order
      FROM images_fts
      JOIN images i ON i.image_id = images_fts.image_id
      WHERE images_fts MATCH ${ftsQuery}
        AND i.hidden = 0
        AND NOT EXISTS (
          SELECT 1 FROM reports r
          WHERE r.image_id = i.image_id AND r.resolved_at IS NULL
        )
        AND NOT EXISTS (
          SELECT 1 FROM gate_decisions g
          WHERE g.image_id = i.image_id AND g.decision = 'reject'
        )
    )
    SELECT common_name, taxon_species, taxon_order, COUNT(*) AS count
    FROM matches
    GROUP BY common_name, taxon_species
    ORDER BY count DESC, common_name ASC
    LIMIT ${SPECIES_LIMIT}
  `);
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npm run test -- tests/lib/gate-decisions-filter.test.ts
```

Expected: all tests PASS.

- [ ] **Step 6: Run the full suite once more**

```bash
npm run test
```

Expected: every test PASS. No regression in existing facets / search tests.

- [ ] **Step 7: Commit**

```bash
git add lib/queries/gallery.ts tests/lib/gate-decisions-filter.test.ts
git commit --only --no-gpg-sign -- lib/queries/gallery.ts tests/lib/gate-decisions-filter.test.ts -m "feat(queries): listInstitutions + searchSpecies exclude gate_decisions reject rows"
```

---

## Task 6: Extend `/api/search/insect` autocomplete (raw SQL — third path)

**Files:**
- Modify: `app/api/search/insect/route.ts:26-29` (group count query) and `:44-53` (species FTS query)
- Modify: `tests/api/search-insect.test.ts` — add coverage for gate exclusion

**Background:**
The homepage autocomplete (typing in the gallery search box) hits `/api/search/insect?q=<term>` which runs TWO raw SQL queries:
1. Group count per `taxon_subgroup` (lines 26-29) — `SELECT COUNT(*) AS c FROM images WHERE hidden = 0 AND taxon_subgroup IN (...)`
2. Species FTS join (lines 44-53) — `SELECT i.common_name, i.taxon_species, COUNT(*) FROM images_fts JOIN images i ... WHERE images_fts MATCH ? AND i.hidden = 0`

Both queries filter `hidden = 0` but NEITHER checks `gate_decisions`. Without this fix:

- A search for "butterfly" returns "butterfly (12)" in the dropdown even if all 12 are rejected
- Clicking the result navigates to the gallery, where `searchGallery` (now gate-aware) returns 0 hits
- User sees a ghost group/species → empty grid. Misleading.

This endpoint duplicates the FTS pattern that `searchSpecies` uses; the cleanest long-term fix is to refactor it to call `searchSpecies`, but for this plan we just add the gate clause directly so the autocomplete counts match the gallery results.

- [ ] **Step 1: Add the failing tests**

Read `tests/api/search-insect.test.ts` first to see the existing test pattern. Append:

```typescript
it("excludes a rejected image from group counts", async () => {
  // The base fixture seeds 12 butterflies in the "butterfly" taxon_subgroup.
  // Mark one rejected and verify the group count drops.
  const { markRejected } = await import("../fixtures/init-db");
  const { sqlite } = await import("@/db");
  // Reset gate_decisions to a known state.
  sqlite.prepare("DELETE FROM gate_decisions").run();

  const before = await GET(
    new Request("http://localhost/api/search/insect?q=butterf"),
  );
  const beforeBody = (await before.json()) as { results: Array<{ kind: string; label: string; count: number }> };
  const beforeGroup = beforeBody.results.find((r) => r.kind === "group" && r.label.toLowerCase().includes("butterfly"));
  expect(beforeGroup?.count).toBeGreaterThan(0);
  const beforeCount = beforeGroup!.count;

  // Mark one butterfly rejected.
  const butterfly = sqlite
    .prepare("SELECT image_id FROM images WHERE taxon_subgroup = 'butterfly' LIMIT 1")
    .get() as { image_id: string };
  markRejected(butterfly.image_id);

  const after = await GET(
    new Request("http://localhost/api/search/insect?q=butterf"),
  );
  const afterBody = (await after.json()) as { results: Array<{ kind: string; label: string; count: number }> };
  const afterGroup = afterBody.results.find((r) => r.kind === "group" && r.label.toLowerCase().includes("butterfly"));
  expect(afterGroup?.count).toBe(beforeCount - 1);
});

it("excludes rejected images from species autocomplete counts", async () => {
  const { markRejected } = await import("../fixtures/init-db");
  const { sqlite } = await import("@/db");
  sqlite.prepare("DELETE FROM gate_decisions").run();

  const before = await GET(
    new Request("http://localhost/api/search/insect?q=Testus"),
  );
  const beforeBody = (await before.json()) as { results: Array<{ kind: string; count: number }> };
  const beforeSpeciesSum = beforeBody.results
    .filter((r) => r.kind === "species")
    .reduce((s, r) => s + r.count, 0);
  expect(beforeSpeciesSum).toBeGreaterThan(0);

  // Pick any image whose species matches the FTS query.
  const target = sqlite
    .prepare("SELECT image_id FROM images WHERE taxon_species LIKE 'Testus%' LIMIT 1")
    .get() as { image_id: string };
  markRejected(target.image_id);

  const after = await GET(
    new Request("http://localhost/api/search/insect?q=Testus"),
  );
  const afterBody = (await after.json()) as { results: Array<{ kind: string; count: number }> };
  const afterSpeciesSum = afterBody.results
    .filter((r) => r.kind === "species")
    .reduce((s, r) => s + r.count, 0);
  expect(afterSpeciesSum).toBe(beforeSpeciesSum - 1);
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm run test -- tests/api/search-insect.test.ts
```

Expected: the two new tests FAIL — both counts stay unchanged because the queries don't check gate_decisions.

- [ ] **Step 3: Patch the group count query**

In `app/api/search/insect/route.ts:26-29`, modify:

```typescript
      const counts = db.all<{ c: number }>(sql`
        SELECT COUNT(*) AS c FROM images
        WHERE hidden = 0 AND taxon_subgroup IN (${sql.join(g.dbValues.map((v) => sql`${v}`), sql`, `)})
          AND NOT EXISTS (
            SELECT 1 FROM gate_decisions g
            WHERE g.image_id = images.image_id AND g.decision = 'reject'
          )
      `);
```

- [ ] **Step 4: Patch the species FTS query**

In `app/api/search/insect/route.ts:44-53`, modify:

```typescript
    const rows = db.all<{ common_name: string; taxon_species: string; c: number }>(sql`
      SELECT i.common_name, i.taxon_species, COUNT(*) AS c
      FROM images_fts f
      JOIN images i ON i.image_id = f.image_id
      WHERE images_fts MATCH ${ftsExpr}
        AND i.hidden = 0
        AND NOT EXISTS (
          SELECT 1 FROM gate_decisions g
          WHERE g.image_id = i.image_id AND g.decision = 'reject'
        )
      GROUP BY i.common_name, i.taxon_species
      ORDER BY c DESC
      LIMIT 15
    `);
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npm run test -- tests/api/search-insect.test.ts
```

Expected: all tests PASS.

- [ ] **Step 6: Run the full suite once more**

```bash
npm run test
```

Expected: every test PASS.

- [ ] **Step 7: Commit**

```bash
git add app/api/search/insect/route.ts tests/api/search-insect.test.ts
git commit --only --no-gpg-sign -- app/api/search/insect/route.ts tests/api/search-insect.test.ts -m "feat(api): /api/search/insect autocomplete excludes gate_decisions reject rows"
```

---

## Task 7: Manual browser smoke test against the dev server

**Files touched:** none (verification step).

**Background:**
Unit + integration tests pass; the data layer has the gate populated. Verify a rejected image visibly disappears from the live UI.

- [ ] **Step 1: Pick a test target image**

```bash
sqlite3 data/db/line-of-bugs.db "
  SELECT g.image_id, g.reason, i.taxon_subgroup, i.common_name
  FROM gate_decisions g
  JOIN images i USING (image_id)
  WHERE g.decision='reject' AND g.reason_source IN ('rule','ml')
  ORDER BY RANDOM() LIMIT 3;
"
```

Note one image_id from the output (e.g. `bugwood-1234567`).

- [ ] **Step 2: Start the dev server**

```bash
npm run dev
```

Wait for `Ready - started server on 0.0.0.0:3000`.

- [ ] **Step 3: Verify the rejected image is hidden from gallery**

Visit `http://localhost:3000/gallery`. Use the search box or browse filters to navigate to where the rejected image USED to appear. Verify it's not in the result grid.

If the image still shows up, check:
- Did Plan 1's `recompute_gate --all` actually run? (`sqlite3 ... "SELECT COUNT(*) FROM gate_decisions WHERE decision='reject';"` should be > 0)
- Is Next.js serving a cached page? Try a hard refresh, or clear the Next.js cache: `rm -rf .next/cache && npm run dev`.

- [ ] **Step 4: Verify the rejected image is hidden from direct lookup**

```bash
curl -s -o /dev/null -w "%{http_code}\n" \
  http://localhost:3000/api/img/<the-image-id>/medium
```

Expected: `404` (getImage returned null → route returns 404).

- [ ] **Step 5: Verify the rejected image is hidden from autocomplete**

If the rejected image was the only one for a given species, search for that species in the gallery search box. The autocomplete dropdown should NOT suggest it.

- [ ] **Step 6: Verify session pool excludes**

Start a session at `http://localhost:3000` with a permissive filter. Click through ~20 images and confirm the rejected image_id is never shown.

- [ ] **Step 7: Record outcome**

If all four spot-checks pass, the plan is verified end-to-end. If one fails, file a follow-up task with the specific image_id and reason_source — the failure mode hints which query path is broken.

No commit for this task — it's verification.

---

## Spec coverage self-review

| Spec section / consumer | Implemented in |
|---|---|
| `buildFilterClauses` (gallery, session, facets — 4 callsites) | Task 2 |
| `getImage` direct-id lookup | Task 4 |
| `listInstitutions` raw SQL | Task 5 |
| `searchSpecies` raw SQL | Task 5 |
| `/api/search/insect` autocomplete raw SQL (group + species) | Task 6 |
| Out-of-scope: cache invalidation | Documented in plan header (with cache map + ops workaround) |
| Out-of-scope: admin enrichment endpoints (`/api/admin/sketchfab`, `/api/healthz`) | Documented in plan header |
| Out-of-scope: crop image rendering | Documented |

All public-facing read paths verified via `grep -rn "FROM images" app/ lib/ actions/`. No unfilteredless public callsites remain.

---

## Plan complete and saved to `docs/superpowers/plans/2026-05-17-content-filtering-frontend.md`. Two execution options:

**1. Subagent-Driven (recommended)** — fresh subagent per task, two-stage review between tasks, fast iteration in this session.

**2. Inline Execution** — execute tasks in this session via executing-plans, batch with checkpoints.

Which approach?
