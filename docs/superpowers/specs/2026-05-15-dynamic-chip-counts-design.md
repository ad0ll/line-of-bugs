# Dynamic chip counts — design

**Status:** approved 2026-05-15
**Scope:** Home + Gallery filter chips
**Goal:** Filter chip counts should update as the user changes filters, with sensible faceted-search semantics, without becoming a footgun for future filter additions.

## Problem

Today every filter chip shows a **static, unfiltered total** computed once at server render. That makes the counts misleading once any filter is applied: a chip might read "wasps — 1,802" but selecting it returns 4 images because the rest of the filter state is incompatible. The user can't see the cost of a click before they click.

There's also a real semantic trap we have to get right: **some axes cross-affect chip counts and some don't.**

> "you would need to consider captive vs specimen vs wild for dynamic counts of bug type, but you wouldn't need to consider butterfly in roach count when choosing to do butterfly AND roach in the roach chip"

That's standard **faceted search**: each facet's counts are computed under the filter state *of every other facet*, but **excluding its own selection** — so multi-select chips remain orthogonal within an axis.

## Vocabulary

- **Facet axis**: one filter dimension. We have five: `subject_state`, `view_label`, `life_stage`, `sex`, `taxon_subgroup`. (Institution is a sixth in the gallery; treat the same.)
- **Chip / bucket**: one option within an axis. "butterflies" is a chip on the taxon axis; "wild" is a chip on the subject axis.
- **Filtered count**: how many rows would remain if *the user clicked this chip right now*, given all other filters.
- **Absolute total**: how many rows the chip matches in the visible pool, ignoring all filters. This is the number the chip shows today.

## Display

Each chip carries two numbers — the dynamic filtered count and the absolute total:

```
butterflies   120 / 4,432
ladybugs        0 / 1,118
captive       278 / 1,811
```

Rules:
- When `filtered === total` (no narrowing filters active), collapse to one number to avoid clutter: `butterflies 4,432`.
- When `filtered === 0`, the chip stays visible and clickable but greys out — clicking it would clear the contradiction. (Currently we drop zero-count chips entirely; with dynamic counts we keep them.)
- The `total` number is the per-chip count across the whole visible pool (the existing static number). It does **not** vary with filters — it's a stable reference point.

## Semantics of "filtered" per facet

For each facet axis F, the filtered count for each chip in F is computed with:
- ✅ Base visibility predicates applied (`hidden = 0`, no unresolved reports)
- ✅ All *other* axes' user selections applied
- ❌ Axis F's own user selection ignored (so selecting butterflies doesn't zero out the cockroaches chip)

Concrete examples (40k pool):
- User has `subject=captive` selected, nothing else. Then:
  - `taxon_subgroup`: chip counts reflect captive-only (butterflies might drop from 4,432 to 120).
  - `subject_state`: chip counts reflect everything (wild = 27,048, captive = 1,811, specimen = 11,532) — its own selection is ignored.
- User has `subject=captive` AND `taxon=butterflies+beetles` selected. Then:
  - `taxon_subgroup`: chip counts reflect captive-only (its own butterflies+beetles selection ignored — so picking ladybugs as a third chip is meaningfully scoped).
  - `subject_state`: chip counts reflect butterflies+beetles only (so user sees "selecting specimen would give me N more").

This is the standard faceted-search behaviour — every faceted UI does it this way.

## SQL strategy

One server helper, `getFacetCounts(filters)`, runs one query per axis. Each query reuses the existing `buildSessionFilterClauses` (or its gallery sibling) but blanks out the axis's own field:

```typescript
// pseudocode
async function getFacetCounts(filters: Filters): Promise<FacetSnapshot> {
  const taxonClauses    = buildClauses({ ...filters, groups: [] });
  const subjectClauses  = buildClauses({ ...filters, subjectType: "both" });
  const viewClauses     = buildClauses({ ...filters, views: [] });
  const lifeClauses     = buildClauses({ ...filters, lifeStages: [] });
  const sexClauses      = buildClauses({ ...filters, sexes: [] });
  // ... one COUNT(*)-per-bucket query per axis
}
```

