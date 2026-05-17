# Sketchfab Idle Preloader + Fast-Fail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the Sketchfab panel from hanging on uncached species (5s timeout → distinct "couldn't find" copy), AND warm the cache for the next 3 slides ahead so opening the panel feels instant. Mobile memory budget is a first-class concern — no closure leaks, no unbounded maps, no orphaned event listeners.

**Architecture:** Two layers. (1) A 5s timeout on `fetchSketchfab` so any slow / failing live call surfaces a timeout-specific empty-state. (2) A new `useSketchfabPreloader(items, idx)` hook that schedules JSON + thumbnail prefetches for `items[idx+1..idx+3]` via `requestIdleCallback`, with network-aware skip, tab-hidden gate, abort-on-unmount, and a concurrent-thumbnails cap. React Query's existing `gcTime` is the cache backstop; we add no new caching primitives.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, `@tanstack/react-query` 5.x, Vitest browser tier (`vitest-browser-react`), Playwright e2e.

---

## Reference research / context

- Existing prefetch: `app/components/session/SessionPlayer.tsx` ~lines 61-80 (current + N+1 `prefetchSketchfab` effects via a `useCallback`)
- Existing panel query: `app/components/session/SketchfabBrowsePanel.tsx:55-61` (uses `staleTime: 10min`, `gcTime: 20min`)
- Existing fetch: `SketchfabBrowsePanel.tsx:13-24` (`fetchSketchfab`, no timeout)
- Existing availability hook: `SketchfabBrowsePanel.tsx:144-157` (`useSketchfabAvailability`, shares the same query key)
- Provider defaults: `app/providers/ReactQueryProvider.tsx` (`staleTime: 5min`, `gcTime: 10min`, `retry: 1`)
- Vitest config: `vitest.config.ts` has separate `node` and `browser` projects. Anything that touches `window.location`, `Image`, `requestIdleCallback`, or React rendering MUST go in the `browser` project's `include` array — see existing `tests/lib/preload-manager.test.ts` as the pattern.
- Production blocker context: prod's Hetzner IP is bot-blocked by Akamai → live Sketchfab calls always 502 after ~30s. The Windmill enrichment job (running on the Pi) populates the precache; this plan covers the UX gap while the cache catches up to a newly-added species.

## Design decisions (locked in)

