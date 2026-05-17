# Design Pass v2 — Phase D: Iteration after first user review

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Address 9 user-feedback items from the first design-pass review — unify "bug type + species" into one control, fix tile-click download, add gallery↔home nav, retheme icons, polish copy + novelty layout.

**Architecture:** One new `WhatIsBugFilter` component unifies bug-type and species selection (autocomplete returns both group + species results). Body-section icons removed (color clash); gallery title swaps butterfly → ladybug. Tile gets a hover overlay with two action chips ("view full" / "go to source"). Novelty radio rows shrink to single-line "(high/medium/low)" labels.

**Tech Stack:** Next.js 16, React 19, TypeScript, Drizzle/SQLite (FTS5), Vitest, Playwright. New component sits alongside `AllOrChipsFilter`.

**Spec:** `docs/superpowers/specs/2026-05-16-design-pass-v2-design.md` + user feedback message dated 2026-05-17.

---

## File Structure

**Created**
- `app/components/filters/WhatIsBugFilter.tsx` — unified bug-type + species autocomplete
- `app/api/search/insect/route.ts` — combined autocomplete endpoint (returns group matches + species matches)
- `app/components/gallery/TileActions.tsx` — hover overlay with "view full" + "go to source" chips
- `tests/components/WhatIsBugFilter.test.tsx`
- `tests/components/TileActions.test.tsx`
- `tests/api/search-insect.test.ts`

**Modified**
- `app/components/home/HomeClient.tsx` — replace separate `bug type` + `species` rows with single `WhatIsBugFilter`; drop body section icons; novelty reorder
- `app/components/home/RepeatModeToggle.tsx` — new copy, default = `never-repeat-animals`, reorder
- `app/components/home/StartSessionButton.tsx` — disable when poolCount === 0 (already done in Phase A — verify)
- `app/components/home/HeroBlock.tsx` — single-line tagline width
- `app/gallery/_components/FilterChipsControls.tsx` — same `WhatIsBugFilter` swap; back-to-home link
- `app/gallery/_components/GridTile.tsx` — replace href-as-link with `<div>` + hover overlay; pass source URL + source name
- `app/gallery/page.tsx` — gallery icon swap (butterfly → ladybug); add back-to-home button
- `app/components/icons/index.tsx` — remove body emoji exports we're not using (keep `CuteFlower`, `CuteLadybug` (rename from `CuteBug`), `WiltedFlower` for empty); drop `CuteClock`/`CuteRefresh`/`CuteButterfly` import sites
- `app/globals.css` — pool count copy styling, novelty row shrink, gallery back button, tile hover overlay, paired CTAs stacked

**Static assets**
- Add: `public/icons/wilted_flower.svg` (Fluent Emoji wilted flower for empty states)
- Optionally remove: `public/icons/alarm_clock.svg`, `public/icons/counterclockwise_arrows_button.svg`, `public/icons/pensive_face.svg`, `public/icons/butterfly.svg` (if no remaining import sites — verify before deletion)

---

## Task 1: Single-line tagline + mobile wrap

**Files:**
- Modify: `app/globals.css` — `.home-tagline { max-width }`
- Verify: mobile via playwright MCP at 375×800

- [ ] **Step 1: Bump tagline max-width**

In `app/globals.css`, find `.home-tagline`:

```css
.home-tagline {
  font-family: var(--font-serif), serif;
  font-style: italic;
  margin: 0 auto;
  opacity: 0.85;
  max-width: 40rem;        /* was 28rem — fits "...with 39,631 insects, tenderly photographed" on one line at desktop */
  line-height: 1.45;
  text-wrap: balance;       /* graceful wrap when forced (mobile) */
}
```

- [ ] **Step 2: Verify desktop fits one line + mobile wraps gracefully**

Playwright MCP:
1. Resize 1440×900, navigate `/`, screenshot. Confirm tagline is one line.
2. Resize 375×800, navigate `/`, screenshot. Confirm tagline wraps to 2 lines (acceptable on mobile).

- [ ] **Step 3: Commit**

```bash
git add app/globals.css
git commit --no-gpg-sign -m "fix(home): tagline single-line at desktop, wraps gracefully on mobile"
```

---

## Task 2: Novelty redesign — reorder, default, new copy

**Files:**
- Modify: `app/components/home/RepeatModeToggle.tsx`
- Modify: `lib/tooltips.tsx`
- Modify: `app/globals.css` — `.home-radio-card` row shrink
- Modify: `app/page.tsx` (home server component) — set initialRepeat default

- [ ] **Step 1: Read current home server component to confirm default flow**

Find where `initialRepeat` is set in `app/page.tsx`. The URL param `?repeat=` parses to a `RepeatMode`. The "no param" default is currently `"default"` (= show everything). Change to `"never-repeat-animals"` (= never repeat species).

Search:
```bash
grep -n "initialRepeat\|repeatMode\|parseRepeatMode" app/page.tsx lib/repeat-mode.ts
```

Edit `app/page.tsx` — the fallback when no URL param:

```ts
// Before
const initialRepeat = parseRepeatMode(sp.repeat) ?? "default";
// After
const initialRepeat = parseRepeatMode(sp.repeat) ?? "never-repeat-animals";
```

(Adjust to the actual symbol names; the spirit is: default = "never repeat species" instead of "show everything".)

- [ ] **Step 2: Update RepeatModeToggle — new order + new copy**

Replace `app/components/home/RepeatModeToggle.tsx`:

```tsx
"use client";
import { useId } from "react";
import type { RepeatMode } from "@/lib/repeat-mode";

// Order: high variety → low variety. (high) is the default — most users
// want unique-species sessions; (low) "everything" is escape hatch.
const OPTIONS: { value: RepeatMode; label: string; level: "high" | "med" | "low" }[] = [
  { value: "never-repeat-animals", label: "never repeat the same species", level: "high" },
  { value: "allow-different-angles", label: "same species, different angles only", level: "med" },
  { value: "default", label: "include all photos of your chosen bugs", level: "low" },
];

const LEVEL_TEXT: Record<"high" | "med" | "low", string> = {
  high: "high",
  med: "medium",
  low: "low",
};

interface Props {
  value: RepeatMode;
  onChange: (v: RepeatMode) => void;
}

export function RepeatModeToggle({ value, onChange }: Props) {
  const baseId = useId();
  return (
    <div className="home-radio-list" role="radiogroup" aria-label="novelty">
      {OPTIONS.map((opt) => {
        const optId = `${baseId}-${opt.value}`;
        return (
          <label
            key={opt.value}
            htmlFor={optId}
            className={`home-radio-card${value === opt.value ? " is-selected" : ""}`}
          >
            <input
              id={optId}
              type="radio"
              name="repeat-mode"
              value={opt.value}
              checked={value === opt.value}
              onChange={() => onChange(opt.value)}
            />
            <span className="home-radio-card-text">
              <span className="home-radio-level">({LEVEL_TEXT[opt.level]})</span>{" "}
              <span className="home-radio-label">{opt.label}</span>
            </span>
          </label>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 3: Shrink the radio row CSS — single-line rows, no hint text**

In `app/globals.css`, replace the existing `.home-radio-card-text { display: flex; flex-direction: column; gap: var(--s1); }` block and `.home-radio-label` block with single-line versions:

```css
/* Phase D — single-line rows. The (level) prefix carries the verbose hint
   the old second line used to. Each row is ~36px tall instead of ~64px. */
