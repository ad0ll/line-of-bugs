# Design Pass v2 — Phase F: Gallery polish + session safety + delight

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Address 10 feedback items: gallery filter flow + meta chips + broken-thumb fallback + dice-roll random filter; session source-chip parity with gallery + remove pause overlay + ramp-up skip on key hold + start-session stuck-state safety + memory check.

**Architecture:** Mostly tile + gallery polish (new `<TileMetaChips>` + `<DiceRollButton>` + `<BugNotFoundPlaceholder>`); session player gets a hold-to-ramp keyboard handler + the centered-pause overlay removed; `<SourceInfoChip>` rewritten to mirror `<TileMetaChips>`. Memory management is investigation-only — no code changes unless the audit surfaces a leak.

**Tech Stack:** Next.js 16, React 19, TypeScript. `useEffect` keyboard handler for ramp-up. CSS animation for dice/wilted-flower. Existing preload manager in `lib/preload-manager.ts` — verify it actually evicts.

---

## Task 1: Broken-thumb fallback — `<BugNotFoundPlaceholder>`

**Files:**
- Create: `app/components/gallery/BugNotFoundThumb.tsx`
- Modify: `app/gallery/_components/GridTile.tsx` — wrap `<Image>` with `onError` swap
- Modify: `app/globals.css`

The DB references 9 thumbnail files that don't exist on disk (data desync from incremental fetcher runs). Rather than purge those rows, render a delightful "this bug wandered off" placeholder so the gallery degrades gracefully.

- [ ] **Step 1: BugNotFoundThumb component**

```tsx
// app/components/gallery/BugNotFoundThumb.tsx
import { WiltedFlower } from "@/app/components/icons";

export function BugNotFoundThumb() {
  return (
    <div className="bug-not-found-thumb" aria-label="bug wandered off">
      <WiltedFlower size={48} />
      <span>this bug wandered off</span>
    </div>
  );
}
```

CSS append:
```css
.bug-not-found-thumb {
  position: absolute; inset: 0;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 0.5rem;
  background: linear-gradient(135deg, color-mix(in srgb, var(--accent-pink) 8%, var(--surface-1)), color-mix(in srgb, var(--accent-lilac) 8%, var(--surface-1)));
  color: var(--text-tertiary);
  font-family: var(--font-display), serif;
  font-style: italic;
  font-size: 0.85rem;
  text-align: center;
  padding: 0.5rem;
}
```

- [ ] **Step 2: GridTile error handling**

Add `useState` for `thumbBroken` to GridTile (or extract just the image cell as a small client component). On `<Image onError>`, set `thumbBroken=true` and render `<BugNotFoundThumb />` instead of the Image.

Note: `next/image` needs `unoptimized` or you'll need to handle error via a ref + event listener. Simpler: switch the image cell to a plain `<img>` for failure-tolerant rendering, OR keep `<Image>` but listen for its `onError` (supported in next/image v15+).

- [ ] **Step 3: Test + commit**

E2E: temporarily point a tile's thumb to a non-existent file via DB stub, navigate to gallery, confirm placeholder renders.

```bash
git add app/components/gallery/BugNotFoundThumb.tsx app/gallery/_components/GridTile.tsx app/globals.css tests/components/BugNotFoundThumb.test.tsx
git commit --no-gpg-sign -m "feat(gallery): bug-not-found placeholder for missing thumbs (9 of 40k currently)"
```

---

## Task 2: Gallery filter row — flow horizontally, wrap as needed

**Files:**
- Modify: `app/globals.css` `.gallery-filter-row`

The row currently breaks at almost every chip. Force it to flow on one line until viewport forces wrap.

```css
.gallery-filter-row {
  display: flex;
  flex-wrap: wrap;            /* keep wrap as fallback */
  gap: 0.5rem 0.75rem;
  align-items: center;
  /* No fixed width on children — let them sit at intrinsic width.
     The WhatIsBugFilter empty chip + 4 other empty chips fit on one
     1440px line comfortably. */
}
.gallery-filter-row > * {
  flex: 0 0 auto;
}
```

