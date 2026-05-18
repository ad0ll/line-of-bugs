# Filter chip + DiceRoll redesign — design spec

**Date**: 2026-05-18
**Status**: approved, ready for implementation plan

## Goal

Keep the gallery filter row at a single line regardless of how many "what bug" selections the user has made; fix the broken-feeling DiceRoll (style, copy, animation, clear-then-roll behavior); and apply three copy renames.

## Motivation

Phase F shipped four regressions captured in the 2026-05-18 user feedback:

1. **Filter row breaks** — selecting 3 groups + 4 species inside the gallery's `WhatIsBugFilter` renders each as a full-width chip in the row, pushing the row to two or three lines and breaking the visual rhythm the other gallery chips maintain.
2. **DiceRoll misses** — copy (`surprise me`) is lazy, animation is invisible, behavior is additive (doesn't clear prior filters), the chip lives on both home and gallery (should be gallery-only), and the dashed pink border collides with the `+ add` affordance.
3. **Picker empty on open** — `WhatIsBugFilter` shows nothing until the user types; the other filter pickers (`AllOrChipsFilter`) show all options on open and the user expects parity.
4. **Copy refinements** — three strings need rewording for tone and tightness.

## Architecture

### A. WhatIsBugFilter — single summary chip + richer picker

The chip stays one cell wide. Selections live **inside** the picker, not in the filter row.

**Chip states**:
- Empty: `[ all bug types ▾ ]`
- Selected: `[ N bug types ▾ ]` — N is the count of selected groups + species combined.

**Picker layout** (top to bottom):

```
┌─────────────────────────────────────┐
│ ── selected (3) ──                  │
│ [group · dragonflies ×]             │
│ [species · Monarch ×]               │
│ [species · tent caterpillar ×]      │
│                                     │
│ [ type to search bugs…           ]  │
│                                     │
│ ── bug types ──                     │
│  group  butterflies      12,330     │
│  group  moths             9,872     │
│  group  beetles           7,541     │
│  …                                  │
└─────────────────────────────────────┘
```

1. **Selections zone** — renders only when selections exist; chips are removable inline via `×`. Section header `selected (N)`.
2. **Search zone** — same input; placeholder refined to `type to search bugs…`; 120ms debounce kept.
3. **Candidates zone** — default (no query): all groups sorted by count, fetched on picker open. With query: FTS5 mixed groups+species results (current behavior).

**Mobile (≤640px)**: bottom-sheet stays; the selections zone fits inside the sheet, above the search and candidate list. Same 70vh height budget.

**Backend change**: `/api/search/insect` returns the all-groups list (by count desc) when `q` is empty. Currently returns `[]`. Frontend `WhatIsBugFilter` drops its early-return on empty query so the fetch effect always runs when the picker is open.

**Why this works**: row stays single-line; picker becomes the canonical home for inspecting/editing selections; mirrors `AllOrChipsFilter`'s "open and see everything" rhythm.

### B. DiceRoll — gallery-only, dice-iconed, clears-then-rolls

**Removal**: drop the chip from `HomeClient.tsx` line 178 (trailing slot of the "what bug" row). Remove the `home-filter-row-trailing` CSS class — no other row uses it. Gallery's `FilterChipsControls.tsx` keeps the chip at the end of the row.

**Icon**: Phosphor `dice-five-duotone.svg`, served from `/icons/phosphor/dice-five-duotone.svg`. Tinted to `var(--accent-pink)` via the same CSS `filter:` chain the gallery butterfly already uses, so the icon system stays consistent.

**Copy**: `roll` (replaces `surprise me`).

**Chip style**:
- Border: solid `var(--accent-pink-border)` (was dashed). Removes visual collision with `+ add`.
- Background: `color-mix(in srgb, var(--accent-pink) 12%, transparent)` — matches empty `AllOrChipsFilter` chip.
- Italic-serif copy stays.
- Hover: `-1px` lift + pink box-shadow halo, easing unchanged.

**Behavior on click**:
1. `setRolling(true)` at t=0 — animation starts immediately.
2. Compute random state (current probabilities preserved):
   - groups: 60% → 1–3 picks from `GROUPS_POOL`
   - views: 50% → 1 of `["dorsal", "lateral", "ventral", "head"]`
   - life: 30% → 1 of `["adult", "larva", "nymph"]`
   - subjects: 20% → 1 of `["wild", "specimen", "captive"]`
3. Clear **all 7** filter axes: groups, species, views, life, sexes, subjects, institutions. Each setter called with `[]` before the random subset applies. Fresh slate on every roll.
4. Apply random subset **immediately** — no `setTimeout` gate around the swap. URL updates at t=0; facets and grid start loading right away.
5. `setTimeout(600ms, () => setRolling(false))` only governs the animation, not the swap.

**`applyDiceRoll` signature change**: now takes the full setter map (including `setSpecies`, `setSexes`, `setInsts`); clears each before applying the rolled subset. The Phase F semantics ("absence of a key means leave alone") is dropped — every roll starts clean.

**Animation — tumble + sparkle burst** (~600ms total):

- **Dice wobble** (t=0–400ms): the dice `<img>` rotates `0° → +15° → -15° → +15° → -15° → 0°` with `cubic-bezier(0.22, 1, 0.36, 1)`.
- **Sparkle burst** (t=200–600ms): 5 `<span>` children of the button, absolutely positioned and rotated to `0°, 72°, 144°, 216°, 288°` around the chip center. Each animates `transform: scale(0) → scale(1.2) → scale(0)` and `translate(0) → translate(0, -40px)` outward (along its rotation axis) with `opacity 0 → 1 → 0`. Duration 400ms each, stagger 0/40/80/120/160ms. Sparkle shape: 4-point pink star, ~10×10px (re-use the SVG path from the current `dice-roll-sparkle`).

**Reduced motion**: `@media (prefers-reduced-motion: reduce)` disables both the wobble and the burst; the filter swap still fires at t=0.

## C. Copy renames

| File | Line | Before | After |
|---|---|---|---|
| `app/components/home/HomeClient.tsx` | 177 | `label="what is bug?"` | `label="what bug"` |
| `app/components/home/HomeClient.tsx` | 232 | `no insects match — try broadening the filters` | `no bugs found with those filters` |
| `app/gallery/_components/GalleryGrid.tsx` | 29 | `no insects match — try broadening the filters` | `no bugs found with those filters` |
| `app/gallery/_components/InfiniteScroller.tsx` | 113 | `✿ that's every bug` | `✿ no more bugs` |

## Testing

### Unit (Vitest browser, co-located)

- `app/components/filters/WhatIsBugFilter.test.tsx`:
  - Picker opens with the all-groups list pre-populated (no typing required).
  - Clicking a candidate adds it to the selections zone and removes it from candidates.
  - `×` in the selections zone removes the corresponding chip; count updates.
  - Chip text reflects combined groups + species count.
  - Mobile (`window.matchMedia("(max-width: 640px)").matches`): body scroll locks when the sheet opens.

- `app/components/filters/DiceRoll.test.tsx`:
  - Click invokes the parent setters such that every axis is reset to `[]` first, then the random subset is applied.
  - `is-rolling` class added at t=0 and removed after 600ms.
  - Under `prefers-reduced-motion: reduce`, the filter swap still fires synchronously; visual animation is suppressed.

### E2E (Playwright, `tests/e2e/`)

- `gallery-filter-chips.spec.ts`: select 3 groups + 4 species via the picker; assert filter row bounding height stays ≤80px (single-line). Open picker; assert selections zone lists all 7. Click one `×`; chip reads `6 bug types`.
- `gallery-dice.spec.ts`: pre-set `inst`, `q`, `view`, `sex` via URL params; click `roll`; assert those params disappear; assert at least one new param appears for the rolled subset; assert the grid first tile renders.
- `home-no-dice.spec.ts`: assert `page.locator('.dice-roll').count() === 0` on `/`. Regression guard for the removal.
- Update existing specs that reference the old copy strings (`that's every bug`, `no insects match — try broadening the filters`, `what is bug?`).

## Out of scope

- Picker selected-chip visual experiments beyond what's needed to fit inside the picker.
- FTS5 ranking changes.
- Adding species to the default-open candidate list (groups-only per locked Q2).
- DiceRoll probability tuning (60/50/30/20 stays).
- Any DiceRoll usage outside the gallery.

## Open follow-ups

- Run `/audit` against home + gallery after implementation (user has explicitly deferred audit feedback to that pass).
- If `/api/search/insect` requires more than a small handler tweak to return all groups on empty `q`, the implementation plan will include the backend change as its own task.
