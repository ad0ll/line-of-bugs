# R6 — Layperson taxonomy filter: full plan

> **Goal:** Let users filter the dataset by familiar bug categories ("butterflies", "beetles", "ladybugs") rather than taxonomic orders. Surface it as a power-user feature behind a collapsible disclosure on home + gallery so the default UX stays simple.

**Architecture:** Add one nullable column `taxon_subgroup` to `images`, populated by a one-shot backfill that walks `raw_metadata.taxon.ancestor_ids` and matches a hardcoded ID lookup. UI exposes ~20 chips inside a `<details>`-style collapsible. Home stays minimal (collapsed by default); gallery shows the chips inline (it's a power-user surface anyway).

**Tech:** SQLite migration (drizzle), Python backfill (one-shot), TypeScript filter query, new React `<CollapsibleSection>` + chip-wall component.

**Estimated effort:** 4-6 hours total (the unknown is iNat ID lookup time — accounted for in Task 2).

---

## Files touched

**Create:**
- `drizzle/0004_taxon_subgroup.sql` — column + index
- `scripts/backfill_taxon_subgroup.py` — one-shot, deleted after use
- `lib/taxonomy.ts` — chip definitions + subgroup mapping
- `app/components/ui/CollapsibleSection.tsx` — reusable disclosure
- `app/gallery/_components/TaxonGroupChips.tsx` — chip wall component
- `tests/python/test_taxon_subgroup_extract.py` — unit tests for the ancestry-walk logic
- `tests/e2e/r6-taxon-group.spec.ts` — gallery + home integration

**Modify:**
- `db/schema.ts` — add `taxonSubgroup` column + index
- `scripts/db.py` — add `taxon_subgroup` to `COLUMNS` + `_NULLABLE` set
- `scripts/fetch_inaturalist.py` — populate `taxon_subgroup` at fetch time (so going-forward fetches don't need backfill)
- `scripts/fetch_bugwood.py` — populate `taxon_subgroup` at fetch time via keyword match
- `lib/queries/gallery.ts` — accept `groups: string[]`, generate the WHERE clause via `lib/taxonomy.ts`
- `lib/queries/session.ts` — same
- `app/api/gallery/page/[n]/route.ts` — pass `groups` through
- `app/api/session/count/route.ts` — same
- `app/gallery/_components/FilterChipsBar.tsx` — add `listTaxonGroupCounts()` server call
- `app/gallery/_components/FilterChipsControls.tsx` — render `<TaxonGroupChips>`, wire URL
- `app/components/home/HomeClient.tsx` — wrap advanced filters (view/life/sex + the new type chips) in `<CollapsibleSection>`
- `app/api/session/start/route.ts` — accept + forward `groups`
- `app/components/home/StartSessionButton.tsx` — POST `groups` to start API
- `app/page.tsx` — pass taxon-group counts down
- `app/globals.css` — `<CollapsibleSection>` + chip-wall styling
- `lib/tooltips.tsx` — add tooltip copy for the new section

---

## Final chip set (20 chips + 1 "weird stuff")

Driven by **the layperson recognition test**, not data thresholds. A chip exists if a non-bug-person would say the word unprompted; sub-counts are FYI.

| key | display label | underlying match | ~rows |
|---|---|---|---:|
| `butterflies` | butterflies | Lepidoptera + Papilionoidea in ancestors | 3,380 |
| `moths` | moths | Lepidoptera + NOT Papilionoidea | 2,656 |
| `caterpillars` | caterpillars | taxon_order = 'Lepidoptera_larva' | 2,176 |
| `ladybugs` | ladybugs | Coccinellidae in ancestors | ~1,400 |
| `beetles` | beetles | Coleoptera + NOT Coccinellidae | ~6,100 |
| `bees` | bees | Anthophila in ancestors | ~1,500 |
| `wasps` | wasps | Hymenoptera + NOT bees + NOT ants + NOT sawflies | ~1,000 |
| `ants` | ants | Formicidae in ancestors | ~700 |
| `flies` | flies | Diptera + NOT mosquitoes | ~2,175 |
| `mosquitoes` | mosquitoes | Culicidae in ancestors | ~135 |
| `dragonflies` | dragonflies & damselflies | Odonata (lumped — laypeople don't split) | 2,341 |
| `grasshoppers` | grasshoppers | Caelifera in ancestors | ~1,083 |
| `crickets` | crickets | Ensifera in ancestors (incl katydids) | ~568 |
| `mantises` | praying mantises | Mantodea | 1,287 |
| `stick_insects` | stick & leaf insects | Phasmatodea | 1,199 |
| `cockroaches` | cockroaches | Blattodea (termites only 2%, lumped) | 907 |
| `stink_bugs` | stink bugs | Heteroptera in ancestors | ~600 |
| `cicadas` | cicadas | Cicadidae in ancestors | ~196 |
| `aphids` | aphids & scales | Sternorrhyncha in ancestors | ~735 |
| `earwigs` | earwigs | Dermaptera | 639 |
| `weird` | weird stuff | everything else (lacewings, mayflies, caddisflies, stoneflies, fleas, silverfish, Hemiptera-other, etc.) | ~3,500 |

**Selection semantics:** multi-select. Empty selection = no filter on this axis. Unselecting all = same as selecting all. The chip is hidden if its count would be 0 (e.g., if `silverfish` somehow had no rows — defensive, shouldn't happen).

---

## Data layer

### Schema (`db/schema.ts`)

Add one nullable column + one index:

```typescript
taxonSubgroup: text("taxon_subgroup"),  // see lib/taxonomy.ts for values
// ...
index("idx_images_taxon_subgroup").on(t.taxonSubgroup),
```

Values are short strings matching the chip `key` column (`"butterfly"`, `"moth"`, `"ladybug"`, etc.). Nullable for rows whose category we can't determine (Smithsonian specimens with sparse metadata, edge cases).

### Migration (`drizzle/0004_taxon_subgroup.sql`)

```sql
ALTER TABLE images ADD COLUMN taxon_subgroup TEXT;--> statement-breakpoint
CREATE INDEX idx_images_taxon_subgroup ON images(taxon_subgroup);
```

That's it. No NOT NULL constraint, no data migration in the SQL — the backfill script populates values separately.

### iNat ID lookup table

Populated by a small probe script before backfill runs. Hardcoded once and reused:

```python
# scripts/backfill_taxon_subgroup.py — module level
# Format: ancestor_id (int) → subgroup key (str). Walked in order;
# first match wins, so more specific IDs come first. e.g., ladybugs
# (Coccinellidae) must precede beetles (Coleoptera).
TAXON_ID_TO_SUBGROUP = {
    # Lepidoptera — butterfly vs moth via Papilionoidea
    47224: "butterfly",           # Papilionoidea (superfamily)
    # NOTE: moth detection is "Lepidoptera order present, no Papilionoidea" — fallback rule, not a single ID.
    # Coleoptera
    48486: "ladybug",             # Coccinellidae (family) — VERIFY
    # Diptera
    47158: None,                  # placeholder for the Insecta root — sentinel
    # Will use Culicidae's id once probed
    # Hymenoptera
    47222: "bee",                 # Anthophila / Apoidea
    47336: "ant",                 # Formicidae
    # wasp = catch-all for the rest of Hymenoptera (minus sawflies — see Symphyta below)
    # Hemiptera
    # Heteroptera, Auchenorrhyncha, Sternorrhyncha — three sub-orders
    # Orthoptera
    # Caelifera (grasshoppers), Ensifera (crickets/katydids)
    # ... and so on
}
```

**Implementation note:** the exact iNat IDs are not all hardcoded above. The probe script (~30 lines) calls `https://api.inaturalist.org/v1/taxa?q=Coccinellidae&rank=family` for each name and writes the IDs into the table. Run once, hardcode the result, delete the probe.

### Backfill script (`scripts/backfill_taxon_subgroup.py`)

Pseudocode:

```python
import json, sqlite3
from scripts.db import DB_PATH

ORDER_DEFAULTS = {        # if no specific subgroup id matches, fall back to these per-order rules
    "Lepidoptera_larva": "caterpillar",
    "Mantodea":          "mantis",
    "Phasmatodea":       "stick_insect",
    "Blattodea":         "cockroach",
    "Dermaptera":        "earwig",
    "Odonata":           "dragonfly",
}

# everything NOT in ORDER_DEFAULTS and not matched by TAXON_ID_TO_SUBGROUP → "weird"

WEIRD_ORDERS = {
    "Neuroptera", "Ephemeroptera", "Trichoptera", "Plecoptera",
    "Siphonaptera", "Thysanura",
}

def classify(taxon_order: str, ancestor_ids: list[int]) -> str | None:
    # 1. Direct ancestor match
    for aid in ancestor_ids:
        sub = TAXON_ID_TO_SUBGROUP.get(aid)
        if sub: return sub
    # 2. Order-level default
    if taxon_order in ORDER_DEFAULTS:
        return ORDER_DEFAULTS[taxon_order]
    # 3. Special: Lepidoptera with no Papilionoidea = moth
    if taxon_order == "Lepidoptera":
        return "moth"
    # 4. Coleoptera not-ladybug → beetle
    if taxon_order == "Coleoptera":
        return "beetle"
    # 5. Diptera not-mosquito → fly
    if taxon_order == "Diptera":
        return "fly"
    # 6. Hymenoptera not-bee-ant-wasp → wasp (catch-all; sawflies are technically wrong but rare)
    if taxon_order == "Hymenoptera":
        return "wasp"
    # 7. Orthoptera not-grasshopper-cricket → cricket (close enough)
    if taxon_order == "Orthoptera":
        return "cricket"
    # 8. Hemiptera not-classified → fall to "weird" (Sternorrhyncha catch should hit most)
    if taxon_order in WEIRD_ORDERS:
        return "weird"
    return None  # no classification — leaves NULL


def main():
    conn = sqlite3.connect(DB_PATH, isolation_level=None)
    rows = conn.execute("""
        SELECT image_id, source, taxon_order, raw_metadata
        FROM images
        WHERE taxon_subgroup IS NULL
    """).fetchall()
    updates = []
    for image_id, source, taxon_order, raw in rows:
        ancestor_ids = []
        if raw and raw != '{}':
            try:
                ancestor_ids = json.loads(raw).get("taxon", {}).get("ancestor_ids", []) or []
            except Exception: pass
        # Bugwood + Smithsonian have no rich ancestor_ids — fall through to order-level only.
        subgroup = classify(taxon_order or "", ancestor_ids)
        if subgroup:
            updates.append((subgroup, image_id))
    conn.executemany("UPDATE images SET taxon_subgroup = ? WHERE image_id = ?", updates)
    conn.close()


if __name__ == "__main__":
    main()
```

Bugwood rows hit step 4-8 (no ancestry → order-level rule). That's acceptable: a Bugwood ladybug photo gets classified as `"beetle"` instead of `"ladybug"` (loses a bit of specificity). If this matters, run a second pass that keyword-matches Bugwood's `common_name` for the obvious cases (`"lady"`, `"mosquito"`, etc.).

### Fetcher updates

Both iNat + Bugwood fetchers should populate `taxon_subgroup` at fetch time so we don't need future backfills:

- **iNat:** add `taxon_subgroup = classify(taxon_order, taxon.get("ancestor_ids", []))` to the row dict before `mw.write()`.
- **Bugwood:** use a keyword-match function on `descriptorname` + `subjectname`. For the common cases (Adult, Larva, etc.) → fold into the structured-keyword approach.

---

## SQL / query layer

### `lib/taxonomy.ts` — single source of truth

```typescript
export interface TaxonGroup {
  key: string;          // URL value, e.g., "butterflies"
  label: string;        // chip display, e.g., "butterflies"
  match: string;        // SQL WHERE fragment, e.g., "taxon_subgroup = 'butterfly'"
}

export const TAXON_GROUPS: TaxonGroup[] = [
  { key: "butterflies",  label: "butterflies",            match: "taxon_subgroup = 'butterfly'" },
  { key: "moths",        label: "moths",                  match: "taxon_subgroup = 'moth'" },
  { key: "caterpillars", label: "caterpillars",           match: "taxon_subgroup = 'caterpillar'" },
  { key: "ladybugs",     label: "ladybugs",               match: "taxon_subgroup = 'ladybug'" },
  { key: "beetles",      label: "beetles",                match: "taxon_subgroup = 'beetle'" },
  { key: "bees",         label: "bees",                   match: "taxon_subgroup = 'bee'" },
  { key: "wasps",        label: "wasps",                  match: "taxon_subgroup = 'wasp'" },
  { key: "ants",         label: "ants",                   match: "taxon_subgroup = 'ant'" },
  { key: "flies",        label: "flies",                  match: "taxon_subgroup = 'fly'" },
  { key: "mosquitoes",   label: "mosquitoes",             match: "taxon_subgroup = 'mosquito'" },
  { key: "dragonflies",  label: "dragonflies & damselflies", match: "taxon_subgroup = 'dragonfly'" },
  { key: "grasshoppers", label: "grasshoppers",           match: "taxon_subgroup = 'grasshopper'" },
  { key: "crickets",     label: "crickets",               match: "taxon_subgroup = 'cricket'" },
  { key: "mantises",     label: "praying mantises",       match: "taxon_subgroup = 'mantis'" },
  { key: "stick_insects",label: "stick & leaf insects",   match: "taxon_subgroup = 'stick_insect'" },
  { key: "cockroaches",  label: "cockroaches",            match: "taxon_subgroup = 'cockroach'" },
  { key: "stink_bugs",   label: "stink bugs",             match: "taxon_subgroup = 'stink_bug'" },
  { key: "cicadas",      label: "cicadas",                match: "taxon_subgroup = 'cicada'" },
  { key: "aphids",       label: "aphids & scales",        match: "taxon_subgroup = 'aphid'" },
  { key: "earwigs",      label: "earwigs",                match: "taxon_subgroup = 'earwig'" },
  { key: "weird",        label: "weird stuff",            match: "taxon_subgroup = 'weird'" },
];

const KEYS = new Set(TAXON_GROUPS.map(g => g.key));

export function isValidGroupKey(k: string): boolean { return KEYS.has(k); }

export function buildTaxonGroupClause(selected: string[]): string | null {
  if (!selected.length) return null;
  const matches = TAXON_GROUPS
    .filter(g => selected.includes(g.key))
    .map(g => g.match);
  if (!matches.length) return null;
  return "(" + matches.join(" OR ") + ")";
}
```

### Query integration

In `lib/queries/gallery.ts`, the `searchGallery()` filters array gets a new entry:

```typescript
if (args.groups.length > 0) {
  const clause = buildTaxonGroupClause(args.groups);
  if (clause) filters.push(sql.raw(clause).prepend(sql`i.`));
  // careful: this is a literal string, sanitized via the KEYS allowlist in
  // buildTaxonGroupClause — every match string is hand-curated, never user input.
}
```

Actually safer: drizzle's `sql.join` with parameterized values. Refactor `buildTaxonGroupClause` to return `SQL[]`:

```typescript
export function buildTaxonGroupSQL(selected: string[]): SQL | null {
  const subgroups = TAXON_GROUPS
    .filter(g => selected.includes(g.key))
    .map(g => g.match.split("'")[1]); // extract the literal, e.g., "butterfly"
  if (!subgroups.length) return null;
  return sql`i.taxon_subgroup IN (${sql.join(subgroups.map(s => sql`${s}`), sql`, `)})`;
}
```

This is the same pattern the existing `views` / `lifeStages` filters use. The `inOrUnknown` helper in `lib/queries/gallery.ts` is already exactly right — `taxon_subgroup` can use that pattern verbatim (just no "unknown" coercion — NULL goes into "weird stuff" via the backfill).

### Counts query

A new `listTaxonGroupCounts()` in `lib/queries/gallery.ts` that returns `FilterOption[]` (the same shape as `listViewCounts()`):

```typescript
export async function listTaxonGroupCounts(): Promise<FilterOption[]> {
  "use cache";
  cacheTag("taxon-group-counts");
  cacheLife("days");
  const rows = db.all<{ subgroup: string; count: number }>(sql`
    SELECT taxon_subgroup AS subgroup, COUNT(*) AS count
    FROM images i
    WHERE i.hidden = 0
      AND i.taxon_subgroup IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM reports r
        WHERE r.image_id = i.image_id AND r.resolved_at IS NULL
      )
    GROUP BY taxon_subgroup
  `);
  const byKey = new Map(rows.map(r => [r.subgroup, r.count]));
  // Return in TAXON_GROUPS order so the UI shows them in our intended sequence.
  return TAXON_GROUPS
    .map(g => ({ name: g.label, count: byKey.get(g.key.replace(/s$/, "")) ?? 0 }))
    .filter(opt => opt.count > 0);
}
```

The `key.replace(/s$/, "")` is a hack — the chip keys are plural (`butterflies`) but the DB values are singular (`butterfly`). Cleaner: just store the SAME string in both. Refactor: chip `key` = DB `taxon_subgroup` value, and the human-friendly plural label lives in `label`. Simpler. Adjust the table above accordingly.

---

## UI components

### `<CollapsibleSection>`

Reusable disclosure. Used for both the home's advanced filters AND the gallery's by-type chip wall.

```tsx
'use client';
import { useId, useState, type ReactNode } from 'react';

export interface CollapsibleSectionProps {
  title: string;
  /** Default open state. False on home, true on gallery. */
  defaultOpen?: boolean;
  /** Small badge shown in the title row when closed, e.g., "(3 selected)".
   *  Helps users notice when they have a filter applied that's hidden. */
  badge?: ReactNode;
  children: ReactNode;
}

export function CollapsibleSection({ title, defaultOpen = false, badge, children }: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <section className="collapsible-section">
      <button
        type="button"
        className="collapsible-trigger"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(o => !o)}
      >
        <span className="collapsible-chevron" aria-hidden>{open ? '▾' : '▸'}</span>
        <span className="collapsible-title">{title}</span>
        {badge && <span className="collapsible-badge">{badge}</span>}
      </button>
      <div id={id} className="collapsible-body" hidden={!open}>
        {children}
      </div>
    </section>
  );
}
```

Why React state + hidden, not native `<details>`: the `badge` slot needs custom positioning + the chevron animation is finicky inside `<summary>`. State-driven gives full design control. Native `<details>` is functionally fine but visually constrained.

### `<TaxonGroupChips>`

A multi-row flex wall of chips. Each chip toggles a selection; counts are appended.

```tsx
'use client';
import type { FilterOption } from '@/app/components/filters/FilterPopover';

export interface TaxonGroupChipsProps {
  options: FilterOption[];   // already in TAXON_GROUPS order
  selected: string[];        // chip keys
  onChange: (next: string[]) => void;
}

export function TaxonGroupChips({ options, selected, onChange }: TaxonGroupChipsProps) {
  function toggle(key: string) {
    const set = new Set(selected);
    set.has(key) ? set.delete(key) : set.add(key);
    onChange([...set]);
  }
  return (
    <div className="taxon-group-chips" role="group" aria-label="filter by type">
      {options.map(opt => {
        const active = selected.includes(opt.name);
        return (
          <button
            key={opt.name}
            type="button"
            className={`chip ${active ? 'chip-active' : ''}`}
            aria-pressed={active}
            onClick={() => toggle(opt.name)}
          >
            <span className="chip-label">{opt.name}</span>
            <span className="chip-count">{opt.count.toLocaleString()}</span>
          </button>
        );
      })}
      {selected.length > 0 && (
        <button
          type="button"
          className="chip taxon-group-clear"
          onClick={() => onChange([])}
        >
          clear
        </button>
      )}
    </div>
  );
}
```

Note: `opt.name` here is the *chip key* (`"butterflies"`), used both as the URL value and the displayed label since they're identical post-refactor. The label customization (e.g., `"dragonflies & damselflies"` for the `dragonflies` key) is handled by including the long form directly in `TAXON_GROUPS[].label` and passing that through.

### CSS

```css
.collapsible-section { display: flex; flex-direction: column; gap: var(--s3); }
.collapsible-trigger {
  display: flex; align-items: center; gap: var(--s2);
  background: transparent; border: none;
  cursor: pointer; padding: var(--s2) 0;
  font-family: var(--font-display), serif;
  font-style: italic;
  font-size: 1.15rem;
  color: var(--accent-lilac);
}
.collapsible-trigger:hover { color: var(--text-primary); }
.collapsible-chevron { color: var(--accent-pink); font-size: 0.8em; }
.collapsible-badge {
  font-family: var(--font-mono), monospace;
  font-size: 0.75rem;
  color: var(--accent-sky);
  padding: 2px var(--s2);
  border: 1px solid var(--border-medium);
  border-radius: var(--r-pill);
}
.collapsible-body { display: flex; flex-direction: column; gap: var(--s4); }

.taxon-group-chips {
  display: flex; flex-wrap: wrap; gap: var(--s2);
  padding: var(--s3) 0;
}
.taxon-group-clear {
  background: transparent !important;
  border-style: dashed !important;
  color: var(--accent-pink) !important;
}
```

---

## Page-by-page design

### Home page (`HomeClient.tsx`)

**Current state** (post-R4):
```
[header: title + tagline]
[section: interval per slide]
[section: subject type]
[section: narrow the pool] ← view / life stage / sex popovers + live count
[section: repeat behavior]
[start session button]
[gallery link]
```

**After R6:**
```
[header: title + tagline]
[section: interval per slide]
[section: subject type]
[CollapsibleSection: ▸ what kind of bug?]      ← collapsed by default
  [TaxonGroupChips with 21 chips]
[CollapsibleSection: ▸ more filters]            ← collapsed by default
  [view popover]
  [life stage popover]
  [sex popover]
[live count: "29,000 bugs in your session pool"]   ← always visible
[section: repeat behavior]
[start session button]
[gallery link]
```

Two separate collapses. The `live count` stays visible (always-on so users see filtering impact even when sections are closed). When a collapsed section has a selection, its badge shows `(3 selected)` in accent-sky.

The live count plays double duty: it's the primary indicator of "your filters are doing something." Even with everything collapsed, the count reflects all active filters.

### Gallery page (`FilterChipsControls.tsx`)

**Current state:**
```
[search bar]
[chip row: subject chips | institution popover | view popover | life stage popover | sex popover]
[result count]
[grid]
```

**After R6:**
```
[search bar]
[chip row: subject chips | institution popover | (small expand button: ▸ more filters)]
[CollapsibleSection: ▸ filter by type]          ← collapsed by default
  [TaxonGroupChips with 21 chips]
[CollapsibleSection: ▸ advanced filters]        ← collapsed by default (view, life, sex)
[result count]
[grid]
```

Why collapse the existing popovers too on the gallery? Because they're power-user features and the rows are getting busy. Keep subject + institution inline since they're recognizable.

Alternative: keep view/life/sex as visible popovers on gallery, only collapse the new `by type` chip wall. Reasonable since gallery is intentionally more configurable. **Recommend: only collapse the `by type` chip wall on gallery.** Lower disruption to existing gallery UX.

### Visual: collapsed state

```
▸ what kind of bug?              (closed, no selection)
▸ what kind of bug?    (3 selected)    ← closed but user has filters active
▾ what kind of bug?              (open)
   [butterflies 3,380] [moths 2,656] [caterpillars 2,176] [ladybugs 1,400] ...
                                                                    [clear]
```

---

## URL state

New URL parameter: `?type=butterflies,beetles,mosquitoes`. Format: comma-separated chip keys. Parsing is the same `parseList()` helper already in `FilterChipsControls.tsx`.

Home: same param key. Persists across refresh. Shareable links work.

Session start: the home pushes the current `type` filter into the request body as `groups: string[]`. The `/api/session/start` endpoint forwards it to `buildSessionPool()`.

---

## Tooltip copy (`lib/tooltips.tsx`)

```typescript
taxonGroup: {
  label: "what kind of bug?",
  content: <>
    Filter by familiar bug categories. <strong>butterflies</strong> and <strong>moths</strong> are split apart; <strong>ladybugs</strong> are their own thing separately from other <strong>beetles</strong>. <strong>weird stuff</strong> covers the small orders most people don't have a word for.
  </>,
},
```

Each chip on the home/gallery can optionally also be wrapped in a `<Tooltip>` for finer-grained help — but that's a polish step. First iteration: just the section-level tooltip is enough.

---

## Task breakdown (TDD where it makes sense)

### Task 1: Schema + migration

- [ ] Add `taxonSubgroup` column to `db/schema.ts` + `idx_images_taxon_subgroup` index.
- [ ] Hand-write `drizzle/0004_taxon_subgroup.sql` (2 lines).
- [ ] Apply: `sqlite3 data/db/line-of-bugs.db < drizzle/0004_taxon_subgroup.sql`.
- [ ] Verify: `sqlite3 data/db/line-of-bugs.db ".schema images" | grep taxon_subgroup`.
- [ ] Update `scripts/db.py` — add `"taxon_subgroup"` to `COLUMNS` + `_NULLABLE` set.
- [ ] Re-run `tests/python/test_db_writer.py` — expect 6/6 pass.
- [ ] Commit.

### Task 2: Probe iNat for taxon IDs

- [ ] Write `/tmp/probe_inat_taxon_ids.py` (~30 lines) that queries iNat `/v1/taxa?q=<name>&rank=<rank>` for each:
  - Papilionoidea (superfamily)
  - Coccinellidae (family)
  - Culicidae (family)
  - Anthophila (epifamily) or Apoidea (superfamily)
  - Formicidae (family)
  - Caelifera (suborder)
  - Ensifera (suborder)
  - Heteroptera (suborder)
  - Auchenorrhyncha (suborder)
  - Sternorrhyncha (suborder)
  - Cicadidae (family)
- [ ] Hardcode the result into the backfill script as `TAXON_ID_TO_SUBGROUP`.
- [ ] Spot-check 2-3 known rows (ladybug, mosquito, bee) → verify their `ancestor_ids` contains the expected ID.
- [ ] Delete the probe script.

### Task 3: Write the classify() function with tests (TDD)

- [ ] Create `tests/python/test_taxon_subgroup_extract.py` with these tests (all failing initially):
  - test_lepidoptera_with_papilionoidea_ancestor_returns_butterfly
  - test_lepidoptera_without_papilionoidea_returns_moth
  - test_lepidoptera_larva_returns_caterpillar
  - test_coleoptera_with_coccinellidae_returns_ladybug
  - test_coleoptera_without_coccinellidae_returns_beetle
  - test_hymenoptera_with_anthophila_returns_bee
  - test_hymenoptera_with_formicidae_returns_ant
  - test_hymenoptera_without_known_subgroup_returns_wasp
  - test_diptera_with_culicidae_returns_mosquito
  - test_diptera_without_culicidae_returns_fly
  - test_hemiptera_with_heteroptera_returns_stink_bug
  - test_hemiptera_with_sternorrhyncha_returns_aphid
  - test_odonata_returns_dragonfly
  - test_mantodea_returns_mantis
  - test_phasmatodea_returns_stick_insect
  - test_blattodea_returns_cockroach
  - test_dermaptera_returns_earwig
  - test_orthoptera_caelifera_returns_grasshopper
  - test_orthoptera_ensifera_returns_cricket
  - test_neuroptera_returns_weird (the small-orders catch-all)
  - test_empty_ancestor_ids_and_unknown_order_returns_None
- [ ] Implement `classify(taxon_order, ancestor_ids)` in `scripts/backfill_taxon_subgroup.py`.
- [ ] Run pytest. Expect all pass.
- [ ] Commit.

### Task 4: Backfill all existing rows

- [ ] `scripts/backfill_taxon_subgroup.py` main():
  - SELECT all rows where taxon_subgroup IS NULL.
  - For each: parse raw_metadata → `taxon.ancestor_ids` → `classify(taxon_order, ancestor_ids)`.
  - Batch UPDATE via executemany.
- [ ] Run it: expect ~38k rows processed in <1 min.
- [ ] Spot-check counts: `SELECT taxon_subgroup, COUNT(*) FROM images GROUP BY taxon_subgroup ORDER BY 2 DESC`.
- [ ] Verify each chip group has the expected order-of-magnitude row count.
- [ ] Commit.
- [ ] Delete `scripts/backfill_taxon_subgroup.py` (one-shot — recover from git if needed).

### Task 5: Update fetchers to populate at fetch time

- [ ] In `scripts/fetch_inaturalist.py`, import classify + add `"taxon_subgroup": classify(label, taxon.get("ancestor_ids", []) or [])` to the row dict.
- [ ] In `scripts/fetch_bugwood.py`, add a smaller `classify_bugwood(descriptorname, taxon_order, common_name)` using keyword match for the obvious ones; fall back to order-level rules.
- [ ] In `scripts/fetch_smithsonian.py`, set `taxon_subgroup` based on order-level rule (most are specimens → `weird` if no order matches a chip; otherwise the matching order's chip).
- [ ] Smoke test each via a small run (already have target met, so no API hits expected).
- [ ] Commit.

### Task 6: SQL layer (lib/taxonomy.ts + queries)

- [ ] Create `lib/taxonomy.ts` with `TAXON_GROUPS` array + `buildTaxonGroupSQL()` helper.
- [ ] Update `lib/queries/gallery.ts`:
  - Add `groups: string[]` to `SearchGalleryArgs`.
  - Add filter clause via `buildTaxonGroupSQL()`.
  - Add `listTaxonGroupCounts()` function.
- [ ] Update `lib/queries/session.ts` (`SessionFilters` + `buildSessionFilterClauses()`).
- [ ] Run `npx tsc --noEmit` — expect clean.
- [ ] Commit.

### Task 7: API routes

- [ ] `/api/gallery/page/[n]/route.ts`: read `groups` from URL, pass through.
- [ ] `/api/session/count/route.ts`: same.
- [ ] `/api/session/start/route.ts`: read `groups` from body, pass through.
- [ ] Run a manual `curl` against each — verify counts change with `?type=butterflies`.
- [ ] Commit.

### Task 8: `<CollapsibleSection>` + `<TaxonGroupChips>` components

- [ ] Write `app/components/ui/CollapsibleSection.tsx`.
- [ ] Write `app/gallery/_components/TaxonGroupChips.tsx`.
- [ ] Add CSS for both to `app/globals.css`.
- [ ] Commit.

### Task 9: Wire into gallery

- [ ] `FilterChipsBar.tsx`: add `listTaxonGroupCounts()` to the Promise.all + pass to `FilterChipsControls`.
- [ ] `FilterChipsControls.tsx`: read `?type=...` from URL; render `<CollapsibleSection title="filter by type">` containing `<TaxonGroupChips>`.
- [ ] `GalleryGrid.tsx` + `InfiniteScroller.tsx`: propagate `groups` to the page-N fetch.
- [ ] `gallery/page.tsx`: parse `?type=...` into `groups: string[]` + pass down.
- [ ] Visual playwright check: open `/gallery?type=butterflies` → expect ~3,380 result count.
- [ ] Commit.

### Task 10: Wire into home

- [ ] `app/page.tsx`: server-side fetch `listTaxonGroupCounts()` + pass to `HomeClient`.
- [ ] `HomeClient.tsx`: 
  - Add `taxonGroupCounts` prop.
  - Add `[types, setTypes]` state + URL sync.
  - Wrap "what kind of bug?" + the existing view/life/sex popovers in two `<CollapsibleSection>` instances.
  - Update the live-count effect to include `types` in the query.
  - Update the URL effect to include `type=...`.
- [ ] `StartSessionButton.tsx`: accept + POST `types`.
- [ ] `/api/session/start/route.ts`: accept + forward.
- [ ] `lib/queries/session.ts`: `buildSessionPool()` accepts `groups` + uses the new filter.
- [ ] Visual playwright check: home with `?type=butterflies` → pool count drops to ~3,380.
- [ ] Commit.

### Task 11: e2e tests

- [ ] `tests/e2e/r6-taxon-group.spec.ts`:
  - gallery: section starts collapsed; click expands; click a chip; URL updates; result count updates
  - home: section starts collapsed; expanding then selecting "butterflies" drops the pool count; URL persists
  - badge: when chip selected and section collapsed, the badge shows `(1 selected)`
- [ ] Run e2e (skip admin): expect all new tests pass + nothing regressed.
- [ ] Commit.

### Task 12: Tooltips + polish

- [ ] Add `taxonGroup` tooltip entry to `lib/tooltips.tsx`.
- [ ] Wrap the section title in `<Tooltip>` on both home + gallery.
- [ ] Verify mobile responsive: chip wall wraps cleanly at narrow widths.
- [ ] Final test sweep + commit.

### Task 13: Telegram + close out

- [ ] Send: "R6 done — layperson taxonomy filter live. 21 chip wall behind collapsible sections on home + gallery. <Final stats>."
- [ ] Mark task complete.

---

## Open questions before I start

1. **Section title wording.** Options: `"what kind of bug?"` (friendly, on-brand), `"filter by type"` (neutral), `"narrow by category"` (technical). I'd go `"what kind of bug?"` to match the rest of the design system's whimsical tone.

2. **Do we want chip tooltips per-chip?** E.g., hovering "weird stuff" shows "lacewings, mayflies, caddisflies, stoneflies, fleas, silverfish, and a handful of other tiny orders." Probably helpful, low cost, marginal. Recommend yes for at least `weird stuff` + `aphids & scales` + `stick & leaf insects` since those have non-obvious contents.

3. **Should `weird stuff` exist as a chip or just be the implicit "everything not classified"?** If we make it a chip, selecting it actively filters TO weird-stuff. If we make it implicit, selecting any other chip naturally excludes it. The chip is more discoverable but adds clutter. Recommend: include the chip — users who want to draw a lacewing should still be able to find it.

4. **Live count on home: render or hide when section is collapsed?** Current plan: always render. Means even users who never expand the section see the impact of filters. Alternative: hide when no filters are applied (some chips active), which is cleaner. Recommend: always show — discoverability over cleanliness.

5. **`<CollapsibleSection>` animation?** Native `hidden` attribute is instant. A height-collapse animation would be nicer but adds CSS complexity. Recommend: skip animation in v1, add in polish pass if it feels jarring.

6. **Should subject_state ("nature"/"specimen"/"both") move into the advanced collapse, or stay visible?** Currently visible. It's a recognizable axis but does add clutter. Recommend: keep visible — it's the most-used filter and beginners get it.

7. **What about the existing gallery filter chips bar layout?** Three popovers (view, life stage, sex) currently inline. Recommend: keep them visible on the gallery (it's a power-user surface), only collapse the new `by type` chip wall. Different from home where we collapse both.

---

## Self-review checklist

- [x] Every TaxonGroup has a unique key + label + match clause.
- [x] Backfill is idempotent (only updates rows where `taxon_subgroup IS NULL`).
- [x] Fetcher changes are additive (existing rows keep their write semantics; new rows get an extra field).
- [x] No literal user input flows into SQL — `buildTaxonGroupSQL()` parameterizes via Drizzle's `sql.join`.
- [x] URL state survives refresh + works on both home and gallery.
- [x] e2e covers the four critical paths (collapse default, chip toggle, URL sync, pool-count update).
- [x] Tooltip explains "what kind of bug?" so users don't have to interpret.
- [x] Mobile: chip wall wraps; collapse pattern saves space.