- [ ] **Step 1: Adjust CSS, screenshot at 1440 and 720**
- [ ] **Step 2: Commit**

```bash
git add app/globals.css
git commit --no-gpg-sign -m "fix(gallery): filter row flows horizontally; wraps only when overflow"
```

---

## Task 3: Verify + surface default filter state on gallery

**Files:** investigation; possibly `app/gallery/page.tsx` + URL param defaults

The user perceives that "some filters are selected by default" on gallery but the chips don't reflect that. Two possibilities:
- URL persistence from a prior visit (browser back/forward)
- Implicit default (e.g., institution default excludes "unknown")

Investigation:
- [ ] **Step 1**: read `app/gallery/_components/FilterChipsControls.tsx` — confirm initial state purely from URL params; no implicit defaults
- [ ] **Step 2**: if any default is implicit (e.g., hidden filter on hidden=0 etc.), surface it as a chip with the value visible
- [ ] **Step 3**: if there are NO implicit defaults, no code change needed — but verify that `?subject=...` URL params from a previous gallery visit do correctly populate the chip. If they don't, fix that.
- [ ] **Step 4**: commit (or note "no defaults" in a doc comment)

---

## Task 4: Tile meta chips — institution, sex, life stage

**Files:**
- Create: `app/components/gallery/TileMetaChips.tsx`
- Modify: `app/gallery/_components/GridTile.tsx`
- Modify: `lib/queries/gallery.ts` — project institution, sex, life_stage into GalleryRow if not already
- Modify: `app/globals.css`

Display order (left to right, top to bottom):
1. Taxon order (existing — already removed in Phase A; bring back as a thin pill?)
2. Life stage (e.g., "adult", "larva")
3. Sex (e.g., "female", "worker")
4. Institution (e.g., "UGA")

Style: small italic serif pills in muted lilac; wrap to multiple lines as needed. Order chosen by relevance to drawing students: stage first (drawability), then sex (anatomy), then institution (attribution).

- [ ] **Step 1: TileMetaChips component**

```tsx
interface Props {
  lifeStage?: string | null;
  sex?: string | null;
  institution?: string | null;
}

export function TileMetaChips({ lifeStage, sex, institution }: Props) {
  const chips: { key: string; label: string }[] = [];
  if (lifeStage && lifeStage !== "unknown") chips.push({ key: "stage", label: lifeStage });
  if (sex && sex !== "unknown") chips.push({ key: "sex", label: sex });
  if (institution) chips.push({ key: "inst", label: institution });
  if (chips.length === 0) return null;
  return (
    <div className="grid-item-meta-chips">
      {chips.map((c) => (
        <span key={c.key} className={`grid-item-meta-chip is-${c.key}`}>{c.label}</span>
      ))}
    </div>
  );
}
```

CSS:
```css
.grid-item-meta-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem 0.35rem;
  margin-top: 0.35rem;
}
.grid-item-meta-chip {
  display: inline-block;
  font-family: var(--font-display), serif;
  font-style: italic;
  font-size: 0.7rem;
  padding: 0.1rem 0.5rem;
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent-lilac) 14%, transparent);
  color: var(--accent-lilac);
  letter-spacing: 0.02em;
}
.grid-item-meta-chip.is-inst {
  background: color-mix(in srgb, var(--accent-pink) 10%, transparent);
  color: var(--accent-pink);
}
```

- [ ] **Step 2**: Mount inside GridTile's `.grid-item-meta` after the name/scientific block.
- [ ] **Step 3**: Verify `searchGallery` returns these columns; add if not.
- [ ] **Step 4**: Commit

---

## Task 5: Session SourceInfoChip parity with gallery card

**Files:**
- Modify: `app/components/session/SourceInfoChip.tsx`

The chip in lower-right of session view should render the same info in the same order/style as the gallery tile meta:
- License (already there)
- Life stage / Sex / Institution chips (new — use same `<TileMetaChips>` component as Task 4)
- Source name (Bugwood / iNaturalist)
- Photographer attribution (existing)

