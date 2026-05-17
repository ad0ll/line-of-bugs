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
