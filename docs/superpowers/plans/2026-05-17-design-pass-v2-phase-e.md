# Design Pass v2 — Phase E: Session player polish round 2 + gallery license

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Fix 8 user-feedback items found after Phase D first-look: session counter style, gallery license display, mobile pause-on-tap, paused-state overlay, magnifier touchpad ergonomics, state reset across sessions, start-session flicker, audio mute toggle.

**Architecture:** All but one item touch the session player (`SessionPlayer.tsx`, `SessionActionBar.tsx`, `Magnifier.tsx`). Mute is a new piece of state persisted to `localStorage`; everything else is JSX/CSS/handler tweaks.

**Tech Stack:** Next.js 16, React 19, TypeScript, existing audio cue module (`lib/audio.ts`), localStorage for mute persistence.

---

## Task 1: Start-session flicker fix

**Problem:** Clicking start session shows "starting…" → reverts to "start session" → blank → session screen. The `finally` block clears `pending` before navigation lands.

**File:** `app/components/home/StartSessionButton.tsx`

- [ ] **Step 1: Keep `pending` set after successful navigation**

Replace the `start()` function:

```ts
async function start() {
  setPending(true);
  setError(null);
  try {
    const res = await fetch("/api/session/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        intervalSec, subjectType, repeatMode,
        views, lifeStages, sexes, groups,
        q: species,
      }),
    });
    if (!res.ok) {
      setError(await res.text());
      setPending(false);
      return;
    }
    const data = (await res.json()) as { sessionId: string };
    router.push(`/session?session=${encodeURIComponent(data.sessionId)}&interval=${intervalSec}`);
    // Intentionally do NOT clear pending here — the component unmounts on
    // successful navigation. If the user back-navigates before /session
    // renders, React Suspense will re-render this component with pending=true
    // which is harmless (button is just disabled; user can click again).
  } catch (e) {
    setError(String(e));
    setPending(false);
  }
}
```

- [ ] **Step 2: Add a `loading.tsx` for the session route**

Create `app/session/loading.tsx`:

```tsx
export default function SessionLoading() {
  return (
    <main className="session-loading" aria-label="loading session">
      <div className="session-loading-flower" aria-hidden>✿</div>
      <p>starting your session…</p>
    </main>
  );
}
```

Append to `app/globals.css`:

```css
.session-loading {
  position: fixed; inset: 0;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  gap: 1rem;
  background: var(--surface-0);
  color: var(--accent-pink);
  font-family: var(--font-serif), serif;
  font-style: italic;
}
.session-loading-flower {
  font-size: 3rem;
  animation: spin 1.6s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) {
  .session-loading-flower { animation: none; }
}
```

- [ ] **Step 3: Verify the transition**

Playwright MCP:
1. Navigate `/`
2. Click "start session"
3. Confirm button stays at "starting…" until the session-loading screen takes over, then session renders. No flicker back to "start session".

- [ ] **Step 4: Commit**

```bash
git add app/components/home/StartSessionButton.tsx app/session/loading.tsx app/globals.css
git commit --no-gpg-sign -m "fix(home): start-session no longer flickers — keep pending through navigation + loading.tsx"
```

---

## Task 2: Session state reset across sessions

**Problem:** When user exits a session and starts a new one, `bw` / `magnifier` state may persist. The `SessionPlayer` uses local `useState`, so a remount resets — but if the route stays mounted across `/session?session=A` → `/session?session=B`, Next.js reuses the component instance and state persists.

**Files:** `app/session/page.tsx` or wherever `SessionPlayer` is rendered

- [ ] **Step 1: Verify the issue**

Read `app/session/page.tsx`. Confirm whether the `SessionPlayer` element has a `key` tied to the session ID. If not, React reconciles the component across navigations.

- [ ] **Step 2: Add `key={sessionId}` to force remount**

Edit the SessionPlayer render site:

```tsx
<SessionPlayer
  key={sessionId}
  items={items}
  initialIntervalSec={intervalSec}
/>
```

The key forces a fresh mount per session, resetting `bw`, `magnifier`, `paused`, etc.

- [ ] **Step 3: E2E verify**

Add or extend `tests/e2e/session-polish.spec.ts`:

