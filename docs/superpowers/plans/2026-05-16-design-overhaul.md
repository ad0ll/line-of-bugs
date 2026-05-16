# Design overhaul — plan

> **Status:** draft for user review. **Don't implement until approved.**

## Audit findings (verified)

The audit confirmed every complaint with file:line citations. Two findings change how I'd prioritize fixes:

1. **The lag is measurable: ~3800 ms per chip click in dev × 2 (React StrictMode double-fires the `useEffect` in `HomeClient.tsx:99-118`).** In prod the SQL is ~10 ms but the duplicate-fetch pattern remains, and per-query-string cache keys mean every new filter combination is uncached. This isn't a UX polish item — it's making the app feel broken.

2. **Home and gallery diverged architecturally.** Home is a client component that fetches `/api/facets` from the browser; gallery is an RSC that runs facets server-side. Same `FilterPopover` + `TaxonGroupChips` components, but state ownership is split (URL vs `useState` vs SSR). That's why `defaultOpen` exists on gallery and not home, why their filter bars look different, and why I keep finding small inconsistencies between them. **No design fix sticks unless we unify these first.**

## Design direction

Keep the Pastel Goth Kawaii palette, the display-serif title, the chip language. Change three things:

1. **Promote layperson taxonomy to first-class.** Always-visible chip wall on both home and gallery — no collapse. The audience is art students, not entomologists; the primary control should be the one they can read.
2. **Demote species search to "for experts."** Move the multi-tag autocomplete behind a small toggle so it's discoverable but not in the way. A toggle (☐ chips / ☐ species) above the same chip area keeps the spatial footprint constant.
3. **Center the home form, drop the 2-col grid.** The "ridiculous layout" is `.home-main { grid-template-columns: 1fr 1fr }` putting everything in column 2 with column 1 empty (the title sticks there). Center column, full form below, gallery CTA next to start session.

The session player stays as-is conceptually but tightens up: image fills the available space, action bar drops zoom (browser handles it) and aligns Source like every other button, magnifier becomes square with a discoverable expand affordance.

---

## Order of work

Five batches. Each is independently shippable, with the lag fix first because it unblocks user testing of the design work.

### Batch 1 — Stop the lag (highest user-perceived win)