.home-radio-card {
  padding: 0.55rem 0.85rem;
}
.home-radio-card-text {
  display: inline;
}
.home-radio-level {
  color: var(--text-tertiary);
  font-size: 0.85em;
  margin-right: 0.25rem;
}
.home-radio-card .home-radio-label {
  color: var(--text-primary);
  font-weight: 500;
}
```

(Drop any `.home-radio-hint` rules — class no longer rendered.)

- [ ] **Step 4: Update novelty tooltip copy**

In `lib/tooltips.tsx`, find `repeatMode.content` and rewrite to match new wording:

```tsx
repeatMode: {
  content: (
    <>
      <p>How sessions handle repeated species:</p>
      <ul>
        <li><strong>(high)</strong> never repeat the same species</li>
        <li><strong>(medium)</strong> same species, different angles only</li>
        <li><strong>(low)</strong> include all photos of your chosen bugs</li>
      </ul>
    </>
  ),
},
```

- [ ] **Step 5: Verify default + rendering via playwright MCP**

Navigate to `/` with empty URL. Confirm:
- Default selection = "never repeat the same species" (top row)
- Each row is a single line — no second-line hint
- Pool count reflects unique-species (should be ~9,418 on local DB)

- [ ] **Step 6: Update any existing tests that asserted old defaults**

Run:
```bash
npx vitest run --reporter=default 2>&1 | grep -E "FAIL|fail"
```

If any tests fail because they assumed old default copy / old order, fix the assertion (not the code).

- [ ] **Step 7: Commit**

```bash
git add app/components/home/RepeatModeToggle.tsx app/page.tsx lib/tooltips.tsx app/globals.css
git commit --no-gpg-sign -m "feat(novelty): default=never-repeat, reorder high→low, single-line rows

(high)/(medium)/(low) prefixes carry the verbose hint, so each row
shrinks from two lines to one. Default flips from 'show everything' to
'never repeat the same species' — that's what most users want."
```

---

## Task 3: Pool count cuter copy + occasional 1-in-a-million variant

**Files:**
- Modify: `app/components/home/HomeClient.tsx`
- Modify: `app/globals.css` (only if styling tweaks needed)

- [ ] **Step 1: Update pool count copy**

In `HomeClient.tsx`, find the `.home-pool-count` block:

```tsx
<p className="home-pool-count" aria-live="polite">
  {facetsLoading ? (
    "counting…"
  ) : poolCount === 0 ? (
    <span className="home-pool-empty">
      <SadBug size={22} /> no insects match — try broadening the filters
    </span>
  ) : (
    <>
      you have <span key={poolCount} className="home-pool-count-num">{poolCount.toLocaleString()}</span> bugs to draw
    </>
  )}
</p>
```

(Note: `SadBug` may be renamed in Task 5 — verify the import after that task lands. For Task 3 alone, keep as-is.)

- [ ] **Step 2: Add 1-in-a-million "X bugs are waiting" variant**

Replace the success branch with a tiny random pick at module scope (so it doesn't re-roll on every render):

```tsx
// At top of file (module scope, outside the component):
const POOL_COPY_PRIMARY = "you have {n} bugs to draw";
const POOL_COPY_RARE = "{n} bugs are waiting";
// Roll once per browser session. 1 / 1,000,000 chance of the rare variant —
// users who see it can screenshot. Don't re-roll on count change.
function pickPoolCopy(): string {
  if (typeof window !== "undefined" && Math.random() < 1e-6) {
    return POOL_COPY_RARE;
  }
  return POOL_COPY_PRIMARY;
}
```

In the component, use:

```tsx
const poolCopyTemplate = useRef(pickPoolCopy());
// ...
{poolCount === 0 ? (
  <span className="home-pool-empty"> ... </span>
) : (() => {
  const [before, after] = poolCopyTemplate.current.split("{n}");
  return (
    <>
      {before}
      <span key={poolCount} className="home-pool-count-num">{poolCount.toLocaleString()}</span>
      {after}
    </>
  );
})()}
```

Add `import { useRef } from "react";` if not present.

- [ ] **Step 3: Verify both variants render**

Unit-test the copy logic separately by forcing the random:

Create `tests/components/HomeClient.poolCopy.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render } from "vitest-browser-react";
// ... typical setup

it("pool count uses primary copy by default", async () => {
  vi.spyOn(Math, "random").mockReturnValue(0.5);
  // render HomeClient with mock facets...
  // assert "you have 39,631 bugs to draw" appears
});

it("pool count uses rare copy when random is below 1e-6", async () => {
  vi.spyOn(Math, "random").mockReturnValue(1e-7);
  // assert "39,631 bugs are waiting" appears
});
```

(If the existing test harness already mocks props for HomeClient, mirror that. Otherwise add a thin wrapper that renders just the count line in isolation.)

- [ ] **Step 4: Commit**

```bash
git add app/components/home/HomeClient.tsx tests/components/HomeClient.poolCopy.test.tsx
git commit --no-gpg-sign -m "feat(home): pool count copy 'you have X bugs to draw' + 1-in-1M rare variant

Primary: 'you have 39,631 bugs to draw' (warmer than 'in your session pool').
Easter egg: 1 / 1,000,000 sessions roll the 'X bugs are waiting' variant —
seeing it is a little surprise worth screenshotting."
```

---

## Task 4: Gallery CTA below start session, equal width

**Files:**
- Modify: `app/globals.css`
- Verify: `app/components/home/HomeClient.tsx` (no JSX changes — CTAs are already side-by-side; CSS controls layout)

- [ ] **Step 1: Restack CTAs vertically + match widths**

In `app/globals.css`, replace the existing `.home-ctas` block:

```css
.home-ctas {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.85rem;
  margin: 1rem auto 0;
}

.home-start,
.home-gallery-link {
  /* Equal-width pair — drives off the wider of the two labels. */
  min-width: 16rem;
  width: 16rem;
  max-width: 90vw;
}
```

(Keep the existing fill/outline/glow rules below this block.)

- [ ] **Step 2: Visual verify desktop + mobile**

Playwright MCP:
1. Resize 1440×900 → screenshot home. Confirm gallery link is BELOW start session, same width.
2. Resize 375×800 → screenshot. Confirm stacked layout still works.

- [ ] **Step 3: Commit**

```bash
git add app/globals.css
git commit --no-gpg-sign -m "fix(home): stack CTAs vertically — start session above, gallery below, same width"
```

---

## Task 5: Body section icons removed; gallery icon = ladybug; empty state = wilted flower

**Files:**
- Modify: `app/components/home/HomeClient.tsx` — drop `CuteClock`, `CuteRefresh`, `CuteBug` from section titles
- Modify: `app/gallery/page.tsx` — gallery title uses ladybug (was butterfly)
- Modify: `app/components/icons/index.tsx` — add `WiltedFlower` export, swap empty-state icon
- Create: `public/icons/wilted_flower.svg` — fetched from Fluent Emoji
- Modify: `app/components/home/HomeClient.tsx` + `app/gallery/_components/GalleryGrid.tsx` — use `WiltedFlower` for empty states (was `SadBug`)
- Modify: `tests/components/icons.test.tsx` — update icon roster

- [ ] **Step 1: Fetch the Wilted Flower SVG from Fluent Emoji**

Run:
```bash
curl -sL "https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/assets/Wilted%20flower/Color/wilted_flower_color.svg" -o /Users/adoll/projects/line-of-bugs/public/icons/wilted_flower.svg
ls -la /Users/adoll/projects/line-of-bugs/public/icons/wilted_flower.svg
```

Expected: ~10-30KB SVG file, first bytes `<svg`.

- [ ] **Step 2: Update icons/index.tsx — add WiltedFlower, rename CuteBug → CuteLadybug**

In `app/components/icons/index.tsx`:

```tsx
// Keep existing makeIcon helper
export const CuteFlower = makeIcon("cherry_blossom.svg", "cherry blossom");
export const CuteLadybug = makeIcon("lady_beetle.svg", "ladybug");
export const WiltedFlower = makeIcon("wilted_flower.svg", "wilted flower");

