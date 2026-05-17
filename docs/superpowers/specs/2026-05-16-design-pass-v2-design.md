# Design Pass v2 — line of bugs

**Date**: 2026-05-16
**Status**: spec, pending implementation plan
**Supersedes**: parts of `docs/ui-spec.md` for home/gallery/session player

## Goal

Tighten the home, gallery, and session player around three principles:

1. **One mental model** for filtering — converge today's three patterns (chips, popovers, autocomplete) into one "all-or-chips" control.
2. **Truthful counts** — the displayed pool size equals the deliverable session size, every time, regardless of repeat-mode.
3. **Never wait** — image loading and count queries are fast enough that the user does not see a loading screen during normal use.

Aesthetic direction is girly-cute (per direct user direction): soft pastels, hand-drawn icons, subtle micro-interactions, no card surfaces on the home setup area (NN/g and 2026 control-panel research are explicit that cards hurt findability on config pages).

Audience: gesture-drawing artists, mostly from Dynamic Sketching class, who have used Line of Action before and arrive expecting a gesture-drawing app.

## Information architecture (home)

Top-to-bottom, single column, centered, max-width ~640px:

1. **Hero** — centered. Title `line of bugs ✿` (existing flower SVG kept). Tagline becomes dynamic and properly centered: *"gesture drawing practice with **{unfiltered total}** insects, tenderly photographed"*.
2. **Setup area** — three implicitly grouped sections, no card surfaces, each with a hand-drawn icon prefix and baseline-aligned tooltip ⓘ:
   - **Interval** (clock icon) — pill chips: 30s · 60s · 2m · 3m · 5m · 10m · custom
   - **Filters** (butterfly icon) — six `AllOrChipsFilter` rows: photo type · bug type · view · life stage · sex · species. The "filters" header has no tooltip (nothing meaningful to explain).
   - **Novelty** (renamed from "repeat behavior"; refresh icon) — three stacked radio cards: show everything · never repeat species · same species, different angles
3. **Pool count** — one line, directly above CTAs, large readable text: *"6,466 bugs in your session pool"*. Single message regardless of novelty mode (the number itself reflects mode).
4. **CTAs** — `start session` (solid pink) + `browse the gallery → 🦋` (outlined with cute icon), side-by-side, **same shape, same size, same padding, same font weight**. They are a pair.
5. **Social row** — under CTAs, smaller and quieter. GitHub · Buy Me a Coffee · Instagram · Bluesky, each as a monochrome icon button linking to the official brand asset's recommended target (user's own handles, set as constants). Icon-only, no labels, ample tap targets (≥44×44).

The whole setup area sits on a very subtle ambient pastel gradient (pink → lavender, ~5% opacity) — gives warmth without boxing.

## Visual language

**Color**
- Keep current dark surface + accent-pink + accent-lilac (working identity)
- Add ambient gradient layer behind the setup area (~5% opacity, low-vertical pink-to-lavender)
- Soft pink glow as the universal hover/active accent

**Typography**
- Keep serif-italic display for `line of bugs`, gallery title, and section headers
- Existing reading font for body
- Tabular figures on all counts so they don't jitter when animating

**Icon style**
- Hand-drawn / illustrated, color-tolerant. Phosphor/Lucide/Tabler are too clean for this brand.
- Direction: pull from Streamline "Cute Color" or similar hand-illustrated sets, or commission a tiny in-house set in the same family as the existing flower SVG. Implementation phase: prototype 3 candidates per slot, pick the cutest fitting pair.
- Icons needed:
  - Flower (have it — home title)
  - Butterfly (gallery title, gallery secondary CTA)
  - Clock or clock-with-flower (interval section)
  - Cute bug (filters section)
  - Spinny-arrows or refresh (novelty section)
  - Sad-bug doodle (empty states)
- Social icons: official brand monochrome SVGs (GitHub Mark, Buy Me a Coffee logomark, Instagram glyph, Bluesky butterfly), no modifications

**Motion**
- Easing: ease-out-quint (`cubic-bezier(0.22, 1, 0.36, 1)`) everywhere; never bounce or elastic
- Durations: 200ms (hover/focus), 250ms (state changes, count animation), 300ms (chip add/remove, picker open)
- `prefers-reduced-motion: reduce` → all animation/transition durations clamped to ≤10ms

## Filter component: `<AllOrChipsFilter>`

One reusable component, configured per-axis. Replaces `FilterBar`, `FilterPopover`, `TaxonGroupChips`, `SubjectFilter`, the home/gallery axis adapters, and the old "more filters" popover entirely.

### Props (sketch)

```ts
interface AllOrChipsFilterProps {
  label: string;                                 // "bug type"
  emptyLabel: string;                            // "all bug types"
  options: { value: string; label: string; count: number }[];
  selected: string[];
  onChange: (next: string[]) => void;
  multi?: boolean;                               // default true
  searchable?: boolean;                          // default true
  variant?: "chips" | "autocomplete";            // species uses "autocomplete"
}
```