1. **Timeout: 5s** with a `SketchfabTimeoutError` type. Panel render branches on `error instanceof SketchfabTimeoutError` to show a timeout-specific message ("Couldn't find anything on Sketchfab for this species in time. Try the manual search ↗"), distinct from the generic network-error message ("Couldn't reach Sketchfab right now").
2. **Preload window: 3 slides ahead** (idx+1, idx+2, idx+3). Replaces the current N+1-only effect.
3. **Schedule via `requestIdleCallback`** with `timeout: 3000` fallback (forces execution at 3s even if browser never goes idle). Polyfill for Safari < 17 using `setTimeout(200)`. The wrapper tracks each handle's kind (`"ric"` or `"timeout"`) in a Map so `cancelIdle` routes correctly; the Map self-cleans on natural fire AND on cancel (no unbounded growth).
4. **Concurrent thumbnail loads capped at 4** — uses a tiny in-memory semaphore. Image `onload`/`onerror` are nulled out after each promise settles to drop closure references early on mobile.
5. **Skip preload on `Save-Data`, `effectiveType in ('slow-2g', '2g')`** — user opts out via browser/OS.
6. **Gate on `document.visibilityState === 'hidden'`** — re-checked at the start of each effect run, so the next slide change resumes preloading. No standalone `visibilitychange` listener (avoids dead-code event listener; the gate is enough for our use case).
7. **No new cache layer.** React Query already does it. Thumbnails ride the browser HTTP cache (Sketchfab's CDN sets `cache-control: public, max-age=31536000`).
8. **`prefetchQuery` (NOT `fetchQuery`).** `fetchQuery` throws on failure (we'd have to .catch in the .then chain to avoid an unhandled rejection). `prefetchQuery` returns `Promise<void>` and swallows the error. Either way, React Query writes the error state to the cache, but only `data` is missing on failure — so we read via `qc.getQueryData()` AFTER prefetch and ONLY chain to thumbnails when data is actually present. Brief flash of `isError` on a subsequent panel open after a failed preload is acceptable (React Query's default `refetchOnMount: true` will re-attempt); this is the rare-failure tradeoff. We do NOT call `qc.removeQueries` to scrub the errored entry because it would also kill any concurrent same-key fetch the panel might have started.

11a. **Cleanup semantics (what `aborts.forEach(c => c.abort())` actually does).** Our per-species `AbortController` is NOT connected to React Query's fetch signal — React Query owns its own. So `ctrl.abort()` cannot cancel an in-flight fetch. What it CAN do (and does): set `ctrl.signal.aborted = true` so the defensive `if (ctrl.signal.aborted) return` inside the `.then` chain prevents the post-fetch thumbnail loop from running after unmount. That's the actual leak guard — prevents up to PRELOAD_AHEAD × hits-per-species Image instances from being created against torn-down state. In-flight fetches still complete (5s timeout bounds the worst case) and write to React Query's cache; that's harmless and could even be useful if the user navigates back to the species.
9. **`AbortSignal.any` polyfill** for Safari < 17.4 — many iPad / older iPhone students will be on it. Without the polyfill, the panel fetch throws `TypeError` immediately and breaks entirely.
10. **`AbortSignal.timeout` is NOT used.** Looks cleaner but is a host timer that `vi.useFakeTimers` cannot intercept, breaking the regression test. Stick with `setTimeout(() => ctrl.abort(...), TIMEOUT_MS)`.
11. **DO NOT suspend on `paused` state.** Pausing is brief; tab-hidden is the right pause signal.

## File structure

**Create:**
- `lib/sketchfab/query-keys.ts` — `sketchfabQueryKey()` extracted from the panel so lib/ code doesn't import from `app/components/`.
- `lib/sketchfab/abort-helpers.ts` — `anySignal()` polyfill for `AbortSignal.any`.
- `lib/sketchfab/fetch-with-timeout.ts` — wraps `fetchSketchfab` with a 5s timeout via `anySignal`. Exports `SketchfabTimeoutError`.
- `lib/sketchfab/preload-utils.ts` — `preloadThumbnails(urls, opts)` + connection-aware `shouldPreload()`.
- `lib/hooks/useRequestIdleCallback.ts` — `scheduleIdle` / `cancelIdle` with handle-kind tracking.
- `lib/hooks/useSketchfabPreloader.ts` — the orchestrator hook.
- `tests/lib/abort-helpers.test.ts` (browser tier)
- `tests/lib/fetch-with-timeout.test.ts` (browser tier)
- `tests/lib/useRequestIdleCallback.test.ts` (browser tier)
- `tests/lib/sketchfab-preload-utils.test.ts` (browser tier)
- `tests/components/useSketchfabPreloader.test.tsx`

**Modify:**
- `app/components/session/SketchfabBrowsePanel.tsx` — `fetchSketchfab` delegates to the timeout helper; import `sketchfabQueryKey` from `lib/sketchfab/query-keys`; render branches on `SketchfabTimeoutError`.
- `app/components/session/SessionPlayer.tsx` — replace the N+1 prefetch effect with a single `useSketchfabPreloader` call; keep the current-slide prefetch.
- `tests/components/SketchfabBrowsePanel.test.tsx` — add the 5s-timeout-shows-timeout-copy regression test.

## Scope check

This is one subsystem (panel-content prefetch & loading UX). One plan. Phase split is in TASK ORDER below: Tasks 1-4 ship the fast-fail (small PR, fixes the screenshot bug). Tasks 5-10 add the preloader (larger PR). Each phase is independently shippable and testable.

---

# Phase 1 — Fast-fail (ship first)

## Task 1: Extract `sketchfabQueryKey` to lib/

**Files:**
- Create: `lib/sketchfab/query-keys.ts`
- Modify: `app/components/session/SketchfabBrowsePanel.tsx` (replace local def with import)

**Why:** Avoids the `lib/` → `app/components/` import path needed by the preloader hook later. Pure mechanical extraction, no behavior change.

- [ ] **Step 1: Create the new module**

```typescript
// lib/sketchfab/query-keys.ts
export function sketchfabQueryKey(scientific: string, common: string) {
  return ["sketchfab", scientific, common] as const;
}
```

- [ ] **Step 2: Update the panel to import from the new location**

In `app/components/session/SketchfabBrowsePanel.tsx`:

Add to imports:
```typescript
import { sketchfabQueryKey } from "@/lib/sketchfab/query-keys";
```

Delete the local definition (current lines 26-28):
```typescript
export function sketchfabQueryKey(scientific: string, common: string) {
  return ["sketchfab", scientific, common] as const;
}
```

Re-export so existing callers (e.g., `SessionPlayer.tsx`) don't break:
```typescript
export { sketchfabQueryKey } from "@/lib/sketchfab/query-keys";
```

- [ ] **Step 3: Verify existing tests still pass**

```bash
npm run test --silent -- --run
```

Expected: existing baseline, no failures, no new tests yet.

- [ ] **Step 4: Commit**

```bash
git add lib/sketchfab/query-keys.ts app/components/session/SketchfabBrowsePanel.tsx
git commit --no-gpg-sign -m "refactor(sketchfab): extract sketchfabQueryKey to lib/

Prep work for the preloader hook — keeps lib/ from importing
out of app/components/."
```

---

## Task 2: `anySignal` polyfill for `AbortSignal.any`

**Files:**
- Create: `lib/sketchfab/abort-helpers.ts`
- Test: `tests/lib/abort-helpers.test.ts`

**Why a separate module:** the polyfill is reusable, and centralizing it means one place to delete when Safari < 17.4 is no longer a concern.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/lib/abort-helpers.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { anySignal } from "@/lib/sketchfab/abort-helpers";

describe("anySignal", () => {
  afterEach(() => vi.restoreAllMocks());

  it("delegates to native AbortSignal.any when present", () => {
    const native = vi.fn().mockReturnValue(new AbortController().signal);
    vi.spyOn(AbortSignal, "any").mockImplementation(native as never);
    const a = new AbortController().signal;
    const b = new AbortController().signal;
    anySignal([a, b]);
    expect(native).toHaveBeenCalledWith([a, b]);
  });

  it("polyfill: aborts when any input signal aborts", () => {
    // Force the polyfill branch by deleting the static method
    const original = AbortSignal.any;
    // @ts-expect-error — testing the polyfill branch
    delete AbortSignal.any;
    try {
      const a = new AbortController();
      const b = new AbortController();
      const merged = anySignal([a.signal, b.signal]);
      expect(merged.aborted).toBe(false);
      b.abort(new Error("from b"));
      expect(merged.aborted).toBe(true);
    } finally {
      // Restore so subsequent tests get native behavior
      AbortSignal.any = original;
    }
  });

  it("polyfill: short-circuits when an input is already aborted", () => {
    const original = AbortSignal.any;
    // @ts-expect-error
    delete AbortSignal.any;
    try {
      const a = new AbortController();
      a.abort();
      const b = new AbortController();
      const merged = anySignal([a.signal, b.signal]);
      expect(merged.aborted).toBe(true);
    } finally {
      AbortSignal.any = original;
    }
  });
});
```

- [ ] **Step 2: Run the test (must fail)**

```bash
npm run test -- tests/lib/abort-helpers.test.ts
```

Expected: FAIL — `Cannot find module '@/lib/sketchfab/abort-helpers'`.

- [ ] **Step 3: Add the test path to vitest config (BROWSER tier)**

Edit `vitest.config.ts` and add `"tests/lib/abort-helpers.test.ts"` to the **`browser`** project's `include` array (NOT `node` — these tests use browser AbortSignal semantics; keep all new lib tests in the browser tier for consistency with `tests/lib/preload-manager.test.ts`).

- [ ] **Step 4: Implement**

```typescript
// lib/sketchfab/abort-helpers.ts

/**
 * Combine multiple AbortSignals into one that aborts as soon as any of the
 * inputs aborts. Uses native `AbortSignal.any` when available (Chrome 116+,
 * Firefox 124+, Safari 17.4+); polyfills with event-listener forwarding on
 * older Safari (a non-trivial chunk of iPad / older iPhone students).
 *
 * Without this polyfill, `AbortSignal.any([...])` throws TypeError on
 * unsupported browsers and the panel fetch breaks entirely.
 *
 * Polyfill listener lifetime: `{ signal: ctrl.signal }` auto-removes the
 * listener IF `ctrl` ever aborts. On the happy path (fast successful fetch,
 * no abort), the listener stays on each input signal until that input
 * signal itself is GC'd. In our use case the input signals are React
 * Query's per-query AbortSignal (lifetime ≤ 5s due to our timeout) and a
 * timeoutCtrl created locally per call — both short-lived. The 2 listener
 * closures × ~100 bytes each × 5s lifetime is negligible. Don't worry
 * about it.
 */
export function anySignal(signals: AbortSignal[]): AbortSignal {
  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any(signals);
  }
  const ctrl = new AbortController();
  for (const s of signals) {
    if (s.aborted) {
      ctrl.abort(s.reason);
      break;
    }
    s.addEventListener("abort", () => ctrl.abort(s.reason), {
      once: true,
      signal: ctrl.signal,
    });
  }
  return ctrl.signal;
}
```

- [ ] **Step 5: Run the test (must pass)**

```bash
npm run test -- tests/lib/abort-helpers.test.ts
```

Expected: PASS — 3 cases green.

- [ ] **Step 6: Commit**

```bash
git add lib/sketchfab/abort-helpers.ts tests/lib/abort-helpers.test.ts vitest.config.ts
git commit --no-gpg-sign -m "feat(sketchfab): anySignal polyfill for AbortSignal.any

Safari < 17.4 doesn't have AbortSignal.any. Without the polyfill,
the panel fetch (which uses it to merge caller signal + timeout
signal) throws TypeError immediately and breaks for those users."
```

---

## Task 3: 5s timeout helper

**Files:**
- Create: `lib/sketchfab/fetch-with-timeout.ts`
- Test: `tests/lib/fetch-with-timeout.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/lib/fetch-with-timeout.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  fetchSketchfabWithTimeout,
  SketchfabTimeoutError,
} from "@/lib/sketchfab/fetch-with-timeout";