// Deprecated — kept exporting temporarily so callers can migrate; remove
// in a follow-up commit once HomeClient + GalleryGrid stop importing them.
export const CuteButterfly = makeIcon("butterfly.svg", "butterfly");
export const CuteClock = makeIcon("alarm_clock.svg", "alarm clock");
export const CuteRefresh = makeIcon("counterclockwise_arrows_button.svg", "refresh");
export const CuteBug = CuteLadybug;       // backwards-compat alias
export const SadBug = WiltedFlower;       // backwards-compat alias
```

- [ ] **Step 3: Drop body section icons from HomeClient**

In `app/components/home/HomeClient.tsx`, find the three section titles and remove the icon component from each:

```tsx
// Before:
<h2 className="home-section-title">
  <CuteClock size={26} />
  <Tooltip content={TOOLTIPS.interval.content}>
    <span>interval per slide</span>
  </Tooltip>
</h2>
// After:
<h2 className="home-section-title">
  <Tooltip content={TOOLTIPS.interval.content}>
    <span>interval per slide</span>
  </Tooltip>
</h2>
```

Same treatment for `filters` (drop `<CuteBug />`) and `novelty` (drop `<CuteRefresh />`).

Drop the unused imports.

Empty-state inside the pool-count `<p>`: swap to `WiltedFlower`:

```tsx
<span className="home-pool-empty">
  <WiltedFlower size={22} /> no insects match — try broadening the filters
</span>
```

Update the import.

- [ ] **Step 4: Drop section-icon CSS that no longer applies**

In `app/globals.css`, find `.home-section-title > svg` and `.home-section-title > img` (or similar) and remove rules that target the absent icons. Find:

```css
.home-section-title > svg {
  color: var(--accent-pink);
  filter: drop-shadow(0 0 6px color-mix(in srgb, var(--accent-pink) 30%, transparent));
  transition: transform 300ms cubic-bezier(0.22, 1, 0.36, 1);
}
.home-section:hover .home-section-title > svg {
  transform: rotate(-8deg) scale(1.08);
}
```

Delete both blocks. Section titles are now text-only.

- [ ] **Step 5: Gallery title — butterfly → ladybug**

In `app/gallery/page.tsx`:

```tsx
// Before:
import { CuteButterfly } from '@/app/components/icons';
// ...
<h1 className="gallery-title">
  gallery <CuteButterfly size={36} className="gallery-title-icon" loading="eager" />
</h1>

// After:
import { CuteLadybug } from '@/app/components/icons';
// ...
<h1 className="gallery-title">
  gallery <CuteLadybug size={36} className="gallery-title-icon" loading="eager" />
</h1>
```

- [ ] **Step 6: Gallery empty state — swap SadBug → WiltedFlower**

In `app/gallery/_components/GalleryGrid.tsx`:

```tsx
// Before:
import { SadBug } from '@/app/components/icons';
// ...
<SadBug size={56} className="gallery-empty-icon" />

// After:
import { WiltedFlower } from '@/app/components/icons';
// ...
<WiltedFlower size={56} className="gallery-empty-icon" />
```

- [ ] **Step 7: Gallery CTA on home — butterfly stays (still consistent w/ Bluesky issue, per user OK)**

Verify the gallery CTA in `HomeClient.tsx` still renders `CuteButterfly` (the user said this one is "fine, maybe"). If it's the silhouette conflict that bothers the user only in social-row context, leaving the butterfly on the CTA is OK. Confirm by visual review with playwright MCP after this task.

Actually — re-reading user feedback: "the gallery butterfly maybe, kind of iffy". They said "Yes" to honeybee for differentiation, then said honeybee reasoning was shallow. We reverted to **ladybug** as the unified gallery icon (gallery title AND gallery CTA on home). Both places use `CuteLadybug`.

So also update the home gallery CTA:

```tsx
// In HomeClient.tsx, gallery CTA:
<a href="/gallery" className="home-gallery-link">
  <CuteLadybug size={22} className="home-gallery-link-icon" />
  browse the gallery <span aria-hidden>→</span>
</a>
```

Update the import.

- [ ] **Step 8: Update icons.test.tsx**

In `tests/components/icons.test.tsx`, add `CuteLadybug` and `WiltedFlower` to the `it.each` table. Keep deprecated aliases (`CuteBug`, `SadBug`) covered so the back-compat alias holds. Drop nothing — additive.

```tsx
import {
  CuteFlower,
  CuteButterfly,
  CuteClock,
  CuteBug,
  CuteLadybug,
  CuteRefresh,
  SadBug,
  WiltedFlower,
} from "@/app/components/icons";

describe("cute icons", () => {
  it.each([
    ["CuteFlower", CuteFlower],
    ["CuteButterfly", CuteButterfly],
    ["CuteClock", CuteClock],
    ["CuteBug", CuteBug],
    ["CuteLadybug", CuteLadybug],
    ["CuteRefresh", CuteRefresh],
    ["SadBug", SadBug],
    ["WiltedFlower", WiltedFlower],
  ] as const)("renders %s as an img with aria-hidden + size", async (name, Cmp) => {
    // ... existing body unchanged
  });
});
```

- [ ] **Step 9: Visual verify**

Playwright MCP:
1. `/` desktop — no icons next to section titles, gallery CTA has ladybug
2. `/gallery` desktop — title is "gallery 🐞"
3. Filter to a no-match state on `/gallery` — empty state shows wilted flower

- [ ] **Step 10: Commit**

```bash
git add app/components/icons/index.tsx public/icons/wilted_flower.svg \
        app/components/home/HomeClient.tsx app/gallery/page.tsx \
        app/gallery/_components/GalleryGrid.tsx app/globals.css \
        tests/components/icons.test.tsx
git commit --no-gpg-sign -m "feat(icons): retheme — drop body section icons, ladybug for gallery, wilted flower for empty

User audit: Fluent Color emoji clash in body usage (yellow alarm clock,
blue refresh arrows vs pink/lilac theme). Drop body section icons
entirely — serif italic titles carry the personality. Reserve color
emoji for accent moments:

- Title: cherry blossom (unchanged)
- Gallery title + home CTA: ladybug (was blue butterfly — silhouette
  conflict with Bluesky logo)
