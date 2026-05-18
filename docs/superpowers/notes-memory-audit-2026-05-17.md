# Memory audit — Phase F (2026-05-17)

Read-only review of long-lived in-memory state. No code changes needed
in Phase F; findings recorded here so future work can revisit if
profiling surfaces a leak.

## `lib/preload-manager.ts` — client-side Image() cache

- LRU capped at `LRU_MAX = 8` entries via `order[]` array; oldest entry
  evicted from both `order` and `entries` map on insert past the cap.
- Eviction also drops the only ref to the `HTMLImageElement`, so the
  browser is free to GC the underlying decoded bitmap (subject to the
  HTTP image cache, which is browser-managed and bounded).
- Forward window = 3, backward window = 1. Sliding the window past an
  index reduces the LRU recency of out-of-window entries, eventually
  flushing them.
- `setQueue` resets `queue` but not `entries` — this is intentional so
  ArrowLeft after a queue swap doesn't re-fetch already-decoded images.
  Stale entries naturally drain via LRU as new previews come in.

**Verdict:** bounded. 8 × ~1.5 MB peak decoded medium tier ≈ 12 MB —
within typical browser memory budget. No leak.

## `lib/session-pools.ts` — server-side session pool map

- Module-level `POOLS: Map<string, Pool>` hoisted to `globalThis` so
  Turbopack module duplication doesn't shard state across route handler
  + RSC.
- `POOL_TTL_MS = 1h`, `MAX_POOLS = 500`.
- `setPool` runs `sweepExpired()` first when at capacity, then refuses
  with `false` if still full (caller surfaces 503).
- Periodic `sweepExpired` runs every 5 min via `setInterval` (guarded
  against HMR re-import via `g.__lineOfBugsSweeperStarted`).
- Bug constraints: 500 pools × ~500 images × ~1KB Image row (raw_metadata
  stripped by `IMAGE_COLS_NO_RAW`) ≈ 250 MB worst case. Well within
  Hetzner VPS limits.

**Verdict:** bounded. TTL + max-pools both enforced, sweeper runs
periodically. No leak.

## Browser image HTTP cache

`next/image` and the plain `<img>` we adopted in Phase F both rely on
the browser HTTP cache. Memory usage stays bounded by the browser's
cache eviction policy (per-origin LRU). No app-level concern.

## Follow-ups (not blocking)

None identified. If long-session profiling later shows growth, the
likely culprits are:

1. `useSketchfabPreloader` — verify it has its own bounded queue.
2. `audioRef` lingering after session end — currently nulled by GC when
   `SessionPlayer` unmounts via `router.push("/")`.
3. React Query cache for Sketchfab fetches — `gcTime: 20 * 60_000` so
   entries expire on their own.
