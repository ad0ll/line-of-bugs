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