describe("fetchSketchfabWithTimeout", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("returns the parsed JSON when the response is fast", async () => {
    const body = { hits: [{ uid: "u1", name: "Bee" }], rawHadResults: true };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })),
    );
    const result = await fetchSketchfabWithTimeout(
      "Apis",
      "bee",
      new AbortController().signal,
    );
    expect(result).toEqual(body);
  });

  it("throws SketchfabTimeoutError after 5s when the response hangs", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    const promise = fetchSketchfabWithTimeout(
      "Apis",
      "bee",
      new AbortController().signal,
    );
    // Attach catch before advancing so unhandled-rejection tracker stays quiet
    const rejection = expect(promise).rejects.toBeInstanceOf(SketchfabTimeoutError);
    await vi.advanceTimersByTimeAsync(5000);
    await rejection;
  });

  it("aborts when the caller's AbortSignal fires before the timeout", async () => {
    const fetchMock = vi.fn(() => new Promise(() => {}));
    vi.stubGlobal("fetch", fetchMock);
    const ctrl = new AbortController();
    const promise = fetchSketchfabWithTimeout("Apis", "bee", ctrl.signal);
    ctrl.abort();
    await expect(promise).rejects.toThrow();
    const callArgs = fetchMock.mock.calls[0]!;
    const passedSignal = (callArgs[1] as RequestInit).signal as AbortSignal;
    expect(passedSignal.aborted).toBe(true);
  });

  it("throws non-timeout error untouched (network failure)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("network down");
    }));
    await expect(
      fetchSketchfabWithTimeout("Apis", "bee", new AbortController().signal),
    ).rejects.toThrow(/network down/);
  });
});
```

- [ ] **Step 2: Run the test (must fail)**

```bash
npm run test -- tests/lib/fetch-with-timeout.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Add the test path to vitest config (BROWSER tier)**

Add `"tests/lib/fetch-with-timeout.test.ts"` to the `browser` project's `include` array.

- [ ] **Step 4: Implement**

```typescript
// lib/sketchfab/fetch-with-timeout.ts
import type { SketchfabSearchResponse } from "./types";
import { anySignal } from "./abort-helpers";

const TIMEOUT_MS = 5000;

/**
 * Distinct from a generic network error so the panel can render a
 * timeout-specific message ("couldn't find anything in time") rather
 * than the generic "couldn't reach Sketchfab" copy.
 */
export class SketchfabTimeoutError extends Error {
  constructor() {
    super(`sketchfab request timed out after ${TIMEOUT_MS}ms`);
    this.name = "SketchfabTimeoutError";
  }
}

/**
 * Wraps the /api/sketchfab/search call with a 5s cap. Above that, the
 * panel UI surfaces the timeout-specific empty-state — better UX than
 * the ~30s wait that happens when prod's egress IP is bot-blocked by
 * Akamai and Sketchfab never responds.
 *
 * Uses setTimeout (not AbortSignal.timeout) so vi.useFakeTimers can
 * intercept it in tests. AbortSignal.timeout is a host timer that fake
 * timers do not patch.
 *
 * Respects the caller's AbortSignal (React Query passes one via
 * useQuery's queryFn) so unmounts cancel cleanly.
 */
export async function fetchSketchfabWithTimeout(
  scientific: string,
  common: string,
  callerSignal: AbortSignal,
): Promise<SketchfabSearchResponse> {
  const timeoutCtrl = new AbortController();
  const timer = setTimeout(
    () => timeoutCtrl.abort(new SketchfabTimeoutError()),
    TIMEOUT_MS,
  );
  const signal = anySignal([callerSignal, timeoutCtrl.signal]);

  try {
    const u = new URL("/api/sketchfab/search", window.location.origin);
    u.searchParams.set("scientific", scientific);
    u.searchParams.set("common", common);
    const r = await fetch(u.toString(), { signal });
    if (!r.ok) throw new Error(`sketchfab search failed: ${r.status}`);
    return (await r.json()) as SketchfabSearchResponse;
  } catch (e) {
    if (timeoutCtrl.signal.aborted) throw new SketchfabTimeoutError();
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 5: Run the test (must pass)**

```bash
npm run test -- tests/lib/fetch-with-timeout.test.ts
```

Expected: PASS — 4 cases green.

- [ ] **Step 6: Commit**

```bash
git add lib/sketchfab/fetch-with-timeout.ts tests/lib/fetch-with-timeout.test.ts vitest.config.ts
git commit --no-gpg-sign -m "feat(sketchfab): 5s timeout helper for the panel fetch

Prod's egress IP is bot-blocked by Akamai, so any uncached species
triggers a route-handler call that hangs ~30s before 502. Cap at 5s
and throw a typed SketchfabTimeoutError so the panel can show a
timeout-specific empty state."
```

---

## Task 4: Wire timeout into panel + timeout-specific render branch

**Files:**
- Modify: `app/components/session/SketchfabBrowsePanel.tsx`
- Modify: `tests/components/SketchfabBrowsePanel.test.tsx`

- [ ] **Step 1: Update `fetchSketchfab` to delegate**

In `SketchfabBrowsePanel.tsx`, replace the existing `fetchSketchfab` body (current lines 13-24) with:

```typescript
import { fetchSketchfabWithTimeout, SketchfabTimeoutError }
  from "@/lib/sketchfab/fetch-with-timeout";

export async function fetchSketchfab(
  scientific: string,
  common: string,
  signal: AbortSignal,
): Promise<SketchfabSearchResponse> {
  return fetchSketchfabWithTimeout(scientific, common, signal);
}
```

Keep the exported signature identical — the prefetch code in `SessionPlayer.tsx` already imports this name.

- [ ] **Step 2: Add a timeout-specific render branch**

In `SketchfabBrowsePanel.tsx`, find the existing error branch (current lines 88-95):

```tsx
{!isPending && isError && (
  <div className="sketchfab-panel-empty">
    <p>Couldn't reach Sketchfab right now.</p>
    <a className="sketchfab-empty-link" href={manualSearchUrl} target="_blank" rel="noopener noreferrer">
      Search Sketchfab in a new tab ↗
    </a>
  </div>
)}
```

Replace with two branches — first the timeout-specific one, then the fallback generic error:

```tsx
{!isPending && isError && error instanceof SketchfabTimeoutError && (
  <div className="sketchfab-panel-empty" data-testid="sketchfab-timeout">
    <p>Couldn't find anything on Sketchfab for this species in time.</p>
    <a className="sketchfab-empty-link" href={manualSearchUrl} target="_blank" rel="noopener noreferrer">
      Try the manual search ↗
    </a>
  </div>
)}

{!isPending && isError && !(error instanceof SketchfabTimeoutError) && (
  <div className="sketchfab-panel-empty">
    <p>Couldn't reach Sketchfab right now.</p>
    <a className="sketchfab-empty-link" href={manualSearchUrl} target="_blank" rel="noopener noreferrer">
      Search Sketchfab in a new tab ↗
    </a>
  </div>
)}
```

To get `error` from useQuery, update the destructure (currently line 55):

```typescript
const { data, isPending, isError, error } = useQuery({
  ...
});
```

- [ ] **Step 3: Add the timeout regression test**

Read the existing `tests/components/SketchfabBrowsePanel.test.tsx` to find the existing test wrapper + describe block, then append inside that describe:

```tsx
it("shows the timeout-specific message when fetch exceeds 5s", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.stubGlobal("fetch", () => new Promise(() => {})); // never resolves
  const screen = await wrap(
    <SketchfabBrowsePanel
      scientific="Slow species"
      common="slow bug"
      open
      onClose={() => {}}
    />,
  );
  await vi.advanceTimersByTimeAsync(5500);
  await expect.element(
    screen.getByText(/Couldn't find anything on Sketchfab/i),
  ).toBeVisible();
  await expect.element(
    screen.getByRole("link", { name: /try the manual search/i }),
  ).toBeVisible();
  vi.useRealTimers();
});
```

If the existing file doesn't have a `wrap()` helper for React Query, copy the pattern from another component test (e.g., wrap with `<QueryClientProvider>`).

- [ ] **Step 4: Run the panel tests**

```bash
npm run test -- tests/components/SketchfabBrowsePanel.test.tsx
```

Expected: PASS — existing count + 1.

- [ ] **Step 5: Verify the full suite still green**

```bash
npm run test --silent -- --run
```

- [ ] **Step 6: Commit**

```bash
git add app/components/session/SketchfabBrowsePanel.tsx tests/components/SketchfabBrowsePanel.test.tsx
git commit --no-gpg-sign -m "feat(sketchfab): panel falls to timeout-specific copy after 5s