### States

1. **Empty** — single chip: `all {label} · {totalCount} ⌄`. Soft pulse when the entire page has no filters set, decaying after first interaction (don't loop forever).
2. **Selected** — chip wall of selections, each with `× ` to remove. Trailing `+` chip re-opens the picker.
3. **Picker open** — dropdown panel below the chip row:
   - Search input at top (auto-focus; `Esc` closes)
   - Full options list sorted by count descending, each item shows count
   - Selected items appear as disabled "added" rows (greyed, not clickable)
   - Click outside or `Esc` closes; `Enter` selects the highlighted item

### Per-axis configuration

| Axis | empty chip | multi | variant |
|---|---|---|---|
| photo type | `all photo types · N` | yes | chips |
| bug type | `all bug types · N` | yes | chips |
| view | `all views · N` | yes | chips |
| life stage | `all life stages · N` | yes | chips |
| sex | `all sexes · N` | yes | chips |
| institution (gallery only) | `all institutions · N` | yes | chips |
| species | `search species…` (no "all") | yes | autocomplete (existing booru pattern) |

### Counts inside chips

- Chip counts reflect cross-axis intersection with own-axis excluded (same own-axis-exclusion semantics we already implement)
- Counts update visibly fast (<100ms) when filters change; numbers animate via tabular-figure morph
- Implementation: counts come from the existing `/api/facets` endpoint, which 0010 made fast

### Accessibility

- Chip = `<button role="combobox" aria-expanded aria-haspopup="listbox" aria-controls="picker-{id}">`
- Picker = `<ul role="listbox" id="picker-{id}">`; items = `<li role="option" aria-selected>`
- Arrow keys navigate; `Enter` selects; `Esc` closes
- "All X" chip is keyboard-focusable; pulses are CSS-only (decorative, no aria-live)
- Selection state and counts announced via `aria-live="polite"` region

## Counts & pool semantics

**Today's bug**: facets endpoint returns the raw filter total. UI shows it. Session start later applies `repeatMode` dedup + a 500-row cap, so the user sees 6,466 but gets 270.

**Fix**: novelty is a filter input to facets, like view or life-stage.

### API

`/api/facets` accepts `novelty=show-everything|never-repeat-species|allow-different-angles`. The returned `total` reflects the deliverable count per mode:

- `show-everything` → `COUNT(*) WHERE filters` (today's behavior)
- `never-repeat-species` → `COUNT(DISTINCT COALESCE(taxon_species, common_name, image_id)) WHERE filters`
- `allow-different-angles` → `COUNT(DISTINCT COALESCE(collection_id, image_id)) WHERE filters`

The `COALESCE` chain mirrors `applyRepeatMode`'s dedup-key precedence exactly (`taxonSpecies || commonName || imageId` for species; `collection_id` falling back to per-row "always keep" for angles). Without this, NULL-species and NULL-collection rows would be silently undercounted vs the actual session pool, reintroducing the count-vs-deliverable mismatch this fix exists to eliminate.

Per-axis chip-internal counts remain mode-independent — they count *photos available to filter by*, which is the right number for "what can I add". Only the headline pool total reflects novelty.

### Session pool cap

**Removed.** `buildSessionPool` returns the full filtered, shuffled, novelty-reduced pool. A 6,466-item array of slim `Image` rows (`raw_metadata` projected out) is ~3 MB — trivial. The `session-pools.ts` in-memory map already handles arbitrarily-sized pools.

### Display copy

- Normal: *"6,466 bugs in your session pool"* (always the same template)
- Empty: *"no insects match — try broadening the filters"* (with sad-bug doodle, CTA disabled)

### Perf

- `COUNT(DISTINCT …)` queries are ~30ms on the local DB with existing indexes. If prod regresses we add a covering index — same playbook as migration 0010.

## Session player polish

### Action bar

- All buttons (pause / timer / b.w / magnifier / fullscreen / report / source) → **identical width**: `min-width` set from the widest label (currently "fullscreen")
- Same stacked layout for every button: glyph (top) · label (middle) · key-hint (bottom)
- **Source button**: styled identically. Semantically an `<a>` (right-click open-in-new-tab works), visually a stacked button. Glyph: `↗`. Label: `source`. Hint slot: blank (no keyboard shortcut). No underline. No link-blue.
- **Counter** ("2 of 270"): aligned to the same vertical rhythm. Fixed-width slot to the right of source. `<span class="counter-current">2</span> <span class="counter-sep">of</span> <span class="counter-total">270</span>`.

### Magnifier

- Cover-aware sampling math is already in place (commit `d4797db`)
- Square loupe with `r-3xl` corners (existing)
- Right-click expands; esc / left-click closes; hint pill on first activation (existing)
- No changes in this pass

### Title block (top-left)

- Common name title-cased (existing)
- Scientific italic (existing)
- **Order-only-ID fix**: when `common_name.toLowerCase() === taxon_order.toLowerCase()` (e.g., iNat "butterflies, moths or skippers" / "Lepidoptera"), show common name with a tiny `(order)` annotation, hide the duplicated scientific. Same logic in gallery tiles.

### Image loading strategy (the "never wait" principle)

- **Display tier**: medium (1024px JPEG q88), not full-res — the eye can't tell at session-viewport sizes, saves ~5× bandwidth
- **Full-res** only loads when the magnifier activates (already correct in `Magnifier.tsx` via `/api/img/`)
- **Preload window**: next 3 + previous 1 via the existing `createPreloadManager`. Verify the manager actually issues `<link rel="preload">` (or equivalent) for these — not just queues them mentally.
- **Cache headers**: confirm `/api/medium/[name]` returns `Cache-Control: public, max-age=31536000, immutable` + ETag (already done for `/api/img`, mirror it)
- **Decode strategy**: `next/image` with `priority` on current slide, `loading="eager"` on the +1/+2/+3, default lazy on the rest
- **Result**: navigating prev/next is instant; magnifier feels snappy; never a loading screen between slides

This is the `/optimize` workstream's primary target. Verification via Performance panel + DevTools network throttling at "Fast 3G".

## Gallery

### Header

- Title `gallery` (serif italic, existing), with a cute butterfly icon prefix matching `line of bugs ✿`
- Dynamic count below: *"8,937 bugs matching your filters"* (or *"all 39,605 bugs"* when unfiltered)

### Filter bar

- Same `<AllOrChipsFilter>` component as home, **laid out horizontally** as a single wrapping row at the top of the page
- Axes order: photo type · bug type · view · life stage · sex · species · institution
- Institution axis only appears on gallery (home doesn't filter by institution — that was correct)
- Same picker behavior; same chip-internal counts; same animations

### Tile grid

- Existing grid layout unchanged (square thumbnails, multi-angle "1/7" badge)
- **Name block fix**: apply order-only-ID handling. Drop the duplicate scientific when it equals `taxon_order`.
- **Drop the tile taxon-group chip** (e.g., the `lepidoptera` chip below each tile). It duplicates info already in the scientific name + URL filter state, and adds noise. Recovered space → breathing room.
- Tile hover: soft pink glow + `scale(1.02)`, ease-out-quint 200ms (matches home delight motif)

### Infinite scroll

- Keep (working pattern, existing implementation)
- **Loading improvement**: replace any generic spinner with a skeleton-tile row that has the same dimensions as a real tile. Skeleton has a subtle shimmer (linear-gradient slide). Once a tile is ready it fades in (200ms). No layout shift.
- Preload the next page when scroll reaches 70% (existing); page size unchanged
- If the user scrolls past a 0-result section (rare; should not happen with own-axis-exclusion correct counts), show the same sad-bug empty state with a button to widen filters

### Empty state

- Same sad-bug doodle as home; copy: *"no insects match — try broadening the filters"*; `[ clear all ]` button

## Delight layer (consolidated)

These are the moments worth committing to across the design:

**Micro-interactions**
- Chip add: slides in from picker direction (300ms, ease-out-quint), soft pink glow flashes
- Chip remove: fades out + collapses inline space (200ms)
- Count animation: tabular-figure morph (250ms) when filters change
- "All X" chip soft pulse when no filters are set; decays after first user interaction (doesn't loop forever)
- Picker open: 200ms slide-down with fade, focuses search input
- Button hover (CTAs): `translateY(-1px)` + slightly stronger pink glow

**Personality copy**
- Empty filter result: *"no insects match — try broadening the filters"* (with sad-bug doodle)
- Pool count empty: same line; CTAs disabled with tooltip *"add filters until at least one insect matches"*
- 404 / not found (out-of-scope but worth noting): *"this bug crawled away"*

**Discovery / quiet personality**
- Console message for devs: `"%c🐞 line of bugs %cthanks for poking around. PRs welcome → github.com/ad0ll/line-of-bugs"` with style args
- Sad-bug doodle on 0-result states (don't overuse; doesn't appear elsewhere)
- Title flower has a 2px nudge on hover — tiny, only noticeable if you're paying attention

**Sound** — **none in this pass.** The session player already has audio cues (countdown dings); decorative sound on the home/gallery would compete and is the wrong move for a drawing app where users may have their own music going.

**Easter eggs** — none. (User explicitly skipped the Balatro idea earlier. Holding that line.)

## Performance / loading strategy (`/optimize` consolidation)

This pass addresses the perf issues raised:

1. **DB query perf**
   - Migration `0010_facet_perf.sql` already shipped (composite index + ANALYZE). 84× speedup on type-pick.
   - Add per-mode count queries (`DISTINCT taxon_species`, `DISTINCT collection_id`) with covering indexes if local benchmark exceeds 100ms.
   - `PRAGMA optimize` on connection open (so future stats-changes don't require a server restart to take effect).

2. **API response**
   - `/api/facets` target: <100ms p95 across all filter combinations
   - `/api/session/start` target: <500ms p95 (one big query + in-memory shuffle)
   - `/api/gallery/page/[n]` target: <200ms p95
   - Verification: log query timings via `console.time` in dev; production telemetry if we add it later (out of scope here)

3. **Client perf**
   - Facet refetch on filter change: debounce 80ms (existing), dedupe by query-key (existing), abort in-flight on supersede (existing). All correct already.
   - Count number animations are CSS-only (no JS frame loop)
   - Hover/active effects use `transform` and `opacity` only (GPU-accelerated)

4. **Image loading**
   - Session: medium tier + preload window (see Session player section)
   - Gallery: existing thumbnails (512px) — already correct; no change
   - Magnifier: lazy full-res (already correct)
   - Cache headers: 1-year immutable for all tiers (already correct for /img and /thumb; verify /medium)

5. **Bundle**
   - Audit unused imports as part of implementation
   - The icon set is the main risk — pick a tree-shakeable source (e.g., per-icon SVG imports, not a whole-set bundle)
   - Lazy-load the picker dropdown component (it's not needed on initial render)

## Components changed / removed

**New**
- `<AllOrChipsFilter>` — the universal filter control

**Modified**
- `HomeClient` — IA + uses `<AllOrChipsFilter>` for every axis + new pool-count behavior
- `SessionActionBar` — equal-width buttons, source-button restyle, counter slot
- `SessionTitle` — order-only-ID display logic
- `GridTile` — drop taxon-group chip, order-only-ID display, hover state
- `FilterChipsBar` / `FilterChipsControls` (gallery) — replaced by `<AllOrChipsFilter>` row
- `/api/facets` — accepts novelty parameter, returns mode-aware total
- `/api/session/start` — no longer caps at 500
- `buildSessionPool` — drops the LIMIT clause; returns the full novelty-reduced pool

**Removed**
- `FilterBar` (replaced by `<AllOrChipsFilter>` rows)
- `FilterPopover` (replaced by the picker dropdown built into `<AllOrChipsFilter>`)
- `TaxonGroupChips` (replaced)
- `SubjectFilter` (replaced)
- The "more filters" popover trigger and all its plumbing
- The tile taxon-group chip rendering

## Data model changes

- None. All decisions can be implemented over the existing schema.
- One new migration: `0011_facet_perf_distinct_indexes.sql` *if* the per-mode count queries benchmark above 100ms (decided during implementation, not preemptive).

## Error handling

- Facet API error → keep last-known counts on UI, show toast "couldn't refresh counts — using last values"
- Session start error → existing error toast already covers it
- Empty filter result → handled in the spec (sad-bug + disabled CTA)
- Picker fetch error (autocomplete species) → inline "couldn't load suggestions, retry?" in the dropdown

## Testing

- **Unit (vitest)** — `<AllOrChipsFilter>` interactions (open/close, select/deselect, search-filter), per-mode count math, order-only-ID detection
- **E2E (playwright)** — home filter flow end-to-end; gallery filter flow; session pool count = actual session count for each novelty mode; tile name handles order-only IDs
- **Visual (MCP)** — screenshot each redesigned page at desktop + mobile widths before sign-off, compare against the spec

## Out of scope

- Mobile-specific layout overhaul (current mobile is OK; revisit separately)
- Notifications / streak system / achievement layer (delight ideas exist but not for this pass)
- Sound on home/gallery (intentionally not added)
- Easter eggs beyond the console message (user said no)
- Schema changes
- Detect-subjects ML pipeline (different workstream)

## Execution phasing

The spec touches home + session player + gallery. The implementation plan should phase to make review tractable:

- **Phase A — `<AllOrChipsFilter>` + home rewrite**: lands the new filter component, novelty-aware counts, cap removal, IA, visual language, CTAs, social row. Self-contained PR.
- **Phase B — session player polish**: action bar uniformity, source restyle, image loading audit, order-only-ID title fix. Independent of Phase A.
- **Phase C — gallery rewrite**: port the filter component to gallery, drop tile chip, order-only-ID, skeleton loading, cute icon. Depends on Phase A landing.

Each phase ships as its own PR, reviewed and deployed independently.

## Open questions

None blocking. Two implementation-time decisions:
1. Exact icon set / individual icon choices (will prototype 3 per slot and pick)
2. Whether to ship the per-mode-count index migration preemptively or only if benchmarks warrant it
