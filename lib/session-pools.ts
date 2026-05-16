import type { Image } from "@/db/schema";

interface Pool {
  items: Image[];
  createdAt: number;
}

// Hoist to globalThis so the route handler + RSC share state even when
// Turbopack bundles them into separate module instances.
const g = globalThis as typeof globalThis & {
  __lineOfBugsPools?: Map<string, Pool>;
  __lineOfBugsSweeperStarted?: boolean;
};
const POOLS: Map<string, Pool> = g.__lineOfBugsPools ?? new Map();
g.__lineOfBugsPools = POOLS;

const POOL_TTL_MS = 60 * 60 * 1000; // 1 hour
const MAX_POOLS = 500;

/**
 * Store a pool keyed by sessionId. Returns true on success, false when
 * the server is at capacity even after sweeping expired entries — the
 * caller should surface a 503 in that case.
 */
export function setPool(sessionId: string, items: Image[]): boolean {
  if (POOLS.size >= MAX_POOLS) {
    // Try to free up capacity by sweeping expired pools first.
    sweepExpired();
    if (POOLS.size >= MAX_POOLS) {
      return false;
    }
  }
  POOLS.set(sessionId, { items, createdAt: Date.now() });
  return true;
}

export function getPool(sessionId: string): Pool | undefined {
  return POOLS.get(sessionId);
}

export function sweepExpired(): void {
  const cutoff = Date.now() - POOL_TTL_MS;
  for (const [id, pool] of POOLS) {
    if (pool.createdAt < cutoff) POOLS.delete(id);
  }
}

// Test helper
export function _clearAll(): void {
  POOLS.clear();
}

// Start a periodic sweeper (only in production / dev — not in tests).
// Guard against duplicate intervals on HMR / re-import: Turbopack will
// re-evaluate this module several times in dev and the sweeper would
// otherwise stack up.
if (
  typeof process !== "undefined" &&
  process.env.NODE_ENV !== "test" &&
  !g.__lineOfBugsSweeperStarted
) {
  g.__lineOfBugsSweeperStarted = true;
  setInterval(sweepExpired, 5 * 60 * 1000).unref?.();
}