| # | Change | File:line | Notes |
|---|---|---|---|
| 1.1 | Guard the facets effect against StrictMode double-fire | `HomeClient.tsx:99` | Use a ref-keyed dedupe on the params signature. Cuts dev round-trips in half. |
| 1.2 | Optimistic UI: chip click updates URL + visual state immediately; facet count refresh is background | `HomeClient.tsx`, `FilterChipsControls.tsx` | Don't block the chip-press feedback on the SQL roundtrip. Show a subtle "…" or pulse on the counts that update when the new snapshot lands. |
| 1.3 | Eliminate the duplicate `/api/facets` call on home (one from useEffect, one from `router.replace` triggering server re-render that the page doesn't actually use) | `HomeClient.tsx:79-93,99-118` | Pick one source of truth. Recommend: keep the client `/api/facets` fetch, change `router.replace` to NOT trigger a Suspense boundary refetch (it currently does). |
| 1.4 | Add a request debounce on rapid chip toggling | `HomeClient.tsx:99` | 80ms is enough — saves multi-toggle floods. |
| 1.5 | (Optional, lower priority) — pre-warm the most-viewed facet snapshot at build time and serve from cache | `lib/queries/facets.ts` | Only if we ship "always-visible chips" and the unfiltered/captive/specimen/wild snapshots are 90 % of hits. |

**Validation:** chip click → visible state change in < 50 ms regardless of network. Facets refetch lands within 200 ms of the click on warm prod cache.

### Batch 2 — Unify the filter architecture (home + gallery)

Single source of truth for filter state, single component owning the filter UI, used on both pages.

| # | Change | Files |
|---|---|---|
| 2.1 | Extract `FilterBar` as the canonical component | new `app/components/filters/FilterBar.tsx` |
| 2.2 | Home + gallery import `FilterBar` and provide their own initial state | `HomeClient.tsx`, `gallery/_components/FilterChipsBar.tsx`, `gallery/_components/FilterChipsControls.tsx` |
| 2.3 | Use URL params as the sole state source on both pages — kill the `useState` mirrors on home | `HomeClient.tsx:70-76` |
| 2.4 | The "more filters" axes (institution, view, life-stage, sex) become a single trailing dropdown trigger ("more filters ▾") that opens a popover containing all four — not a collapsible section | new `FilterMorePopover.tsx` |
| 2.5 | Remove `<CollapsibleSection>` from both pages' filter areas | `HomeClient.tsx:163-173,175-209`, `FilterChipsControls.tsx:110-128` |

**Validation:** the filter UI in `/` and `/gallery` is pixel-identical. Same React component tree, just different containing layouts.

### Batch 3 — Home page layout

| # | Change | File |
|---|---|---|
| 3.1 | Drop the 2-col grid; center the form below the title in a single column | `globals.css:1037-1058 .home-main` |
| 3.2 | "all" chip first in `SubjectFilter` (current: wild\|captive\|specimen\|all → new: all\|wild\|captive\|specimen) | `SubjectFilter.tsx:5-10` |
| 3.3 | Add tooltip ⓘ to "what kind of bug?" section title (the only section without one) | `HomeClient.tsx:164` |
| 3.4 | Layperson↔species toggle above the chip area; toggling to "species" replaces the chip wall with the multi-tag autocomplete (port of `SpeciesAutocomplete`) | new `FilterModeToggle.tsx` + reuse `SpeciesAutocomplete` |
| 3.5 | Promote "browse the gallery →" to a secondary CTA visually paired with "start session" | `HomeClient.tsx:236-238`, `globals.css .home-gallery-link` |
| 3.6 | Kill the `home-bloom` gradient/blur pseudo-elements (audit flagged glassmorphism anti-pattern) | `globals.css .home-bloom` |

**Validation:** at 1280×800, no horizontal scroll, no "wasted half." The chip wall and species toggle are visible without expanding anything. "browse the gallery" is reachable in one glance.

### Batch 4 — Session player polish

| # | Change | File |
|---|---|---|
| 4.1 | Image fill: `object-fit: contain` stays (preserves aspect), but bump the container to use available viewport space — currently capped by parent padding | `SessionImage.tsx:41`, `globals.css .session-player-image-wrap` |
| 4.2 | Remove zoom cluster from action bar (browser zoom handles it) — drops 3 controls + the value display, frees space for labels | `SessionActionBar.tsx:52-80` |
| 4.3 | Source button: switch from `<a href>` link rendering to the `IconBtn as="a"` pattern; remove underline; add a label like the others ("source") and a placeholder hint slot so alignment matches | `SessionActionBar.tsx:88-92`, `IconBtn.tsx:43-57` |
| 4.4 | Source href: point to image URL (the actual JPEG) not source page URL | `SessionActionBar.tsx` source prop wiring; backend already has both |
| 4.5 | Magnifier: square (border-radius from 50% → small radius matching pill style); add a one-line hint that fades in on first hover ("Esc / left-click: close · right-click: expand") | `globals.css:1539`, `Magnifier.tsx` |
| 4.6 | Magnifier expand on right-click: implement `onContextMenu` to grow the magnifier 2×; preserve existing close-on-click/Esc | `Magnifier.tsx` |
| 4.7 | Add labels to action-bar items that currently lack them — counter ("of"), and ensure stacked-label is on every IconBtn | `SessionActionBar.tsx:73-79` (zoom buttons disappear in 4.2 anyway) |

**Validation:** at 1280×720 the image fills the viewport minus the action-bar safe area. Action-bar buttons all the same height with visible labels. Magnifier feels like the in-app affordance it is, with discoverability for power-user features.

### Batch 5 — Content polish

| # | Change | File |
|---|---|---|
| 5.1 | Rename "where's the bug?" → "where bug?" | `lib/report-categories.ts:17` |
| 5.2 | Add report categories: `blurry`, `bug-too-small`, `hard-to-see` | `db/schema.ts reportCategories`, `lib/report-categories.ts`, drizzle migration |
| 5.3 | AI Generated easter egg: hover triggers a Balatro-style fire animation on the chip (flame trail + ember sparks). CSS-only. | `ReportCategoryChips.tsx`, `globals.css` |
| 5.4 | Capitalize displayed proper nouns: render `common_name` and `taxon_species` in title case where they're shown (gallery tiles, session source-info chip) — keep UI chrome lowercase | `GridTile.tsx:35-36`, `SourceInfoChip.tsx` + a small `toTitleCase` util |
| 5.5 | Gallery tile: drop the "species in a chip" pattern; render `common_name` as a strong label and `taxon_species` as italic secondary text under it (typographic hierarchy) | `GridTile.tsx`, `globals.css .grid-item-meta` |

**Validation:** report modal lists 9 categories with the rename + 3 new entries. Hovering "ai-generated" fires the flame animation. Species names display "Danaus Plexippus" not "danaus plexippus" but UI labels stay lowercase ("subject type", "report this image").

---

## What I'm NOT proposing

- **Keep the Pastel Goth Kawaii palette + Fraunces display font.** They're working — no aesthetic overhaul needed.
- **Keep the chip / collapsible / popover primitives.** The audit flagged them as well-built; the issue is *where* they're placed, not *how* they look.
- **Keep `'use cache'` on `getUnfilteredFacets`.** It already serves the SSR initial-render fast path.
- **Don't rebuild the report flow.** It works. Just add categories + rename.

## Decisions (locked 2026-05-16)

1. **Toggle** (chips ↔ species) above one shared chip area. Must look good — same visual weight as the chips it sits above, clean discrete switch.
2. **`object-fit: cover`** on session image. User override of my `contain` recommendation: drawing canvas area trumps full-image visibility; users skip to next image if a `cover` crop is bad.
3. **Skip the AI-generated easter egg** for now. Don't implement.
4. **New report categories ADD; don't replace.** `low-resolution` stays. New: `blurry`, `bug-too-small`, `hard-to-see`.
5. **Title-case common names only.** Scientific names render as stored (Linnaean convention: "Danaus plexippus" stays lowercase species epithet). UI chrome ("subject type", "start session") stays lowercase by design.

## Files of note (for your review)

- `app/components/home/HomeClient.tsx` — main home wiring
- `app/gallery/_components/FilterChipsControls.tsx` — gallery filter wiring (parallel-evolved sibling)
- `app/components/filters/FilterPopover.tsx` — shared popover primitive (fine, keep)
- `app/components/session/SessionActionBar.tsx` — action bar
- `app/components/session/Magnifier.tsx` — magnifier (needs square + expand + hint)
- `app/components/session/SessionImage.tsx` — image render (needs container resize)
- `lib/queries/facets.ts` — facet snapshot (lag origin)
- `lib/report-categories.ts` — categories
- `db/schema.ts` — needs new enum values + migration
- `app/globals.css` — `home-main` grid, `home-bloom`, `home-gallery-link`, `magnifier-glass` border-radius