```ts
test("session state resets when starting a new session", async ({ page }) => {
  // Start session 1
  let res = await page.request.post("http://localhost:3000/api/session/start", {
    data: { intervalSec: 60, subjectType: "all", repeatMode: "default", views: [], lifeStages: [], sexes: [], groups: [], q: [] },
  });
  const s1 = (await res.json()).sessionId;
  await page.goto(`/session?session=${s1}&interval=60`);
  // Toggle B&W via keyboard
  await page.keyboard.press("b");
  let bw = await page.locator(".session-image-frame img").evaluate((el) => getComputedStyle(el).filter);
  expect(bw).toContain("grayscale");
  // Start session 2
  await page.goto("/");
  res = await page.request.post("http://localhost:3000/api/session/start", {
    data: { intervalSec: 60, subjectType: "all", repeatMode: "default", views: [], lifeStages: [], sexes: [], groups: [], q: [] },
  });
  const s2 = (await res.json()).sessionId;
  await page.goto(`/session?session=${s2}&interval=60`);
  // B&W should be off
  bw = await page.locator(".session-image-frame img").evaluate((el) => getComputedStyle(el).filter);
  expect(bw).not.toContain("grayscale");
});
```

- [ ] **Step 4: Commit**

```bash
git add app/session/page.tsx tests/e2e/session-polish.spec.ts
git commit --no-gpg-sign -m "fix(session): key={sessionId} forces fresh state on each new session"
```

---

## Task 3: Session counter — unify visual with gallery

**Problem:** Action bar counter renders as a chip ("29 of 39631" with sky-blue digits + monospace `of`), inconsistent with the gallery's plain-text count. The user finds it unclear.

**File:** `app/components/session/SessionActionBar.tsx`, `app/globals.css`

- [ ] **Step 1: Drop the chip styling**

Find `.session-counter-current`, `.session-counter-sep`, `.session-counter-total` CSS in `app/globals.css`. Replace with:

```css
.session-counter {
  display: inline-flex; align-items: center; justify-content: center;
  font-family: var(--font-serif), serif;
  font-style: italic;
  font-size: 0.85rem;
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
  gap: 0.25rem;
  white-space: nowrap;
  min-width: 76px; /* matches stacked-button slot from Phase B */
}
.session-counter-current {
  color: var(--accent-pink);
  font-weight: 500;
}
.session-counter-sep { opacity: 0.7; font-style: italic; }
.session-counter-total { color: var(--text-secondary); }
```

(No background, no border, no monospace — same friendly serif italic the rest of the app uses.)

- [ ] **Step 2: Format the total with thousands separators**

In `SessionActionBar.tsx`, ensure the total renders as `total.toLocaleString()` not the raw integer. The current count "29 of 39631" should read "29 of 39,631".

- [ ] **Step 3: Visual verify**

Playwright MCP: session player with chrome surfaced, screenshot the action bar. Counter should be plain serif italic text matching the action labels, not a chip.

- [ ] **Step 4: Commit**

```bash
git add app/components/session/SessionActionBar.tsx app/globals.css
git commit --no-gpg-sign -m "fix(session): counter is plain serif italic, not a chip — matches gallery + thousands separators"
```

---

## Task 4: Gallery tile license badge

**Files:**
- Modify: `app/gallery/_components/GridTile.tsx`
- Modify: `app/globals.css`
- Verify: `lib/queries/gallery.ts` projects `license` (or join from `images.license`)

- [ ] **Step 1: Confirm `license` reaches the tile**

Grep:
```bash
grep -n "license" lib/queries/gallery.ts | head -10
```