- Empty states: wilted flower (was pensive face — fits theme better)

CuteBug/SadBug kept as back-compat aliases for one cycle."
```

---

## Task 6: Unified "what is bug?" filter — combined autocomplete API

**Files:**
- Create: `app/api/search/insect/route.ts`
- Create: `tests/api/search-insect.test.ts`
- Verify: `lib/queries/gallery.ts` already has `searchSpeciesAutocomplete` (or similar) — reuse

- [ ] **Step 1: Read the existing species autocomplete query**

Find the existing species autocomplete used by `SpeciesAutocomplete.tsx`. Grep:

```bash
grep -rn "autocomplete\|/api/species" app/ lib/ --include="*.ts" --include="*.tsx" | head -20
```

Note the endpoint path (likely `/api/species/search` or `/api/species/autocomplete`) and its return shape `{ name: string, count: number }[]`.

- [ ] **Step 2: Write failing test for unified endpoint**

Create `tests/api/search-insect.test.ts`:

```ts
import { describe, it, expect } from "vitest";

describe("GET /api/search/insect", () => {
  it("typing 'but' returns the Butterflies group AND any matching species", async () => {
    const res = await fetch("http://localhost:3000/api/search/insect?q=but");
    expect(res.ok).toBe(true);
    const data = await res.json() as { results: Array<{ kind: "group" | "species"; value: string; label: string; count: number }> };
    const kinds = new Set(data.results.map((r) => r.kind));
    expect(kinds.has("group")).toBe(true);
    expect(kinds.has("species")).toBe(true);
    const butterfliesGroup = data.results.find((r) => r.kind === "group" && /butter/i.test(r.label));
    expect(butterfliesGroup).toBeDefined();
  });

  it("typing 'monarch' returns the Monarch species but no group", async () => {
    const res = await fetch("http://localhost:3000/api/search/insect?q=monarch");
    const data = await res.json() as { results: Array<{ kind: string; label: string }> };
    expect(data.results.some((r) => /monarch/i.test(r.label) && r.kind === "species")).toBe(true);
  });

  it("empty query returns empty results", async () => {
    const res = await fetch("http://localhost:3000/api/search/insect?q=");
    const data = await res.json() as { results: unknown[] };
    expect(data.results).toEqual([]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
npx vitest run tests/api/search-insect.test.ts
```
Expected: FAIL — endpoint doesn't exist.

- [ ] **Step 4: Implement the endpoint**

Create `app/api/search/insect/route.ts`:

```ts
import { db } from "@/db";
import { TAXON_GROUPS } from "@/lib/taxonomy";
import { buildFtsTag } from "@/lib/queries/filter-clauses";
import { sql } from "drizzle-orm";

interface ResultRow {
  kind: "group" | "species";
  /** URL-encodable value: for group, the chip key (e.g. "butterflies"); for species, the common name OR scientific. */
  value: string;
  /** Human-readable label shown in the autocomplete dropdown. */
  label: string;
  /** Pre-computed count of matching images. */
  count: number;
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
  if (!q) return Response.json({ results: [] });

  // Group matches: substring match against the chip's user-facing label.
  const groupResults: ResultRow[] = [];
  for (const g of TAXON_GROUPS) {
    if (g.label.toLowerCase().includes(q)) {
      // Count = sum of image counts across the group's dbValues.
      const counts = db.all<{ c: number }>(sql`
        SELECT COUNT(*) AS c FROM images
        WHERE hidden = 0 AND taxon_subgroup IN (${sql.join(g.dbValues.map((v) => sql`${v}`), sql`, `)})
      `);
      groupResults.push({
        kind: "group",
        value: g.key,
        label: g.label,
        count: counts[0]?.c ?? 0,
      });
    }
  }

  // Species matches via FTS5 — reuse the same buildFtsTag helper SpeciesAutocomplete uses.
  // Each result is one common-name + species pair with its image count.
  const ftsExpr = buildFtsTag(q);
  const speciesResults: ResultRow[] = [];
  if (ftsExpr) {
    const rows = db.all<{ common_name: string; taxon_species: string; c: number }>(sql`
      SELECT i.common_name, i.taxon_species, COUNT(*) AS c
      FROM images_fts f
      JOIN images i ON i.image_id = f.image_id
      WHERE images_fts MATCH ${ftsExpr}
        AND i.hidden = 0
      GROUP BY i.common_name, i.taxon_species
      ORDER BY c DESC
      LIMIT 15
    `);
    for (const r of rows) {
      const label = r.common_name || r.taxon_species || "(unnamed)";
      const value = r.common_name || r.taxon_species;
      if (!value) continue;
      speciesResults.push({
        kind: "species",
        value,
        label,
        count: r.c,
      });
    }
  }

  // Interleave: groups first (more general), then species. Cap at 20 total.
  const combined = [...groupResults, ...speciesResults].slice(0, 20);
  return Response.json({ results: combined }, {
    headers: { "Cache-Control": "public, max-age=30" },
  });
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npx vitest run tests/api/search-insect.test.ts
```
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add app/api/search/insect/route.ts tests/api/search-insect.test.ts
git commit --no-gpg-sign -m "feat(api): /api/search/insect — unified autocomplete (groups + species)

Returns mixed result list of taxon-groups (chip keys like 'butterflies')
and species (FTS5 against common_name + taxon_species). Each result
includes its kind so the UI can render a type badge."
```

---

## Task 7: Unified `<WhatIsBugFilter>` component

**Files:**
- Create: `app/components/filters/WhatIsBugFilter.tsx`
- Create: `app/components/filters/WhatIsBugFilter.module.css`
- Create: `tests/components/WhatIsBugFilter.test.tsx`

- [ ] **Step 1: Failing test — empty state + autocomplete render**

Create `tests/components/WhatIsBugFilter.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render } from "vitest-browser-react";
import { WhatIsBugFilter } from "@/app/components/filters/WhatIsBugFilter";

describe("WhatIsBugFilter empty state", () => {
  it("renders 'all bug types' chip when nothing selected", async () => {
    const screen = await render(
      <WhatIsBugFilter
        selectedGroups={[]}
        selectedSpecies={[]}
        onGroupsChange={vi.fn()}
        onSpeciesChange={vi.fn()}
        totalCount={39632}
      />,
    );
    const chip = screen.getByRole("combobox", { name: /all bug types/i });
    await expect.element(chip).toBeInTheDocument();
  });

  it("clicking the empty chip opens a search input", async () => {
    const screen = await render(
      <WhatIsBugFilter
        selectedGroups={[]}
        selectedSpecies={[]}
        onGroupsChange={vi.fn()}
        onSpeciesChange={vi.fn()}
        totalCount={39632}
      />,
    );
    await screen.getByRole("combobox").click();
    await expect.element(screen.getByPlaceholder(/type a bug type or species/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run tests/components/WhatIsBugFilter.test.tsx
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the component**

Create `app/components/filters/WhatIsBugFilter.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./WhatIsBugFilter.module.css";

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
  /** Total image count when no filter set — shown in the empty chip. */
  totalCount: number;
}

export function WhatIsBugFilter({
  selectedGroups,
  selectedSpecies,
  onGroupsChange,
  onSpeciesChange,
  totalCount,
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

  const isEmpty = selectedGroups.length === 0 && selectedSpecies.length === 0;

  function pickResult(r: SearchResult) {
    if (r.kind === "group") {
      if (!selectedGroups.includes(r.value)) {
        onGroupsChange([...selectedGroups, r.value]);
      }
    } else {
      if (!selectedSpecies.includes(r.value)) {
        onSpeciesChange([...selectedSpecies, r.value]);
      }
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
      {isEmpty ? (
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-label={`all bug types · ${totalCount.toLocaleString()}`}
          className={`${styles.chip} ${styles.empty} ${open ? styles.open : ""}`}
          onClick={() => setOpen((o) => !o)}
        >
          all bug types · {totalCount.toLocaleString()} <span aria-hidden>⌄</span>
        </button>
      ) : (
        <div className={styles.chipWall}>
          {selectedGroups.map((g) => (
            <span key={`g-${g}`} className={`${styles.chip} ${styles.selectedGroup}`}>
              <span className={styles.kindBadge}>group</span>
              <span>{g}</span>
              <button type="button" aria-label={`remove ${g}`} className={styles.removeBtn} onClick={() => removeGroup(g)}>×</button>
            </span>
          ))}
          {selectedSpecies.map((s) => (
            <span key={`s-${s}`} className={`${styles.chip} ${styles.selectedSpecies}`}>
              <span className={styles.kindBadge}>species</span>
              <span>{s}</span>
              <button type="button" aria-label={`remove ${s}`} className={styles.removeBtn} onClick={() => removeSpecies(s)}>×</button>
            </span>
          ))}
          <button type="button" aria-label="add another" className={`${styles.chip} ${styles.addBtn}`} onClick={() => setOpen(true)}>
            + add another
          </button>
        </div>
      )}

      {open && (
        <div className={styles.picker}>
          <input
            ref={inputRef}
            type="text"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="type a bug type or species…"
            className={styles.search}
            onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}
          />
          <ul role="listbox" className={styles.list}>
            {results.map((r) => (
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
            ))}
            {query && results.length === 0 && <li className={styles.empty}>no matches</li>}
            {!query && <li className={styles.empty}>start typing to see suggestions</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Add the CSS module**

Create `app/components/filters/WhatIsBugFilter.module.css`:

```css
.wrap { position: relative; display: inline-block; width: 100%; }

.chip {
  display: inline-flex; align-items: center; gap: 0.4rem;
  padding: 0.5rem 0.9rem;
  border-radius: 999px;
  border: 1px solid var(--surface-2);
  background: var(--surface-1);
  color: var(--text-primary);
  font-size: 0.95rem; font-family: inherit;
  cursor: pointer;
  transition: transform 200ms cubic-bezier(0.22, 1, 0.36, 1),
              box-shadow 200ms cubic-bezier(0.22, 1, 0.36, 1),
              background 200ms cubic-bezier(0.22, 1, 0.36, 1);
}
.chip:hover { transform: translateY(-1px); box-shadow: 0 0 12px 2px color-mix(in srgb, var(--accent-pink) 35%, transparent); }
.chip.empty { background: color-mix(in srgb, var(--accent-pink) 18%, transparent); border-color: color-mix(in srgb, var(--accent-pink) 35%, transparent); }
.chip.open  { background: color-mix(in srgb, var(--accent-pink) 28%, transparent); }
.chip.selectedGroup   { background: color-mix(in srgb, var(--accent-pink) 22%, transparent); }
.chip.selectedSpecies { background: color-mix(in srgb, var(--accent-lilac) 22%, transparent); }
.chip.addBtn          { border-style: dashed; }

.chipWall { display: flex; flex-wrap: wrap; gap: 0.5rem; }

.kindBadge {
  display: inline-block;
  padding: 0.1rem 0.45rem;
  border-radius: 999px;
  background: color-mix(in srgb, currentColor 15%, transparent);
  font-size: 0.7rem;
  font-style: italic;
  opacity: 0.75;
  text-transform: lowercase;
}

.removeBtn { appearance: none; background: none; border: 0; color: inherit; cursor: pointer; padding: 0 0.1rem; font-size: 1rem; line-height: 1; opacity: 0.7; border-radius: 999px; }
.removeBtn:hover { opacity: 1; }
.removeBtn:focus-visible { outline: 2px solid var(--accent-pink); outline-offset: 2px; }

.picker {
  position: absolute; top: calc(100% + 0.5rem); left: 0; z-index: 50;
  min-width: 22rem; max-width: 32rem;
  background: var(--surface-1); border: 1px solid var(--surface-2); border-radius: 1rem; padding: 0.5rem;
  box-shadow: 0 8px 32px rgba(0,0,0,0.35);
  animation: pickerIn 200ms cubic-bezier(0.22, 1, 0.36, 1);
}
@keyframes pickerIn { from { transform: translateY(-4px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }

.search {
  width: 100%; box-sizing: border-box; padding: 0.5rem 0.75rem;
  background: var(--surface-0); border: 1px solid var(--surface-2); border-radius: 0.5rem;
  color: inherit; font-family: inherit; font-size: 0.9rem; margin-bottom: 0.5rem;
}

.list { list-style: none; margin: 0; padding: 0; max-height: 22rem; overflow-y: auto; }
.row {
  display: flex; align-items: center; gap: 0.5rem;
  padding: 0.5rem 0.75rem; border-radius: 0.5rem; cursor: pointer; font-size: 0.9rem;
}
.row:hover { background: color-mix(in srgb, var(--accent-pink) 12%, transparent); }
.rowLabel { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rowCount { font-variant-numeric: tabular-nums; opacity: 0.7; font-size: 0.85rem; }

.empty { padding: 0.75rem; text-align: center; opacity: 0.6; font-size: 0.85rem; }
```

- [ ] **Step 5: Run tests**

```bash
npx vitest run tests/components/WhatIsBugFilter.test.tsx
```
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add app/components/filters/WhatIsBugFilter.tsx app/components/filters/WhatIsBugFilter.module.css tests/components/WhatIsBugFilter.test.tsx
git commit --no-gpg-sign -m "feat(filters): WhatIsBugFilter — unified bug-type + species autocomplete

Single control where users type a bug type ('butterflies') or species
('monarch') and pick from a mixed result list. Each chip carries a
'group' or 'species' badge so the hierarchy stays visible after pick."
```

---

## Task 8: Wire `WhatIsBugFilter` into HomeClient + gallery — remove separate species row

**Files:**
- Modify: `app/components/home/HomeClient.tsx` — remove the separate bug-type and species rows; add WhatIsBugFilter row
- Modify: `app/gallery/_components/FilterChipsControls.tsx` — same swap
- Modify: existing e2e tests that target the old `all bug types` chip or species autocomplete — update selectors

- [ ] **Step 1: HomeClient swap**

In `HomeClient.tsx`, remove the two filter rows for bug type and species, replace with one row:

```tsx
import { WhatIsBugFilter } from "@/app/components/filters/WhatIsBugFilter";

// In the filter rows section, replace the two FilterRow blocks for "bug type"
// and "species" with ONE FilterRow:
<FilterRow label="what is bug?">
  <WhatIsBugFilter
    selectedGroups={groups}
    selectedSpecies={species}
    onGroupsChange={setGroups}
    onSpeciesChange={setSpecies}
    totalCount={initialFacetsRef.current.total}
  />
</FilterRow>
```

Drop the now-unused `SpeciesAutocomplete` import and its `addSpecies`/`removeSpecies` helpers if they're not used elsewhere in this file.

- [ ] **Step 2: Gallery swap**

In `app/gallery/_components/FilterChipsControls.tsx`, perform the same replacement: drop the separate `bug type` and `species` rows, add one `WhatIsBugFilter` row.

- [ ] **Step 3: Update home e2e**

In `tests/e2e/home-redesign.spec.ts`, find the test "filter rows render with all-or-chips empty state". The expected labels list includes `"all bug types"` — keep that (it's still rendered by `WhatIsBugFilter`'s empty state). Drop any explicit "species" row check.

Add a new test:

```ts
test("WhatIsBugFilter autocomplete shows groups + species", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("combobox", { name: /all bug types/i }).click();
  await page.getByPlaceholder(/type a bug type or species/i).fill("monarch");
  await page.waitForResponse((r) => r.url().includes("/api/search/insect"));
  // Monarch is a species; result list should show it with the 'species' badge.
  await expect(page.locator(".kindBadge", { hasText: /species/i }).first()).toBeVisible();
});
```

(Class selectors with CSS modules are obfuscated — verify via `getByRole` + role=option instead if needed. If selector doesn't work, switch to `await expect(page.getByRole("option").filter({ hasText: /monarch/i }).first()).toBeVisible();`.)

- [ ] **Step 4: Run unit + e2e**

```bash
npx tsc --noEmit && npx vitest run --reporter=default && npx playwright test tests/e2e/home-redesign.spec.ts --reporter=line
```
Expected: all green.

- [ ] **Step 5: Visual verify**

Playwright MCP:
1. `/` desktop — one row reads "what is bug?" with the empty chip
2. Click the chip, type "but" → see both group ("butterflies") and species results
3. Select a group → chip with "group" badge appears
4. Select a species → chip with "species" badge appears
5. `/gallery` same behavior

- [ ] **Step 6: Commit**

```bash
git add app/components/home/HomeClient.tsx app/gallery/_components/FilterChipsControls.tsx tests/e2e/home-redesign.spec.ts
git commit --no-gpg-sign -m "feat(filters): unify bug-type + species into one 'what is bug?' row

Drop the side-by-side bug type and species rows. One control accepts
both — autocomplete shows mixed group + species results with a kind
badge per chip."
```

---

## Task 9: Tile hover overlay — view full + go to source

**Files:**
- Create: `app/components/gallery/TileActions.tsx`
- Modify: `app/gallery/_components/GridTile.tsx`
- Modify: `app/globals.css`
- Test: `tests/components/TileActions.test.tsx`

- [ ] **Step 1: Failing test for the overlay**

Create `tests/components/TileActions.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render } from "vitest-browser-react";
import { TileActions } from "@/app/components/gallery/TileActions";

describe("TileActions overlay", () => {
  it("renders 'view full' link to our /api/img route", async () => {
    const screen = await render(
      <TileActions viewFullHref="/api/img/test.jpg" sourceHref="https://example.com/source" sourceName="Bugwood" />,
    );
    const view = screen.getByRole("link", { name: /view full/i });
    const node = view.element() as HTMLAnchorElement;
    expect(node.getAttribute("href")).toBe("/api/img/test.jpg");
    expect(node.getAttribute("target")).toBe("_blank");
  });

  it("renders 'source' link with external indicator + source name in label", async () => {
    const screen = await render(
      <TileActions viewFullHref="/api/img/test.jpg" sourceHref="https://example.com/source" sourceName="iNaturalist" />,
    );
    const src = screen.getByRole("link", { name: /go to iNaturalist/i });
    const node = src.element() as HTMLAnchorElement;
    expect(node.getAttribute("href")).toBe("https://example.com/source");
    expect(node.getAttribute("target")).toBe("_blank");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run tests/components/TileActions.test.tsx
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement TileActions**

Create `app/components/gallery/TileActions.tsx`:

```tsx
interface TileActionsProps {
  /** Our cached image route — viewable in-browser. */
  viewFullHref: string;
  /** External source URL (bugwoodcloud.org / iNat detail page). */
  sourceHref: string;
  /** Source name for the second chip's accessible label (e.g. "Bugwood"). */
  sourceName: string;
}

export function TileActions({ viewFullHref, sourceHref, sourceName }: TileActionsProps) {
  return (
    <div className="tile-actions" aria-label="tile actions">
      <a
        href={viewFullHref}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="view full"
        className="tile-action"
      >
        view full
      </a>
      <a
        href={sourceHref}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`go to ${sourceName}`}
        className="tile-action"
      >
        {sourceName} <span aria-hidden>↗</span>
      </a>
    </div>
  );
}
```

- [ ] **Step 4: Tile CSS — overlay only on hover/focus**

Append to `app/globals.css`:

```css
.tile-actions {
  position: absolute;
  inset: auto 0.6rem 0.6rem auto;
  display: flex;
  gap: 0.4rem;
  opacity: 0;
  transition: opacity 200ms cubic-bezier(0.22, 1, 0.36, 1);
  pointer-events: none;
}
.grid-item:hover .tile-actions,
.grid-item:focus-within .tile-actions {
  opacity: 1;
  pointer-events: auto;
}
.tile-action {
  display: inline-flex; align-items: center; gap: 0.25rem;
  padding: 0.35rem 0.65rem;
  border-radius: 999px;
  background: color-mix(in srgb, var(--surface-0) 90%, transparent);
  border: 1px solid color-mix(in srgb, var(--accent-pink) 35%, transparent);
  color: var(--text-primary);
  font-size: 0.78rem;
  text-decoration: none;
  backdrop-filter: blur(8px);
}
.tile-action:hover {
  background: color-mix(in srgb, var(--accent-pink) 25%, var(--surface-0));
}
```

- [ ] **Step 5: Rewrite GridTile — convert outer anchor to article, mount TileActions**

Replace `GridTile.tsx`:

```tsx
import Image from 'next/image';
import type { GalleryRow } from '@/lib/queries/gallery';
import { isOrderOnlyId, titleCaseCommonName } from '@/lib/text-format';
import { TileActions } from '@/app/components/gallery/TileActions';

function basename(p: string): string {
  return p.split('/').pop() ?? p;
}

function sourceName(source: string): string {
  if (source === 'inaturalist') return 'iNaturalist';
  if (source === 'bugwood') return 'Bugwood';
  return source;
}

export function GridTile({ row }: { row: GalleryRow }) {
  const thumbName = basename(row.thumbnail_filename);
  const mediumName = basename(row.medium_filename);
  const commonName = titleCaseCommonName(row.common_name);
  const orderOnly = isOrderOnlyId(row.common_name, row.taxon_species, row.taxon_order);
  return (
    <article
      className="grid-item"
      data-id={row.image_id}
      data-image-path={row.medium_filename}
    >
      <div className="grid-item-image">
        <Image
          src={`/api/thumb/${thumbName}`}
          alt={commonName || row.taxon_species || (row.taxon_order ? `${row.taxon_order} specimen` : 'specimen')}
          fill
          sizes="(min-width: 1024px) 240px, (min-width: 600px) 200px, 50vw"
          style={{ objectFit: 'cover' }}
        />
        {row.collection_size > 1 && (
          <span className="grid-item-badge">
            {row.collection_index} / {row.collection_size}
          </span>
        )}
        <TileActions
          viewFullHref={`/api/medium/${mediumName}`}
          sourceHref={row.image_url}
          sourceName={sourceName(row.source)}
        />
      </div>
      <div className="grid-item-meta">
        {commonName && (
          <span className="grid-item-name">
            {commonName}
            {orderOnly && <span className="grid-item-order-hint"> (order)</span>}
          </span>
        )}
        {row.taxon_species && !orderOnly && (
          <span className="grid-item-species">{row.taxon_species}</span>
        )}
      </div>
    </article>
  );
}
```

(Verify `row.source` exists on the `GalleryRow` type; if not, add it to the projection in `lib/queries/gallery.ts`. Mostly likely it does — gallery already shows source in some places.)

- [ ] **Step 6: Update tests that assumed tile was an anchor**

Grep:
```bash
grep -rn "grid-item.*anchor\|grid-item.*href\|toHaveAttribute.*href" tests/ | head
```
Update any tests that asserted `<a class="grid-item">`.

- [ ] **Step 7: Visual verify**

Playwright MCP:
1. `/gallery` desktop — hover a tile. Two chips appear in bottom-right: "view full" + "Bugwood ↗" (or iNat).
2. Click "view full" — opens `/api/medium/...jpg` in new tab, image displays in-browser (no download).
3. Click "source" — opens external URL in new tab.

- [ ] **Step 8: Run tests**

```bash
npx tsc --noEmit && npx vitest run --reporter=default
```

- [ ] **Step 9: Commit**

```bash
git add app/components/gallery/TileActions.tsx app/gallery/_components/GridTile.tsx app/globals.css tests/components/TileActions.test.tsx
git commit --no-gpg-sign -m "feat(gallery): tile hover overlay — view full + go to source

Tiles no longer link directly to bugwoodcloud.org (which serves with
Content-Disposition: attachment forcing download). Instead, hover
reveals two action chips:
  - 'view full' → our /api/medium route, always in-browser viewable
  - 'go to {source}' → external source page with ↗ indicator

Tile itself converts from <a> to <article> — the hover chips are the
only click targets."
```

---

## Task 10: Gallery back-to-home button

**Files:**
- Modify: `app/gallery/page.tsx`
- Modify: `app/globals.css`

- [ ] **Step 1: Add back button to gallery header**

In `app/gallery/page.tsx`:

```tsx
import { CuteLadybug } from '@/app/components/icons';
// ... add import
import Link from 'next/link';

// In the header:
<header className="gallery-header">
  <Link href="/" className="gallery-back-link" aria-label="back to home">
    <span aria-hidden>←</span> back
  </Link>
  <h1 className="gallery-title">
    gallery <CuteLadybug size={36} className="gallery-title-icon" loading="eager" />
  </h1>
  {/* ... existing FilterChipsBar Suspense */}
</header>
```

- [ ] **Step 2: Style the back link**

Append to `app/globals.css`:

```css
.gallery-back-link {
  display: inline-flex; align-items: center; gap: 0.3rem;
  font-family: var(--font-serif), serif;
  font-style: italic;
  color: var(--accent-pink);
  text-decoration: none;
  font-size: 0.95rem;
  opacity: 0.85;
  margin-bottom: 0.5rem;
  transition: opacity 200ms cubic-bezier(0.22, 1, 0.36, 1), transform 200ms cubic-bezier(0.22, 1, 0.36, 1);
}
.gallery-back-link:hover {
  opacity: 1;
  transform: translateX(-2px);
}
```

- [ ] **Step 3: Visual verify**

Playwright MCP:
1. `/gallery` desktop — back link visible top-left above title
2. Click → goes to `/`

- [ ] **Step 4: Commit**

```bash
git add app/gallery/page.tsx app/globals.css
git commit --no-gpg-sign -m "feat(gallery): back-to-home link in header"
```

---

## Task 11: Session action bar — source label becomes "go to source"

**Files:**
- Modify: `app/components/session/SessionActionBar.tsx`
- Modify: `app/globals.css`

The source button currently has a one-word label `source` with an empty hint slot, making it visually shorter than peers (e.g. `pause space`, `magnifier z`). Change the label to **go to source** so it wraps to two lines, matching the vertical height of the others.

- [ ] **Step 1: Update the label in SessionActionBar.tsx**

Find the source IconBtn (it's an `<a>` with label `source` and an empty hint). Change the label prop / inner text to `go to source`. Keep the hint blank — the wrap itself gives the second line.

- [ ] **Step 2: Allow the label slot to wrap to two lines**

In `app/globals.css`, find the IconBtn stacked label selector (likely `.u-icon-btn-stacked-label`) and ensure two-line wrap is allowed at the action-bar size:

```css
.session-action-bar-panel .u-icon-btn-stacked-label {
  white-space: normal;
  text-align: center;
  line-height: 1.05;
}
```

If the existing rule already permits wrap, no change needed.

- [ ] **Step 3: Verify all 8 stack columns are the same height**

Playwright MCP: navigate to session, surface chrome (mousemove keepalive), screenshot the action bar. Confirm every column (pause/timer/b.w/magnifier/fullscreen/report/source/counter) has the same vertical extent.

If "go to source" wraps awkwardly (e.g., orphans the word "to"), set the IconBtn label to render with an explicit `<br>` between "go to" and "source", or use CSS `text-wrap: balance`.

- [ ] **Step 4: Commit**

```bash
git add app/components/session/SessionActionBar.tsx app/globals.css
git commit --no-gpg-sign -m "fix(session): source label = 'go to source' — two-line wrap matches peers"
```

---

## Task 12: Favicon replacement

**Files:**
- Modify: `app/icon.svg`

Current `app/icon.svg` is a hand-drawn ladybug-ish shape that doesn't match the new aesthetic (the title uses the Fluent cherry blossom, not a custom ladybug). Replace with the cherry blossom on a dark rounded-square background so the favicon reads at a glance in browser tabs and matches the brand identity.

- [ ] **Step 1: Compose a favicon-sized cherry blossom SVG**

Replace `app/icon.svg` with a compact 32×32 SVG that embeds a simplified cherry blossom shape on the dark surface color. Inline because Next.js serves `app/icon.svg` as the favicon for the whole site — keeping it self-contained avoids a separate fetch.

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="8" fill="#0d0c10"/>
  <g transform="translate(16 16)" fill="#FF6EC7" fill-opacity="0.95">
    <ellipse cx="0" cy="-7" rx="3.4" ry="4.6"/>
    <ellipse cx="0" cy="-7" rx="3.4" ry="4.6" transform="rotate(72)"/>
    <ellipse cx="0" cy="-7" rx="3.4" ry="4.6" transform="rotate(144)"/>
    <ellipse cx="0" cy="-7" rx="3.4" ry="4.6" transform="rotate(216)"/>
    <ellipse cx="0" cy="-7" rx="3.4" ry="4.6" transform="rotate(288)"/>
  </g>
  <circle cx="16" cy="16" r="3.6" fill="#FFE066"/>
</svg>
```

(Five-petal flower rotated around center, yellow disc. Subtle, fits at 16-32px tab sizes.)

- [ ] **Step 2: Verify in browser**

Hard-reload `localhost:3000` and confirm the browser tab favicon updates. Check at multiple zoom levels.

- [ ] **Step 3: Commit**

```bash
git add app/icon.svg
git commit --no-gpg-sign -m "feat(branding): favicon — cherry blossom on dark to match new identity"
```

---

## Task 13: SocialRow — drop Instagram, add Ethereum click-to-copy

**Files:**
- Modify: `app/components/home/SocialRow.tsx`
- Modify: `app/globals.css`
- Test: `tests/components/SocialRow.test.tsx` — update list count + new ETH behavior

Per-user request: drop Instagram (user doesn't use it), add an Ethereum icon at the bottom that copies a wallet address to clipboard on click (no link navigation). The Ethereum brand mark is the official diamond/octahedron — easily recognizable, doesn't collide with the other icons' silhouettes.

- [ ] **Step 1: Update SocialRow.tsx**

Replace the `LINKS` array. Remove Instagram. Add an Ethereum entry. The Ethereum entry uses `onClick` instead of `href` because it copies an address rather than navigating.

```tsx
// At the top of the file, add:
const ETH_ADDRESS = "ad0ll.eth"; // ENS name; resolves to mainnet ETH. Update if a different address is preferred.

// In LINKS, drop the Instagram entry and add nothing here (ETH renders separately because its action differs).

// Add an EthMark icon component:
function EthMark(props: SVGProps<SVGSVGElement>) {
  // Official Ethereum diamond logo (simplified — public-domain shape, two
  // stacked triangles forming an octahedron silhouette).
  return (
    <svg viewBox="0 0 256 417" width={SIZE} height={SIZE} fill="currentColor" aria-hidden="true" {...props}>
      <path d="M127.961 0l-2.795 9.5v275.668l2.795 2.79 127.962-75.638z" opacity="0.6"/>
      <path d="M127.962 0L0 212.32l127.962 75.639V154.158z"/>
      <path d="M127.961 312.187l-1.575 1.92v98.199l1.575 4.6L256 236.587z" opacity="0.6"/>
      <path d="M127.962 416.905v-104.72L0 236.585z"/>
      <path d="M127.961 287.958l127.96-75.637-127.96-58.162z" opacity="0.2"/>
      <path d="M0 212.32l127.96 75.638V154.159z" opacity="0.45"/>
    </svg>
  );
}
```

Replace the `SocialRow` body so the existing LINKS map and the new ETH button render in the same row:

```tsx
export function SocialRow() {
  const [copied, setCopied] = useState(false);
  async function copyEth() {
    try {
      await navigator.clipboard.writeText(ETH_ADDRESS);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard unavailable (insecure context, denied permission, etc.)
      // No fallback — the user can hover to read the address from the title attribute below.
    }
  }
  return (
    <nav aria-label="social links" className="home-social">
      {LINKS.map(({ name, href, Icon }) => (
        <a key={name} href={href} target="_blank" rel="noopener noreferrer" aria-label={name} className="home-social-link">
          <Icon />
        </a>
      ))}
      <button
        type="button"
        aria-label={`copy Ethereum address ${ETH_ADDRESS}`}
        title={`copy Ethereum address ${ETH_ADDRESS}`}
        className="home-social-link home-social-eth"
        onClick={copyEth}
        data-copied={copied || undefined}
      >
        <EthMark />
        {copied && <span className="home-social-eth-toast" role="status" aria-live="polite">copied ✿</span>}
      </button>
    </nav>
  );
}
```

Drop the `Instagram` entry from `LINKS` and the `InstagramMark` component. Update the imports (`useState` from React).

- [ ] **Step 2: Update SocialRow.test.tsx**

The test currently expects 4 links and Instagram. Update:

```ts
it("renders three external links + one ethereum copy button", async () => {
  const screen = await render(<SocialRow />);
  // GitHub, BMC, Bluesky as links
  const links = screen.container().querySelectorAll("a.home-social-link");
  expect(links.length).toBe(3);
  // Ethereum as a button (not a link)
  const ethBtn = screen.container().querySelector("button.home-social-eth");
  expect(ethBtn).not.toBeNull();
});
```

Drop the explicit instagram-link assertion. Replace with a github/bmc/bluesky-only assertion.

- [ ] **Step 3: Style the ETH button + toast**

Append to `app/globals.css`:

```css
.home-social-link.home-social-eth {
  background: none;
  border: 0;
  cursor: pointer;
  position: relative;
  /* Match the existing .home-social-link reset (no underline, same 44×44 target). */
}
.home-social-eth-toast {
  position: absolute;
  top: -1.6rem;
  left: 50%;
  transform: translateX(-50%);
  padding: 0.25rem 0.55rem;
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent-pink) 90%, transparent);
  color: var(--surface-0);
  font-size: 0.75rem;
  white-space: nowrap;
  animation: copiedToastIn 200ms cubic-bezier(0.22, 1, 0.36, 1);
  pointer-events: none;
}
@keyframes copiedToastIn {
  from { transform: translate(-50%, 6px); opacity: 0; }
  to { transform: translate(-50%, 0); opacity: 1; }
}
.home-social-link.home-social-eth[data-copied] {
  color: var(--accent-pink);
}
```

- [ ] **Step 4: Visual verify**

Playwright MCP:
1. `/` desktop — social row shows three icons (GitHub, BMC, Bluesky) + Ethereum diamond, in that order.
2. Click Ethereum → toast "copied ✿" appears above; clipboard contains `ad0ll.eth`.
3. Hover the ETH icon — same pink-glow as other social icons.

- [ ] **Step 5: Commit**

```bash
git add app/components/home/SocialRow.tsx app/globals.css tests/components/SocialRow.test.tsx
git commit --no-gpg-sign -m "feat(social): drop instagram + add ethereum click-to-copy chip

ETH address copies to clipboard with a 'copied ✿' toast. Default is
'ad0ll.eth' — placeholder; update if a different address is preferred.
Instagram dropped (user-confirmed not in use)."
```

---

## Final verification

- [ ] **Step 1: tsc + unit + e2e**

```bash
npx tsc --noEmit && npx vitest run --reporter=default && npx playwright test --reporter=line
```
Expected: all green.

- [ ] **Step 2: Production build**

```bash
npm run build 2>&1 | tail -10
```
Expected: success.

- [ ] **Step 3: Visual MCP — desktop + mobile + full flow**

Take screenshots at 1440×900 AND 375×800:
- `/` home — tagline one line at desktop, wraps mobile; novelty rows are single-line; gallery CTA below start session, equal width; pool count says "you have X bugs to draw"; no body section icons
- Open WhatIsBugFilter on home, type "but" — mixed group + species results visible
- `/gallery` — back link top-left, ladybug next to title, filter row shows "what is bug?" with empty chip; hover a tile to see "view full" + source chips
- Click "view full" — opens `/api/medium/*.jpg` in browser, NO download prompt

- [ ] **Step 4: Push**

After user confirms, push.

```bash
git push origin main
```