- [ ] **Step 1**: Refactor `SourceInfoChip` to include `<TileMetaChips>` rendering the same data + ordering.
- [ ] **Step 2**: Visual diff between gallery tile + session chip; confirm parity.
- [ ] **Step 3**: Commit

---

## Task 6: Dice-roll random filter

**Files:**
- Create: `app/components/filters/DiceRoll.tsx`
- Modify: `app/components/home/HomeClient.tsx` + `app/gallery/_components/FilterChipsControls.tsx`
- Modify: `app/globals.css`

A button with a dice emoji/SVG that randomly sets the filter state to a curated random combination. Click → small dice tumble animation (CSS keyframes) → state updates → counts re-fetch.

- [ ] **Step 1: DiceRoll button + roll logic**

The roll picks ~2-3 filter axes at random with sensible distributions:
- 60% chance: pick 1-3 bug types from `TAXON_GROUPS`
- 50% chance: pick 1 view from `["dorsal", "lateral", "ventral", "head"]`
- 30% chance: pick 1 life stage from `["adult", "larva", "nymph"]`
- 20% chance: pick 1 photo type from `["wild", "specimen", "captive"]`

```tsx
"use client";
import { useState } from "react";

interface DiceRollProps {
  onRoll: (state: {
    groups?: string[];
    views?: string[];
    lifeStages?: string[];
    subjects?: string[];
  }) => void;
}

const GROUPS_POOL = ["butterflies", "moths", "beetles", "ladybugs", "dragonflies", "bees", "wasps", "mantises", "stick_insects"];

function pick<T>(arr: T[], n: number): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
}

export function DiceRoll({ onRoll }: DiceRollProps) {
  const [rolling, setRolling] = useState(false);
  function roll() {
    if (rolling) return;
    setRolling(true);
    const state: Parameters<typeof onRoll>[0] = {};
    if (Math.random() < 0.6) state.groups = pick(GROUPS_POOL, 1 + Math.floor(Math.random() * 3));
    if (Math.random() < 0.5) state.views = pick(["dorsal", "lateral", "ventral", "head"], 1);
    if (Math.random() < 0.3) state.lifeStages = pick(["adult", "larva", "nymph"], 1);
    if (Math.random() < 0.2) state.subjects = pick(["wild", "specimen", "captive"], 1);
    setTimeout(() => { setRolling(false); onRoll(state); }, 500);
  }
  return (
    <button
      type="button"
      className={`dice-roll ${rolling ? "is-rolling" : ""}`}
      onClick={roll}
      aria-label="surprise me — pick random filters"
      title="surprise me"
    >
      🎲
    </button>
  );
}
```

CSS:
```css
.dice-roll {
  appearance: none;
  background: color-mix(in srgb, var(--accent-pink) 18%, transparent);
  border: 1px solid color-mix(in srgb, var(--accent-pink) 35%, transparent);
  border-radius: 999px;
  padding: 0.5rem 0.85rem;
  font-size: 1.1rem;
  cursor: pointer;
  transition: transform 200ms cubic-bezier(0.22, 1, 0.36, 1), box-shadow 200ms;
}
.dice-roll:hover {
  transform: translateY(-1px);
  box-shadow: 0 0 16px color-mix(in srgb, var(--accent-pink) 40%, transparent);
}
.dice-roll.is-rolling {
  animation: diceTumble 500ms cubic-bezier(0.22, 1, 0.36, 1);
}
@keyframes diceTumble {
  0%   { transform: rotate(0deg) scale(1); }
  25%  { transform: rotate(180deg) scale(1.15); }
  50%  { transform: rotate(360deg) scale(0.9); }
  75%  { transform: rotate(540deg) scale(1.1); }
  100% { transform: rotate(720deg) scale(1); }
}
@media (prefers-reduced-motion: reduce) {
  .dice-roll.is-rolling { animation: none; }
}
```

- [ ] **Step 2**: Wire on home + gallery — pass `onRoll` that calls each `setGroups`/`setViews`/etc.
- [ ] **Step 3**: Visual verify the roll animation + state change.
- [ ] **Step 4**: Commit

---

## Task 7: Remove session pause overlay + bolder timer indicator