If `license` is in the SELECT list, `row.license` is available on `GalleryRow`. If not, add it (it's an `images` column).

- [ ] **Step 2: Render license as muted text bottom-right of tile**

In `GridTile.tsx`, just after the `<TileActions />` element, add:

```tsx
{row.license && (
  <span className="grid-item-license" aria-label={`license ${row.license}`}>
    {row.license}
  </span>
)}
```

Append to `app/globals.css`:

```css
.grid-item-license {
  position: absolute;
  left: 0.5rem;
  bottom: 0.5rem;
  font-size: 0.65rem;
  padding: 0.15rem 0.45rem;
  border-radius: 999px;
  background: color-mix(in srgb, var(--surface-0) 80%, transparent);
  color: var(--text-tertiary);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  backdrop-filter: blur(6px);
  /* Always visible (not hover-gated) — license is required attribution. */
}
```

(Bottom-left so it doesn't fight the bottom-right hover actions.)

- [ ] **Step 3: Visual verify**

Playwright MCP: `/gallery` desktop. Each tile shows a muted "CC-BY" / "CC-BY-NC" / "public-domain" pill in bottom-left.

- [ ] **Step 4: Commit**

```bash
git add app/gallery/_components/GridTile.tsx app/globals.css lib/queries/gallery.ts
git commit --no-gpg-sign -m "feat(gallery): persistent license pill bottom-left of every tile"
```

---

## Task 5: Pause overlay + pause indicator in timer

**Files:**
- Modify: `app/components/session/SessionPlayer.tsx` — render overlay when paused
- Modify: `app/components/session/Timer.tsx` — show ⏸ icon + "paused" text when paused
- Modify: `app/globals.css`

- [ ] **Step 1: Pause overlay in SessionPlayer**

Inside the `<main>` JSX in `SessionPlayer.tsx`, just below `<SessionImage ... />`, add:

```tsx
{paused && (
  <div className="session-paused-overlay" role="status" aria-live="polite">
    <span className="session-paused-glyph" aria-hidden>⏸</span>
    <span className="session-paused-label">paused</span>
  </div>
)}
```

Append to `app/globals.css`:

```css
.session-paused-overlay {
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  background: color-mix(in srgb, var(--surface-0) 55%, transparent);
  backdrop-filter: blur(3px);
  pointer-events: none;
  z-index: 30;
  animation: pausedFadeIn 200ms cubic-bezier(0.22, 1, 0.36, 1);
}
@keyframes pausedFadeIn { from { opacity: 0; } to { opacity: 1; } }
.session-paused-glyph {
  font-size: 4rem;
  color: var(--accent-pink);
  filter: drop-shadow(0 0 14px color-mix(in srgb, var(--accent-pink) 50%, transparent));
}
.session-paused-label {
  font-family: var(--font-serif), serif;
  font-style: italic;
  font-size: 1.2rem;
  color: var(--text-primary);
}
```

- [ ] **Step 2: Timer pill — show ⏸ when paused**

In `Timer.tsx`, where the time string renders, prefix with a pause icon when `paused`:

```tsx
{paused && <span aria-hidden className="session-timer-paused-icon">⏸</span>}
{formattedTime}
```

Append CSS:

```css
.session-timer-paused-icon {
  margin-right: 0.3rem;
  color: var(--accent-pink);
}
```

- [ ] **Step 3: Verify**

Playwright MCP: navigate to session, press space (pause), screenshot. Confirm:
- Center overlay shows ⏸ + "paused"
- Timer pill shows ⏸ prefix
- Image dims (backdrop blur)

- [ ] **Step 4: Commit**

```bash
git add app/components/session/SessionPlayer.tsx app/components/session/Timer.tsx app/globals.css
git commit --no-gpg-sign -m "feat(session): paused state shows centered overlay + ⏸ in timer pill"
```

---

## Task 6: Mobile tap-to-pause

**Problem:** On mobile, there's no easy way to pause without finding the action bar. Tapping the image (with intent — not a swipe) should toggle pause.

**File:** `app/components/session/SessionPlayer.tsx`

- [ ] **Step 1: Add a touch tap detector**

Add a touch handler on the `<main>` element that distinguishes tap from swipe. A tap = touchstart + touchend within ~250ms and < 10px movement.

```tsx
const touchStartRef = useRef<{ x: number; y: number; t: number } | null>(null);

function onTouchStart(e: React.TouchEvent) {
  const t = e.touches[0];
  if (!t) return;
  touchStartRef.current = { x: t.clientX, y: t.clientY, t: Date.now() };
}

function onTouchEnd(e: React.TouchEvent) {
  const start = touchStartRef.current;
  touchStartRef.current = null;
  if (!start) return;
  const t = e.changedTouches[0];
  if (!t) return;
  const dx = Math.abs(t.clientX - start.x);
  const dy = Math.abs(t.clientY - start.y);
  const dt = Date.now() - start.t;
  if (dx < 10 && dy < 10 && dt < 250) {
    // Tap, not swipe → toggle pause. Ignore if user tapped inside the action
    // bar (the buttons there have their own handlers and click will bubble).
    const target = e.target as HTMLElement;
    if (target.closest(".session-action-bar-panel")) return;
    if (target.closest(".session-magnifier")) return;
    setPaused((p) => !p);
  }
}
```

Wire `onTouchStart` and `onTouchEnd` on the `<main>` element.

- [ ] **Step 2: E2E test (basic — tap not pointerdown)**

Add to `tests/e2e/session-polish.spec.ts`:

```ts
test("mobile tap pauses; second tap unpauses", async ({ browser }) => {
  // Force a mobile-like context with touch enabled
  const ctx = await browser.newContext({
    viewport: { width: 414, height: 896 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await ctx.newPage();
  const res = await page.request.post("http://localhost:3000/api/session/start", {
    data: { intervalSec: 60, subjectType: "all", repeatMode: "default", views: [], lifeStages: [], sexes: [], groups: [], q: [] },
  });
  const sessionId = (await res.json()).sessionId;
  await page.goto(`/session?session=${sessionId}&interval=60`);
  // Tap in image area (avoid action bar at bottom)
  await page.touchscreen.tap(207, 300);
  await expect(page.locator(".session-paused-overlay")).toBeVisible();
  await page.touchscreen.tap(207, 300);
  await expect(page.locator(".session-paused-overlay")).toHaveCount(0);
  await ctx.close();
});
```

- [ ] **Step 3: Commit**

```bash
git add app/components/session/SessionPlayer.tsx tests/e2e/session-polish.spec.ts
git commit --no-gpg-sign -m "feat(session): mobile tap toggles pause — distinguishes tap from swipe via <10px <250ms"
```

---

## Task 7: Magnifier — make left-click also expand

**Problem:** On Mac trackpad without secondary-click configured, tapping fingers triggers a left-click which currently CLOSES the magnifier. The user expected tap to ENLARGE (expand).

**File:** `app/components/session/Magnifier.tsx`

- [ ] **Step 1: Read current behavior**

Magnifier currently:
- `pointermove` updates loupe position
- `contextmenu` (right-click) toggles `expanded`
- Esc / left-click (somewhere — find where) closes the magnifier

Find where left-click closes. Update so:
- Click anywhere INSIDE the loupe → toggle `expanded` (acts like the current right-click)
- Esc → close (set `size` to "off" via the cycle)
- Right-click → also expand (unchanged)
- Click outside the image (e.g., on action bar) → no effect

This makes the Mac trackpad's natural one-finger tap = expand.

- [ ] **Step 2: Update Magnifier event handlers**

In `Magnifier.tsx`, replace the close-on-left-click handler with an expand handler. The Esc-closes-magnifier handler stays. Specifically, find any `pointerdown` or `click` handler that previously closed; switch it to:

```tsx
const onMagnifierClick = (e: MouseEvent) => {
  e.preventDefault();
  setExpanded((v) => !v);
};
```

And bind to the loupe div (the `.session-magnifier` element), not the whole document.

Update the hint pill text:

```tsx
{showHint && (
  <div className="session-magnifier-hint" ...>
    esc: close · tap/click: expand
  </div>
)}
```

- [ ] **Step 3: Verify in browser**

Playwright MCP: navigate to session, press Z to activate magnifier, move mouse to center, dispatch `click` on the loupe element. Confirm `expanded` toggles (loupe gets bigger).

Also test Esc — confirm magnifier disappears.

- [ ] **Step 4: Commit**

```bash
git add app/components/session/Magnifier.tsx
git commit --no-gpg-sign -m "fix(magnifier): tap/click toggles expand (was close) — matches Mac trackpad tap-to-click"
```

---

## Task 8: Audio mute toggle

**Files:**
- Create: `lib/hooks/useMuted.ts` — localStorage-backed mute state
- Modify: `lib/audio.ts` — accept a `muted` getter so ding/countdown become no-ops
- Modify: `app/components/session/SessionPlayer.tsx` — wire mute state into audio, pass to SessionActionBar
- Modify: `app/components/session/SessionActionBar.tsx` — add mute button + show mute icon next to counter when muted
- Modify: `app/components/session/Timer.tsx` — show 🔇 next to time when muted

- [ ] **Step 1: Mute hook**

Create `lib/hooks/useMuted.ts`:

```ts
"use client";
import { useEffect, useState } from "react";

const KEY = "line-of-bugs:muted";

export function useMuted(): [boolean, (next: boolean) => void] {
  const [muted, setMuted] = useState(false);
  // Restore on mount
  useEffect(() => {
    try {
      setMuted(localStorage.getItem(KEY) === "1");
    } catch { /* SSR or storage disabled */ }
  }, []);
  // Persist on change
  function update(next: boolean) {
    setMuted(next);
    try { localStorage.setItem(KEY, next ? "1" : "0"); } catch { /* ignore */ }
  }
  return [muted, update];
}
```

- [ ] **Step 2: Audio API accepts muted-getter**

Modify `lib/audio.ts` — `makeAudio(...)` to accept an `isMuted: () => boolean` callback. Inside `ding`, `countdown`, `transition`, return early if `isMuted()` returns true.

```ts
export function makeAudio(opts?: { isMuted?: () => boolean }): AudioCues {
  // ... existing setup
  const isMuted = opts?.isMuted ?? (() => false);
  return {
    ding() { if (isMuted()) return; /* existing ding */ },
    countdown(n) { if (isMuted()) return; /* existing */ },
    transition() { if (isMuted()) return; /* existing */ },
  };
}
```

- [ ] **Step 3: SessionPlayer wires it**

In `SessionPlayer.tsx`:

```tsx
import { useMuted } from "@/lib/hooks/useMuted";

const [muted, setMuted] = useMuted();
const mutedRef = useRef(muted);
mutedRef.current = muted;

// Pass an isMuted-getter to makeAudio
useEffect(() => {
  audioRef.current = makeAudio({ isMuted: () => mutedRef.current });
  // ... existing preload setup
}, [items]);

// Pass mute state + setter to action bar
<SessionActionBar
  ...
  muted={muted}
  onToggleMute={() => setMuted(!muted)}
/>
```

- [ ] **Step 4: Action bar — add mute button**

Add an IconBtn slot in `SessionActionBar.tsx`. Glyph: `🔇` when muted, `🔊` when not. Label: `muted` / `sound`. Hint: `M` (the keyboard shortcut). Add `'m'` / `'M'` case to the keyboard handler that calls `onToggleMute`.

Place the mute button between `b.w` and `magnifier` so the bar reads naturally. Maintain the equal-width grid (already has min-width:76px from Phase B).

- [ ] **Step 5: Timer shows mute icon next to time when muted**

In `Timer.tsx`:

```tsx
{paused && <span aria-hidden className="session-timer-paused-icon">⏸</span>}
{formattedTime}
{muted && <span aria-hidden className="session-timer-muted-icon">🔇</span>}
```

(Timer needs a `muted` prop passed from SessionPlayer.)

Append CSS:

```css
.session-timer-muted-icon {
  margin-left: 0.3rem;
  opacity: 0.85;
}
```

- [ ] **Step 6: E2E verify**

Add a test that toggles mute via keyboard, verifies localStorage persists across reload, and confirms the timer mute icon appears.

- [ ] **Step 7: Commit**

```bash
git add lib/hooks/useMuted.ts lib/audio.ts app/components/session/SessionPlayer.tsx app/components/session/SessionActionBar.tsx app/components/session/Timer.tsx app/globals.css tests/e2e/session-polish.spec.ts
git commit --no-gpg-sign -m "feat(session): audio mute toggle — keyboard M, persisted to localStorage, icon next to timer"
```

---

## Final verification

- [ ] **Step 1: tsc + vitest + playwright**

```bash
npx tsc --noEmit && npx vitest run --reporter=default && npx playwright test --reporter=line
```
Expected: all green.

- [ ] **Step 2: Production build**

```bash
npm run build 2>&1 | tail -10
```

- [ ] **Step 3: Visual MCP — desktop + mobile**

- Home → click start session → no flicker, loading screen, session lands
- Session → press space → centered paused overlay + ⏸ in timer
- Session → press M → mute icon next to timer, ding silenced
- Session → press Z → magnifier on; click in loupe → expands
- Mobile (375×800) → tap image center → paused; tap again → unpaused
- Gallery → each tile shows license pill bottom-left
- Session counter → plain serif italic, "29 of 39,631" with thousands separator

- [ ] **Step 4: Push**

```bash
git push origin main
```