There is **no per-chip hardcoding**. The taxon facet is a single `GROUP BY taxon_subgroup` query whose buckets are folded into `TAXON_GROUPS` chips by the existing `lib/taxonomy.ts` logic. Adding a new chip to `TAXON_GROUPS` automatically picks up its filtered count — no SQL change needed.

### Caching

- **Absolute totals**: today's `'use cache'` + `cacheTag` + `cacheLife("days")` stays as-is. These rarely change.
- **Filtered counts**: do **not** cache. The cache key would explode across the filter-param combinatorial space, and a single SQLite count over ~40k indexed rows is sub-10ms — cheaper than a cache miss. Just hit the DB.

## API surface

### Home (`app/page.tsx` + `HomeClient.tsx`)

- New: `GET /api/facets?subject=…&view=…&life=…&sex=…&type=…` returns
  ```json
  {
    "total": 1742,
    "subject": { "wild": 1320, "captive": 198, "specimen": 224 },
    "views":   [{ "name": "dorsal", "count": 423 }, …],
    "lifeStages": […],
    "sexes": […],
    "taxonGroups": [{ "name": "butterflies", "count": 120 }, …]
  }
  ```
- Replaces `/api/session/count` — `total` is now part of the same payload.
- Client hits this on every filter change (debounced 150ms — already the pattern for `countSessionPool`).
- Initial values come down with SSR via a server-side `getFacetCounts({ subjectType: "both", views: [], lifeStages: [], sexes: [], groups: [] })`. No filters → filtered === total → chips render single numbers.

### Gallery (`app/gallery/page.tsx`)

Server component, filter state lives in URL params. Compute facets directly on the server inside the page component — no API call:

```typescript
const facets = await getFacetCounts(filtersFromSearchParams);
```

`FilterChipsBar` receives `facets` instead of separate static `…Counts` props.

## Files

- **Create** `lib/queries/facets.ts` — `getFacetCounts(filters)` + `FacetSnapshot` type. Reuses `buildSessionFilterClauses` (move it from `lib/queries/session.ts` to `facets.ts` and re-export, or import it directly — TBD in plan).
- **Modify** `lib/queries/session.ts` — export `buildSessionFilterClauses` if not already exported.
- **Modify** `lib/queries/gallery.ts` — same for the gallery clause builder; mirror its facet logic.
- **Create** `app/api/facets/route.ts` — wraps `getFacetCounts`, parses URL params.
- **Delete** `app/api/session/count/route.ts` — folded into `/api/facets`.
- **Modify** `app/page.tsx` — call `getFacetCounts` for initial render.
- **Modify** `app/components/home/HomeClient.tsx` — fetch `/api/facets` on filter change, pass filtered counts to chip components.
- **Modify** `app/gallery/page.tsx` + `app/gallery/_components/FilterChipsBar.tsx` — receive `facets` instead of individual count lists.
- **Modify** `app/components/filters/TaxonGroupChips.tsx` — accept `{ filtered, total }` per chip; render `filtered/total` when they differ; keep zero-count chips visible (greyed).
- **Modify** subject-type / view / life / sex chip renderers similarly.
- **CSS**: extend `globals.css` chip rules with a `.chip-total` style and a `.chip-disabled` greying for zero-filtered chips.

## Non-goals

- **Within-axis re-ordering**: chips stay in their canonical order (e.g., taxonomy order in `TAXON_GROUPS`), even if some go to zero. We are not surfacing "you've eliminated everything but ladybugs" by reordering.
- **Total dynamism**: the `/total` half of the display is the absolute per-chip total, not "what other filters minus this axis would give me". Keeping it absolute means the user always has a stable anchor.
- **Per-chip tooltips for zero-state**: not adding "this chip is empty because X" hover text — the empty chip greying is signal enough.

## Out-of-scope but worth noting

- Gallery has an institution facet that's a long checkbox list, not a chip wall. Same logic applies — its filtered counts should reflect every other axis except institution. Plan task covers it.
- Once `/api/facets` exists, the existing `/api/session/count` is dead code. Delete it in the same task that introduces the new endpoint.
- Once the chip display includes `/total`, the static unfiltered total can be dropped from the chip wall's surrounding context (the home page's "Xk images in your pool" stays — that's the global `total`, useful as a sanity check).