**Files:**
- Modify: `app/components/session/SessionPlayer.tsx` — drop `.session-paused-overlay`
- Modify: `app/components/session/Timer.tsx` — make the ⏸ + "paused" word much bolder
- Modify: `app/globals.css` — remove overlay CSS; bump timer pause styling

- [ ] **Step 1: Remove the overlay JSX block from SessionPlayer**

```tsx
// DELETE the entire {paused && <div className="session-paused-overlay">…</div>} block
```

- [ ] **Step 2: Bolder timer pause display**

In `Timer.tsx`, when paused, swap the timer time for a more prominent "⏸ PAUSED" treatment:

```tsx
return (
  <div className={`session-timer ${paused ? "is-paused" : ""}`}>
    {paused ? (
      <>
        <span className="session-timer-paused-glyph" aria-hidden>⏸</span>
        <span className="session-timer-paused-label">paused</span>
      </>
    ) : (
      <>{formattedTime}{muted && <span className="session-timer-muted-icon">⊘</span>}</>
    )}
  </div>
);
```

CSS:
```css
.session-timer.is-paused {
  background: color-mix(in srgb, var(--accent-pink) 35%, var(--surface-0));
  color: var(--surface-0);
}
.session-timer-paused-glyph {
  font-size: 1.1em;
  margin-right: 0.25rem;
}
.session-timer-paused-label {
  font-family: var(--font-display), serif;
  font-style: italic;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: lowercase;
}
/* DELETE .session-paused-overlay, .session-paused-glyph, .session-paused-label */
```

- [ ] **Step 3**: Visual verify — pause works, timer pill shows bold ⏸ paused, no center overlay, no blur.
- [ ] **Step 4**: Commit

---

## Task 8: Ramp-up arrow-hold skip + "whoa so fast" easter egg

**Files:**
- Modify: `app/components/session/SessionPlayer.tsx`
- Create: `app/components/session/WhoaSoFastOverlay.tsx`
- Modify: `app/globals.css`

Hold ArrowLeft / ArrowRight → after ~600ms of hold, start skipping with progressively faster intervals (700ms → 350ms → 175ms → 90ms). When the user outpaces the preload window (next image not yet loaded), show "whoa so fast" overlay with a spinny flower until preload catches up.

- [ ] **Step 1**: Remove the existing key-repeat suppression for ArrowLeft/Right

The current handler:
```ts
if (e.repeat && (e.key === "ArrowLeft" || e.key === "ArrowRight")) return;
```
will be replaced with a ramp counter. First `keydown` with `e.repeat=true` enters ramp mode.

- [ ] **Step 2**: Ramp logic via setInterval

```ts
const rampRef = useRef<{ dir: -1 | 1; interval: number; tickId: ReturnType<typeof setInterval> | null } | null>(null);
const rampStartRef = useRef<number>(0);

function startRamp(dir: -1 | 1) {
  rampStartRef.current = Date.now();
  function tick() {
    const heldMs = Date.now() - rampStartRef.current;
    const interval = heldMs < 1500 ? 700 : heldMs < 3000 ? 350 : heldMs < 5000 ? 175 : 90;
    if (dir === 1) goNext(); else goPrev();
    if (rampRef.current) {
      clearTimeout(rampRef.current.tickId!);
      rampRef.current.tickId = setTimeout(tick, interval);
      rampRef.current.interval = interval;
    }
  }
  rampRef.current = { dir, interval: 700, tickId: setTimeout(tick, 700) };
}
function stopRamp() {
  if (rampRef.current?.tickId) clearTimeout(rampRef.current.tickId);
  rampRef.current = null;
}
```

Bind:
- `keydown` ArrowLeft / ArrowRight + `e.repeat=true` → `startRamp(dir)` if not already ramping
- `keyup` ArrowLeft / ArrowRight → `stopRamp()`
- (Single-press arrow remains the original `goPrev`/`goNext` — only `e.repeat=true` triggers ramp)

- [ ] **Step 3: "Whoa so fast" overlay**