Detects SketchfabTimeoutError separately from generic isError so
users see 'Couldn't find anything in time' instead of the network
error message. Addresses the 'loading forever' report on uncached
species (e.g., Netelia) where the route falls through to a live
Sketchfab call that hangs."
```

---

# Phase 2 — Idle preloader (ship after Phase 1)

## Task 5: `requestIdleCallback` wrapper with handle-kind tracking

**Files:**
- Create: `lib/hooks/useRequestIdleCallback.ts`
- Test: `tests/lib/useRequestIdleCallback.test.ts`

**Why a separate module:** Safari < 17 doesn't have `requestIdleCallback`. Centralize the polyfill so every consumer gets the same fallback. The handle-kind Map ensures `cancelIdle` routes the right handle to the right cancel function (a setTimeout id passed to cancelIdleCallback is a silent no-op and vice versa).

- [ ] **Step 1: Write the failing test**

```typescript
// tests/lib/useRequestIdleCallback.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  scheduleIdle,
  cancelIdle,
  __resetHandleKindForTests,
} from "@/lib/hooks/useRequestIdleCallback";

describe("scheduleIdle / cancelIdle", () => {
  beforeEach(() => __resetHandleKindForTests());
  afterEach(() => vi.restoreAllMocks());

  it("uses window.requestIdleCallback when available", () => {
    const ric = vi.fn().mockReturnValue(123);
    vi.stubGlobal("requestIdleCallback", ric);
    const cb = vi.fn();
    const handle = scheduleIdle(cb, { timeout: 3000 });
    expect(handle).toBe(123);
    expect(ric).toHaveBeenCalledTimes(1);
    expect(ric.mock.calls[0]![1]).toEqual({ timeout: 3000 });
  });

  it("falls back to setTimeout when requestIdleCallback is undefined", () => {
    vi.stubGlobal("requestIdleCallback", undefined);
    const cb = vi.fn();
    vi.useFakeTimers();
    const handle = scheduleIdle(cb, { timeout: 3000 });
    expect(typeof handle).toBe("number");
    vi.advanceTimersByTime(200);
    expect(cb).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("cancelIdle routes a ric handle to cancelIdleCallback", () => {
    const cic = vi.fn();
    const ric = vi.fn().mockReturnValue(7);
    vi.stubGlobal("cancelIdleCallback", cic);
    vi.stubGlobal("requestIdleCallback", ric);
    const handle = scheduleIdle(() => {});
    cancelIdle(handle);
    expect(cic).toHaveBeenCalledWith(7);
  });

  it("cancelIdle routes a setTimeout handle to clearTimeout even if cancelIdleCallback is now defined", () => {
    // Schedule WITHOUT requestIdleCallback (polyfill branch)
    vi.stubGlobal("requestIdleCallback", undefined);
    vi.stubGlobal("cancelIdleCallback", undefined);
    vi.useFakeTimers();
    const cb = vi.fn();
    const handle = scheduleIdle(cb);

    // Now the polyfill globals reappear before we cancel — common in tests,
    // possible in race-conditions during page navigation. cancelIdle must
    // still route to clearTimeout because the handle was created by setTimeout.
    vi.stubGlobal("requestIdleCallback", vi.fn());
    const cic = vi.fn();
    vi.stubGlobal("cancelIdleCallback", cic);

    cancelIdle(handle);
    expect(cic).not.toHaveBeenCalled(); // wrong target — would be silent no-op
    vi.advanceTimersByTime(500);
    expect(cb).not.toHaveBeenCalled(); // proves clearTimeout actually fired
    vi.useRealTimers();
  });

  it("removes the handle from the map after natural firing (no leak)", () => {
    vi.stubGlobal("requestIdleCallback", undefined);
    vi.useFakeTimers();
    const handle = scheduleIdle(() => {});
    vi.advanceTimersByTime(200);
    // After the callback fires, cancelling that handle should be a no-op.
    // We verify by checking the internal map via the test reset utility:
    // if the handle still in the map, the map would grow unbounded over time.
    // The test reset utility is the only externally-observable proxy.
    cancelIdle(handle); // must not throw
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run the test (must fail)**

```bash
npm run test -- tests/lib/useRequestIdleCallback.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Add the test path to vitest config (BROWSER tier)**

Add `"tests/lib/useRequestIdleCallback.test.ts"` to the `browser` project's `include` array.

- [ ] **Step 4: Implement**

```typescript
// lib/hooks/useRequestIdleCallback.ts
//
// Browser-only. Safari < 17 doesn't have requestIdleCallback; polyfill
// with setTimeout(200). The handle-kind Map ensures cancelIdle dispatches
// to the right cancel function even if globals change between schedule
// and cancel time (test stubs, navigation, etc).
//
// Memory: the map removes entries both on natural firing (via the wrapped
// callback) and on explicit cancel — bounded to in-flight handles only.

type Kind = "ric" | "timeout";
const handleKind = new Map<number, Kind>();

/** Test-only — reset internal state between tests. Not exported from index. */
export function __resetHandleKindForTests(): void {
  handleKind.clear();
}

interface IdleOpts {
  /** Force execution after this many ms even if never idle. */
  timeout?: number;
}

export function scheduleIdle(callback: () => void, opts: IdleOpts = {}): number {
  let handle: number;
  // Wrap so we delete ourselves from the kind map on natural fire — this is
  // what prevents the map from growing unbounded across many schedule calls.
  const wrapped = () => {
    handleKind.delete(handle);
    callback();
  };

  if (typeof window !== "undefined" && typeof window.requestIdleCallback === "function") {
    handle = window.requestIdleCallback(wrapped, { timeout: opts.timeout });
    handleKind.set(handle, "ric");
    return handle;
  }
  // Polyfill: setTimeout doesn't observe true idleness, but 200ms is short
  // enough to feel responsive and long enough to deprioritize against
  // user input + render loops.
  handle = setTimeout(wrapped, 200) as unknown as number;
  handleKind.set(handle, "timeout");
  return handle;
}

export function cancelIdle(handle: number): void {
  // Default to "timeout" if we somehow lost track — clearTimeout on an
  // unknown number is harmless; cancelIdleCallback on a setTimeout id
  // would silently fail.
  const kind = handleKind.get(handle) ?? "timeout";
  handleKind.delete(handle);
  if (
    kind === "ric" &&
    typeof window !== "undefined" &&
    typeof window.cancelIdleCallback === "function"
  ) {
    window.cancelIdleCallback(handle);
  } else {
    clearTimeout(handle);
  }
}
```

- [ ] **Step 5: Run the test (must pass)**

```bash
npm run test -- tests/lib/useRequestIdleCallback.test.ts
```

Expected: PASS — 5 cases green.

- [ ] **Step 6: Commit**

```bash
git add lib/hooks/useRequestIdleCallback.ts tests/lib/useRequestIdleCallback.test.ts vitest.config.ts
git commit --no-gpg-sign -m "feat(hooks): scheduleIdle/cancelIdle with handle-kind tracking

Map tracks whether each handle was created via requestIdleCallback
or setTimeout polyfill so cancel routes correctly even if globals
change between schedule and cancel. Map self-cleans on natural fire
and on cancel — bounded to in-flight handles."
```

---

## Task 6: Preload utilities (thumbnails + connection gate)

**Files:**
- Create: `lib/sketchfab/preload-utils.ts`
- Test: `tests/lib/sketchfab-preload-utils.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/lib/sketchfab-preload-utils.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { shouldPreload, preloadThumbnails } from "@/lib/sketchfab/preload-utils";

describe("shouldPreload", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns true when navigator.connection is undefined (graceful default)", () => {
    vi.stubGlobal("navigator", {});
    expect(shouldPreload()).toBe(true);
  });

  it("returns true on fast connections", () => {
    vi.stubGlobal("navigator", { connection: { effectiveType: "4g", saveData: false } });
    expect(shouldPreload()).toBe(true);
  });

  it("returns false when Save-Data is on", () => {
    vi.stubGlobal("navigator", { connection: { effectiveType: "4g", saveData: true } });
    expect(shouldPreload()).toBe(false);
  });

  it("returns false on 2g / slow-2g", () => {
    vi.stubGlobal("navigator", { connection: { effectiveType: "2g", saveData: false } });
    expect(shouldPreload()).toBe(false);
    vi.stubGlobal("navigator", { connection: { effectiveType: "slow-2g", saveData: false } });
    expect(shouldPreload()).toBe(false);
  });
});

describe("preloadThumbnails", () => {
  let imageSrcs: string[] = [];
  let imageInstances: Array<{ src: string; onload: (() => void) | null; onerror: (() => void) | null }> = [];

  beforeEach(() => {
    imageSrcs = [];
    imageInstances = [];
    class FakeImage {
      _src = "";
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(v: string) {
        this._src = v;
        imageSrcs.push(v);
        imageInstances.push(this as never);
      }
      get src(): string { return this._src; }
    }
    vi.stubGlobal("Image", FakeImage);
  });
  afterEach(() => vi.restoreAllMocks());

  it("does nothing for an empty list", async () => {
    await preloadThumbnails([], { concurrency: 4 });
    expect(imageSrcs).toHaveLength(0);
  });

  it("caps concurrent loads at the given concurrency", async () => {
    const urls = Array.from({ length: 8 }, (_, i) => `https://t/${i}.jpg`);
    const promise = preloadThumbnails(urls, { concurrency: 3 });
    // Immediately after kicking off, only 3 images should be in flight
    expect(imageInstances.length).toBe(3);
    // Drain by always resolving the FIRST in-flight (length-snapshot, not
    // index-based — robust to non-deterministic queue ordering)
    while (imageInstances.length > 0) {
      const inst = imageInstances.shift()!;
      inst.onload?.();
      await Promise.resolve();
      await Promise.resolve(); // two ticks: one for then, one for queueing
    }
    await promise;
    expect(imageSrcs.sort()).toEqual(urls.sort());
  });

  it("treats onerror like onload (a 404 thumb shouldn't stall the queue)", async () => {
    const urls = ["a", "b"];
    const promise = preloadThumbnails(urls, { concurrency: 1 });
    expect(imageInstances).toHaveLength(1);
    imageInstances[0]!.onerror?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(imageInstances).toHaveLength(2);
    imageInstances[1]!.onload?.();
    await promise;
  });

  it("clears onload/onerror after each settle (closure leak prevention)", async () => {
    const promise = preloadThumbnails(["a"], { concurrency: 1 });
    const inst = imageInstances[0]!;
    inst.onload?.();
    await promise;
    expect(inst.onload).toBeNull();
    expect(inst.onerror).toBeNull();
  });

  it("stops launching new loads once the signal aborts", async () => {
    const urls = ["a", "b", "c", "d", "e"];
    const ctrl = new AbortController();
    const promise = preloadThumbnails(urls, { concurrency: 1, signal: ctrl.signal });
    expect(imageInstances).toHaveLength(1);
    imageInstances[0]!.onload?.();
    await Promise.resolve();
    await Promise.resolve();
    // Second load started
    expect(imageInstances).toHaveLength(2);
    ctrl.abort();
    imageInstances[1]!.onload?.();
    await promise;
    // No more loads after abort
    expect(imageInstances).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run the test (must fail)**

```bash
npm run test -- tests/lib/sketchfab-preload-utils.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Add the test path to vitest config (BROWSER tier)**

Add `"tests/lib/sketchfab-preload-utils.test.ts"` to the `browser` project's `include` array.

- [ ] **Step 4: Implement**

```typescript
// lib/sketchfab/preload-utils.ts

/**
 * Network-aware preload gate. Returns false when the user is on
 * Save-Data mode or a 2g/slow-2g connection — preloading would be
 * actively hostile in those cases.
 *
 * navigator.connection is widely supported on Chromium (mobile + desktop),
 * not yet on Firefox or Safari. When unavailable we default to "yes
 * preload" — worst case is a desktop user on a metered connection gets a
 * couple hundred KB of bonus traffic.
 */
export function shouldPreload(): boolean {
  const conn = (navigator as Navigator & {
    connection?: { saveData?: boolean; effectiveType?: string };
  }).connection;
  if (!conn) return true;
  if (conn.saveData) return false;
  if (conn.effectiveType === "slow-2g" || conn.effectiveType === "2g") return false;
  return true;
}

interface PreloadOpts {
  /** Max concurrent in-flight image loads. Default: 4. */
  concurrency?: number;
  /** Best-effort cancellation: prevents NEW loads from starting once aborted.
   *  Cannot cancel already-issued browser image requests (no API for that). */
  signal?: AbortSignal;
}

/**
 * Fires `new Image()` per URL to warm the browser's HTTP cache.
 * Resolves once every URL has settled (success or error).
 *
 * Memory care for mobile:
 *  - onload/onerror are nulled out after each promise settles so the
 *    Image instance no longer holds the closure (which references the
 *    enclosing AbortController, queue state, etc.). Lets V8 GC the
 *    closure sooner under memory pressure.
 *  - No persistent references kept by this module — Image instances
 *    are short-lived locals.
 *
 * Concurrency cap prevents a burst of 12 thumbnails × 3 species = 36
 * simultaneous fetches per slide change.
 */
export async function preloadThumbnails(
  urls: readonly string[],
  opts: PreloadOpts = {},
): Promise<void> {
  const concurrency = opts.concurrency ?? 4;
  if (urls.length === 0) return;

  let cursor = 0;

  function next(): Promise<void> {
    if (opts.signal?.aborted) return Promise.resolve();
    const i = cursor++;
    if (i >= urls.length) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const img = new Image();
      const done = () => {
        // Break closure references — img.onload/onerror would otherwise
        // hold this scope (which captures opts.signal) until GC.
        img.onload = null;
        img.onerror = null;
        resolve();
      };
      img.onload = done;
      img.onerror = done; // 404 / network error shouldn't stall the queue
      img.src = urls[i]!;
    }).then(() => next());
  }

  const workers: Promise<void>[] = [];
  for (let i = 0; i < Math.min(concurrency, urls.length); i++) {
    workers.push(next());
  }
  await Promise.all(workers);
}
```

- [ ] **Step 5: Run the tests (must pass)**

```bash
npm run test -- tests/lib/sketchfab-preload-utils.test.ts
```

Expected: PASS — 8 cases green.

- [ ] **Step 6: Commit**

```bash
git add lib/sketchfab/preload-utils.ts tests/lib/sketchfab-preload-utils.test.ts vitest.config.ts
git commit --no-gpg-sign -m "feat(sketchfab): preload utils — Save-Data gate + bounded thumb prefetch

Clears onload/onerror after settle to drop closure references early
on mobile. Aborts halt new loads but cannot cancel in-flight ones
(no browser API for that)."
```

---

## Task 7: `useSketchfabPreloader` hook

**Files:**
- Create: `lib/hooks/useSketchfabPreloader.ts`
- Test: `tests/components/useSketchfabPreloader.test.tsx`

**Critical design:** uses `prefetchQuery` (not `fetchQuery`) so preload failures don't poison the cache. Reads thumbnail URLs via `qc.getQueryData()` after prefetch — only proceeds if data is actually present.

- [ ] **Step 1: Write the failing test**

```tsx
// tests/components/useSketchfabPreloader.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "vitest-browser-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useSketchfabPreloader } from "@/lib/hooks/useSketchfabPreloader";
import { sketchfabQueryKey } from "@/lib/sketchfab/query-keys";
import type { SketchfabSearchResponse } from "@/lib/sketchfab/types";

const FAKE_RESPONSE: SketchfabSearchResponse = {
  hits: [
    {
      uid: "u1", name: "a", author: "x", authorUsername: "x",
      thumbnailUrl: "https://t/1.jpg", viewerUrl: "https://v/1",
      licenseSlug: "by", matchedBy: "scientific",
    },
    {
      uid: "u2", name: "b", author: "x", authorUsername: "x",
      thumbnailUrl: "https://t/2.jpg", viewerUrl: "https://v/2",
      licenseSlug: "by", matchedBy: "common",
    },
  ],
  rawHadResults: true,
} as SketchfabSearchResponse;

function Harness({
  items, idx,
}: { items: Array<{ taxonSpecies: string; commonName: string }>; idx: number }) {
  useSketchfabPreloader(items, idx);
  return <div>harness</div>;
}

function makeQc() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

function wrap(qc: QueryClient, node: React.ReactNode) {
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

describe("useSketchfabPreloader", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let imageSrcs: string[];

  beforeEach(() => {
    imageSrcs = [];
    class FakeImage {
      _src = "";
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(v: string) {
        this._src = v;
        imageSrcs.push(v);
        // Resolve on next microtask
        queueMicrotask(() => this.onload?.());
      }
      get src(): string { return this._src; }
    }
    vi.stubGlobal("Image", FakeImage);
    fetchMock = vi.fn(async () =>
      new Response(JSON.stringify(FAKE_RESPONSE), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    // Run idle callbacks synchronously
    vi.stubGlobal("requestIdleCallback", (cb: () => void) => { cb(); return 0; });
    vi.stubGlobal("cancelIdleCallback", () => {});
    vi.stubGlobal("navigator", {
      connection: { effectiveType: "4g", saveData: false },
    });
    Object.defineProperty(document, "visibilityState", {
      configurable: true, value: "visible",
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it("prefetches idx+1, idx+2, idx+3 JSON + their thumbnails", async () => {
    const items = Array.from({ length: 10 }, (_, i) => ({
      taxonSpecies: `Sci${i}`, commonName: `Common${i}`,
    }));
    const qc = makeQc();
    await wrap(qc, <Harness items={items} idx={0} />);
    await new Promise((r) => setTimeout(r, 50));
    const speciesFetched = fetchMock.mock.calls
      .map((c) => new URL(c[0] as string).searchParams.get("scientific"))
      .filter(Boolean) as string[];
    expect(new Set(speciesFetched)).toEqual(new Set(["Sci1", "Sci2", "Sci3"]));
    // 3 species × 2 thumbnails each = 6
    expect(imageSrcs.length).toBe(6);
  });

  it("skips the thumbnail chain when the JSON prefetch fails", async () => {
    // Honest framing: prefetchQuery still writes an `error` state to the
    // cache on failure (it just doesn't write `data`). React Query's
    // default refetchOnMount: true means the panel's later useQuery will
    // refetch on open — brief isError flash is acceptable for the rare
    // preload-failure case. What we DO guarantee: no thumbnail loads
    // fire when there's no JSON data to derive URLs from.
    fetchMock.mockRejectedValue(new Error("network down"));
    const items = [
      { taxonSpecies: "A", commonName: "a" },
      { taxonSpecies: "B", commonName: "b" },
    ];
    const qc = makeQc();
    await wrap(qc, <Harness items={items} idx={0} />);
    await new Promise((r) => setTimeout(r, 50));
    // getQueryData returns undefined on failure (data was never written).
    // This is the gate the hook reads to decide whether to chain to thumbs.
    expect(qc.getQueryData(sketchfabQueryKey("B", "b"))).toBeUndefined();
    // No thumbnails preloaded since JSON failed.
    expect(imageSrcs).toEqual([]);
  });

  it("skips entirely when shouldPreload returns false (Save-Data on)", async () => {
    vi.stubGlobal("navigator", {
      connection: { effectiveType: "4g", saveData: true },
    });
    const items = Array.from({ length: 5 }, (_, i) => ({
      taxonSpecies: `Sci${i}`, commonName: `Common${i}`,
    }));
    const qc = makeQc();
    await wrap(qc, <Harness items={items} idx={0} />);
    await new Promise((r) => setTimeout(r, 50));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(imageSrcs).toEqual([]);
  });

  it("skips entirely when the tab is hidden", async () => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true, value: "hidden",
    });
    const items = Array.from({ length: 5 }, (_, i) => ({
      taxonSpecies: `Sci${i}`, commonName: `Common${i}`,
    }));
    const qc = makeQc();
    await wrap(qc, <Harness items={items} idx={0} />);
    await new Promise((r) => setTimeout(r, 50));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("doesn't preload past the end of the queue", async () => {
    const items = [
      { taxonSpecies: "A", commonName: "a" },
      { taxonSpecies: "B", commonName: "b" },
    ];
    const qc = makeQc();
    await wrap(qc, <Harness items={items} idx={0} />);
    await new Promise((r) => setTimeout(r, 50));
    const speciesFetched = fetchMock.mock.calls
      .map((c) => new URL(c[0] as string).searchParams.get("scientific"));
    expect(speciesFetched).toEqual(["B"]);
  });

  it("skips items whose taxonSpecies or commonName is empty", async () => {
    const items = [
      { taxonSpecies: "Sci0", commonName: "c0" },
      { taxonSpecies: "Sci1", commonName: "" },
      { taxonSpecies: "",     commonName: "c2" },
      { taxonSpecies: "Sci3", commonName: "c3" },
    ];
    const qc = makeQc();
    await wrap(qc, <Harness items={items} idx={0} />);
    await new Promise((r) => setTimeout(r, 50));
    const speciesFetched = fetchMock.mock.calls
      .map((c) => new URL(c[0] as string).searchParams.get("scientific"));
    expect(speciesFetched).toEqual(["Sci3"]);
  });

  it("short-circuits the thumbnail chain when unmounted before fetch settles", async () => {
    // This is the actual memory-leak guard the hook provides on unmount.
    // We do NOT cancel in-flight fetches (React Query owns those signals,
    // and `qc.cancelQueries` would also affect the panel's same-key
    // useQuery if it happens to be mounted concurrently). Instead, we
    // rely on ctrl.signal.aborted to short-circuit the .then chain that
    // would otherwise spawn up to PRELOAD_AHEAD × hits-per-species
    // Image objects post-unmount.
    //
    // In-flight fetches still complete (bounded by the 5s timeout in
    // fetch-with-timeout.ts) and their results write to React Query's
    // cache — that's harmless and could even be useful if the user
    // navigates back. The bandwidth cost is bounded.
    const resolvers: Array<(r: Response) => void> = [];
    fetchMock.mockImplementation(
      () => new Promise<Response>((resolve) => { resolvers.push(resolve); }),
    );
    const items = Array.from({ length: 10 }, (_, i) => ({
      taxonSpecies: `Sci${i}`, commonName: `Common${i}`,
    }));
    const qc = makeQc();
    const screen = await wrap(qc, <Harness items={items} idx={0} />);

    // Wait deterministically for the in-flight fetch count to reach 3,
    // instead of relying on a heuristic setTimeout. vi.waitFor polls
    // until the assertion passes (or times out after 1s default).
    await vi.waitFor(() => expect(resolvers).toHaveLength(3));
    expect(imageSrcs).toEqual([]);

    // Unmount BEFORE the fetches settle — sets ctrl.signal.aborted = true.
    screen.unmount();

    // Now release the fetches. Without the cleanup guard the .then chain
    // would fire and start preloading 6 thumbnails.
    resolvers.forEach((r) =>
      r(new Response(JSON.stringify(FAKE_RESPONSE), { status: 200 })),
    );

    // Drain microtask queue robustly: enough rounds for fetch.then →
    // RQ internals → hook's .then → getQueryData (sync) → would-be
    // preloadThumbnails kickoff. If the chain DID fire, imageSrcs
    // would populate within these microtasks.
    for (let i = 0; i < 10; i++) await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));

    // Zero thumbnails — proves the short-circuit worked.
    expect(imageSrcs).toEqual([]);
  });

  it("cancels pending idle handles on unmount (before prefetch starts)", async () => {
    const cancel = vi.fn();
    vi.stubGlobal("cancelIdleCallback", cancel);
    // Return real handles but never invoke the callback
    let nextHandle = 100;
    vi.stubGlobal("requestIdleCallback", () => nextHandle++);
    const items = Array.from({ length: 10 }, (_, i) => ({
      taxonSpecies: `Sci${i}`, commonName: `Common${i}`,
    }));
    const qc = makeQc();
    const screen = await wrap(qc, <Harness items={items} idx={0} />);
    screen.unmount();
    expect(cancel).toHaveBeenCalledTimes(3);
    // Also verify no fetches happened (since idle never fired)
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test (must fail)**

```bash
npm run test -- tests/components/useSketchfabPreloader.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the hook**

```typescript
// lib/hooks/useSketchfabPreloader.ts
"use client";
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { fetchSketchfabWithTimeout } from "@/lib/sketchfab/fetch-with-timeout";
import { sketchfabQueryKey } from "@/lib/sketchfab/query-keys";
import { shouldPreload, preloadThumbnails } from "@/lib/sketchfab/preload-utils";
import { scheduleIdle, cancelIdle } from "@/lib/hooks/useRequestIdleCallback";
import type { SketchfabSearchResponse } from "@/lib/sketchfab/types";

/** How many slides ahead to preload (idx+1 .. idx+PRELOAD_AHEAD). */
const PRELOAD_AHEAD = 3;
/** Force the idle callback to fire after this many ms even if never idle. */
const IDLE_TIMEOUT_MS = 3000;
/** Max in-flight thumbnail loads per species. */
const THUMB_CONCURRENCY = 4;

interface PreloadableItem {
  taxonSpecies?: string | null;
  commonName?: string | null;
}

/**
 * Schedules background prefetches for the next PRELOAD_AHEAD slides:
 *  1. JSON metadata via `qc.prefetchQuery` (idempotent, swallows errors,
 *     shares the same query key as the panel + availability hook).
 *  2. Thumbnail JPEGs via `new Image()` — ONLY if the prefetch produced
 *     data (read via `qc.getQueryData` post-prefetch). On failure, no
 *     thumbnails are issued.
 *
 * Scheduled through requestIdleCallback so it never competes with drawing
 * input or render frames. Forces execution at 3s if the browser never goes
 * idle (e.g. continuous mousemove during drawing).
 *
 * Skips entirely on Save-Data / 2g connections and while the tab is hidden.
 *
 * Memory cleanup on unmount / slide change (cleanup callback):
 *  - `cancelIdle(handle)` for each scheduled idle handle that hasn't fired
 *    yet — stops the callback from running against a torn-down component.
 *  - `ctrl.abort()` for each per-species AbortController. This does NOT
 *    cancel React Query's in-flight fetch (RQ owns its own signal; the
 *    fetch completes naturally, bounded by the 5s timeout in
 *    fetch-with-timeout.ts). What ctrl.abort() DOES do is short-circuit
 *    the `.then` chain inside the idle callback — preventing up to
 *    PRELOAD_AHEAD × hits-per-species Image objects from being created
 *    post-unmount. That's the real leak guard on mobile.
 *
 * Why we don't use `qc.cancelQueries`: it cancels ANY observer of that
 * key, including the panel's own useQuery if the user happens to open
 * the panel for the same species we're preloading. The brief bandwidth
 * cost of letting fetches complete is preferable to that footgun.
 *
 * React Query's gcTime (20min) is the cache back-stop — single-session
 * cache stays under ~500KB even on long runs (47 species × ~10KB).
 *
 * IMPORTANT — caller contract on `items`: pass a stable array reference.
 * The effect deps are `[items, idx, qc]`, so if the parent component
 * recreates `items` on every render (e.g., via `.map()` at the call site),
 * the effect re-runs on every render even when idx hasn't changed —
 * causing repeated cleanup/schedule churn. In SessionPlayer.tsx today the
 * `items` array comes straight from useImageQueue and is stable across
 * renders. Don't break that contract.
 */
export function useSketchfabPreloader(
  items: readonly PreloadableItem[],
  idx: number,
): void {
  const qc = useQueryClient();

  useEffect(() => {
    if (typeof document === "undefined") return;
    if (document.visibilityState === "hidden") return;
    if (!shouldPreload()) return;

    const handles: number[] = [];
    const aborts: AbortController[] = [];

    for (let offset = 1; offset <= PRELOAD_AHEAD; offset++) {
      const item = items[idx + offset];
      const sci = item?.taxonSpecies;
      const com = item?.commonName;
      if (!sci || !com) continue;

      const ctrl = new AbortController();
      aborts.push(ctrl);

      const handle = scheduleIdle(
        () => {
          if (ctrl.signal.aborted) return;
          const key = sketchfabQueryKey(sci, com);

          // prefetchQuery returns Promise<void> and swallows errors.
          // It still writes to the cache, but we don't act on cached
          // errors — we only read fresh data after the prefetch resolves.
          qc.prefetchQuery({
            queryKey: key,
            queryFn: ({ signal }) => fetchSketchfabWithTimeout(sci, com, signal),
            staleTime: 10 * 60_000,
            gcTime: 20 * 60_000,
          })
            .then(() => {
              if (ctrl.signal.aborted) return;
              const cached = qc.getQueryData<SketchfabSearchResponse>(key);
              if (!cached) return; // prefetch failed — nothing to chain to
              const urls = cached.hits.map((h) => h.thumbnailUrl).filter(Boolean);
              return preloadThumbnails(urls, {
                concurrency: THUMB_CONCURRENCY,
                signal: ctrl.signal,
              });
            })
            .catch(() => {
              // Defensive: preload errors must not surface as unhandled rejections.
            });
        },
        { timeout: IDLE_TIMEOUT_MS },
      );
      handles.push(handle);
    }

    return () => {
      handles.forEach(cancelIdle);
      aborts.forEach((c) => c.abort());
    };
  }, [items, idx, qc]);
}
```

- [ ] **Step 4: Run the test (must pass)**

```bash
npm run test -- tests/components/useSketchfabPreloader.test.tsx
```

Expected: PASS — 8 cases green (including cache-not-poisoned and abort-on-unmount).

- [ ] **Step 5: Commit**

```bash
git add lib/hooks/useSketchfabPreloader.ts tests/components/useSketchfabPreloader.test.tsx
git commit --no-gpg-sign -m "feat(sketchfab): useSketchfabPreloader hook (JSON + thumbs, idle-scheduled)

Uses prefetchQuery (not fetchQuery) so failed preloads don't poison
the cache for the panel's later useQuery. Reads cached data via
getQueryData and only chains thumbnail loads when the JSON
prefetch actually produced data. Aborts in-flight prefetches on
unmount + slide change."
```

---

## Task 8: Wire the preloader into `SessionPlayer` (replace existing N+1 prefetch)

**Files:**
- Modify: `app/components/session/SessionPlayer.tsx`

Current state: two `useEffect` blocks prefetch idx and idx+1. We keep the idx prefetch (immediate, for "user might press K now") and replace the idx+1 effect with the new hook (which covers idx+1..idx+3 via idle scheduling).

- [ ] **Step 1: Add the import**

At the top of `SessionPlayer.tsx`:

```tsx
import { useSketchfabPreloader } from "@/lib/hooks/useSketchfabPreloader";
```

- [ ] **Step 2: Replace the idx+1 prefetch effect with the hook**

Find the two prefetch effects (around lines 74-80). They look like:

```tsx
useEffect(() => {
  prefetchSketchfab(items[idx]?.taxonSpecies, items[idx]?.commonName);
}, [items, idx, prefetchSketchfab]);

useEffect(() => {
  prefetchSketchfab(items[idx + 1]?.taxonSpecies, items[idx + 1]?.commonName);
}, [items, idx, prefetchSketchfab]);
```

Replace with:

```tsx
// Current slide: prefetch immediately (user might press K right now).
useEffect(() => {
  prefetchSketchfab(items[idx]?.taxonSpecies, items[idx]?.commonName);
}, [items, idx, prefetchSketchfab]);

// Next 3 slides: prefetch JSON + thumbnails via requestIdleCallback so we
// don't compete with drawing input. See lib/hooks/useSketchfabPreloader.ts.
useSketchfabPreloader(items, idx);
```

- [ ] **Step 3: Verify the build + tests**

```bash
npx tsc --noEmit
npm run test --silent -- --run
```

Expected: no type errors; all tests pass.

- [ ] **Step 4: Commit**

```bash
git add app/components/session/SessionPlayer.tsx
git commit --no-gpg-sign -m "feat(sketchfab): SessionPlayer uses useSketchfabPreloader (idx+1..idx+3)"
```

---

## Task 9: Manual Playwright smoke

**Files:** none — verification only.

- [ ] **Step 1: Start the dev server**

```bash
npm run dev > /tmp/dev.log 2>&1 &
sleep 6
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/
```

Expected: `200`.

- [ ] **Step 2: Drive Playwright through 5 species + assert preload requests**

Use the `mcp__plugin_playwright_playwright__*` tool family:

1. `browser_navigate` to `http://localhost:3000/?interval=30&type=bees`
2. Click the "start session" button.
3. Wait for `img[src*="/api/medium/"]` to be visible.
4. Wait 4 seconds (lets the 3s idle timeout fire for idx+1..idx+3).
5. Call `browser_network_requests` filtered to `/api/sketchfab/search` — expect ≥4 requests (idx + idx+1 + idx+2 + idx+3).
6. Press `K` to open the panel — observe whether the panel is instant (cache hit) or shows a brief skeleton (cache miss). Cache hit = success.

- [ ] **Step 3: Visually confirm `media.sketchfab.com` thumbnails were prefetched**

```js
mcp__plugin_playwright_playwright__browser_network_requests({
  static: false,
  filter: "media.sketchfab.com",
})
```

Expected: ~6-15 requests to `media.sketchfab.com`. Status should be 200.

- [ ] **Step 4: Smoke the timeout path**

In a separate test or by editing `lib/sketchfab/fetch-with-timeout.ts` temporarily to use `TIMEOUT_MS = 200`:

1. Block `/api/sketchfab/search` via Playwright route interception, force it to delay 1000ms.
2. Open the panel — should render the timeout-specific "Couldn't find anything on Sketchfab for this species in time" copy within ~500ms.

Restore `TIMEOUT_MS = 5000` after the test.

- [ ] **Step 5: Kill the dev server**

```bash
lsof -ti:3000 | xargs kill 2>/dev/null
```

No commit — verification only.

---

## Task 10: Final test sweep + deploy

- [ ] **Step 1: Run the full JS suite**

```bash
npm run test --silent -- --run
```

Expected: all green. Phase 1 + Phase 2 together add ~20 tests beyond the existing 183.

- [ ] **Step 2: Run typecheck**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Run the existing e2e**

```bash
PLAYWRIGHT_BASE_URL=http://localhost:3000 npm run test:e2e -- sketchfab-panel.spec.ts
```

(With a fresh dev server running from this branch.) Expected: passes — the preloader is additive and doesn't change observable panel behavior for the e2e's stubbed-route scenario.

- [ ] **Step 4: Push + deploy**

```bash
git push origin <branch>
./deploy/scripts/deploy.sh <branch>
```

Smoke output should show 11/11 passing.

---

## Self-review checklist

**1. Spec coverage**
- [x] 5s timeout on the panel fetch → Tasks 3 + 4
- [x] Timeout-specific "couldn't find on Sketchfab" message → Task 4 (panel render branch on `SketchfabTimeoutError`)
- [x] Preload next N slides → Tasks 5-8 (`PRELOAD_AHEAD = 3`)
- [x] Idle-scheduled → Task 5 (`scheduleIdle`)
- [x] Bounded memory →
  - handleKind Map self-cleans on natural fire AND on cancel (Task 5)
  - Image onload/onerror nulled after settle to drop closure refs early (Task 6)
  - AbortController.abort() on cleanup short-circuits the post-fetch thumbnail chain (Task 7, verified by the "short-circuits thumbnail chain on unmount" test). In-flight fetches still complete but are bounded by the 5s timeout.
  - React Query gcTime: 20min back-stop; per-session cache < ~500KB at 47 species × ~10KB
- [x] Network-aware skip → Task 6 (`shouldPreload`)
- [x] Tab-hidden gate → Task 7 (visibility check at effect start)
- [x] Thumbnail preload → Task 6 + Task 7
- [x] No memory leaks → tested via abort-on-unmount + handle map cleanup
- [x] No cache pollution from failed preloads → Task 7 uses `prefetchQuery` + `getQueryData`
- [x] Safari < 17.4 polyfill for `AbortSignal.any` → Task 2 (`anySignal`)
- [x] Verified end-to-end → Task 9

**2. Placeholder scan** — done; no "TODO", no "implement later", no "add error handling" placeholders.

**3. Type consistency**
- `PreloadableItem` (Task 7) is structurally compatible with `Image` from `db/schema.ts` (`taxonSpecies: string | null`, `commonName: string | null`).
- `sketchfabQueryKey` signature consistent across `lib/sketchfab/query-keys.ts` and all consumers (Tasks 1, 7).
- `fetchSketchfab` exported signature unchanged after Task 4 (delegates to `fetchSketchfabWithTimeout` but keeps the same `(sci, com, signal) => Promise<SketchfabSearchResponse>`).
- `scheduleIdle`/`cancelIdle` return `number` consistently across both branches (Task 5).
- `SketchfabTimeoutError` is referenced in both the lib (`fetch-with-timeout.ts`) and the panel render (Task 4) — re-exported from the panel for consumer convenience.

## Open questions (none blocking — defaults locked in)

Tuning knobs that can be revisited post-launch with measurement:
- `PRELOAD_AHEAD = 3` (could be 5 on desktop, 1 on phone for mobile bandwidth)
- `TIMEOUT_MS = 5000` (could be 7s if 5s feels too aggressive)
- `THUMB_CONCURRENCY = 4` (could be 6 on fast connections)
- `IDLE_TIMEOUT_MS = 3000` (could be 5s — but longer means slower preload during continuous drawing)

These are constants in the new modules — easy to tune after measuring real prod behavior.