```tsx
// app/components/session/WhoaSoFastOverlay.tsx
import { CuteFlower } from "@/app/components/icons";

export function WhoaSoFastOverlay({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <div className="session-whoa" role="status">
      <CuteFlower size={64} className="session-whoa-flower" />
      <span>whoa so fast!</span>
    </div>
  );
}
```

CSS:
```css
.session-whoa {
  position: fixed; top: 18%; left: 50%; transform: translateX(-50%);
  z-index: 40;
  display: flex; align-items: center; gap: 0.5rem;
  padding: 0.85rem 1.5rem;
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent-pink) 92%, transparent);
  color: var(--surface-0);
  font-family: var(--font-display), serif;
  font-style: italic;
  font-weight: 600;
  font-size: 1.05rem;
  animation: whoaIn 200ms cubic-bezier(0.22, 1, 0.36, 1);
}
.session-whoa-flower {
  animation: spin 800ms linear infinite;
}
@keyframes whoaIn {
  from { transform: translate(-50%, -8px); opacity: 0; }
  to { transform: translate(-50%, 0); opacity: 1; }
}
```

Mount `<WhoaSoFastOverlay visible={whoa} />` in SessionPlayer. Set `whoa=true` when `preloadRef.current?.isReady(items[idx + 1]?.imageId) === false` AND ramp is active. Clear on ramp stop OR preload-catchup.

(Preload manager needs an `isReady(imageId): boolean` method — verify it exists or add it.)

- [ ] **Step 4**: Commit

---

## Task 9: Start session "stuck in starting" safety

**Files:**
- Modify: `app/components/home/StartSessionButton.tsx`

Phase E removed `setPending(false)` from `finally` so navigation could happen with pending=true. But if the POST succeeds and `router.push()` silently fails (e.g., user back-navigates, network error during page nav), pending stays true forever — user gets stuck.

- [ ] **Step 1**: Add a 12-second safety reset

```tsx
async function start() {
  setPending(true);
  setError(null);
  const safety = window.setTimeout(() => {
    setPending(false);
    setError("took too long — please try again");
  }, 12000);
  try {
    const res = await fetch("/api/session/start", { ... });
    if (!res.ok) {
      window.clearTimeout(safety);
      setError(await res.text());
      setPending(false);
      return;
    }
    const data = await res.json();
    // Navigation cancels the safety; if navigation actually unmounts,
    // the timer is moot.
    window.clearTimeout(safety);
    router.push(`/session?session=${...}&interval=${intervalSec}`);
  } catch (e) {
    window.clearTimeout(safety);
    setError(String(e));
    setPending(false);
  }
}
```

- [ ] **Step 2**: Commit

---

## Task 10: Memory management audit (investigation only — no code changes unless leak surfaces)

**Files:** read-only

Verify:
- `lib/preload-manager.ts` — does it cap the preload window so old `Image()` objects are eligible for GC? Currently preloads next-3 + previous-1. Should also stop holding refs to images outside the window.
- `lib/session-pools.ts` — the in-memory pool map. Are sessions evicted after some TTL? After end of session?
- Browser: `next/image` caches in the HTTP cache. Memory usage should stay bounded by the HTTP cache limit (browser-managed).

Steps:
- [ ] **Step 1**: Read `lib/preload-manager.ts` — note the eviction strategy
- [ ] **Step 2**: Read `lib/session-pools.ts` — confirm TTL or session-end cleanup
- [ ] **Step 3**: If gaps found, file as a follow-up task (NOT in this plan) and note in commit message
- [ ] **Step 4**: Write a short note to `docs/superpowers/notes-memory-audit-2026-05-17.md` summarizing findings

---

## Final verification

- [ ] tsc clean, vitest 209+/209+, e2e suite (sequential mode)
- [ ] `npm run build` clean
- [ ] Visual MCP at 1440×900 and 375×800:
  - Gallery: filter row flows + wraps; meta chips on tiles (stage/sex/inst); broken-thumb placeholder where applicable; dice button visible
  - Session: no centered pause overlay; bolder timer pause; source chip = gallery card style
  - Home: dice button next to start session (or near filter row); no other regressions
- [ ] Push only after user confirms
