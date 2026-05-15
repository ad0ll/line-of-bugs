import type { Image } from "@/db/schema";

interface Pool {
  items: Image[];
  createdAt: number;
}

// Hoist to globalThis so the route handler + RSC share state even when
// Turbopack bundles them into separate module instances.
const g = globalThis as typeof globalThis & {
  __lineOfBugsPools?: Map<string, Pool>;
};
const POOLS: Map<string, Pool> = g.__lineOfBugsPools ?? new Map();
g.__lineOfBugsPools = POOLS;

const POOL_TTL_MS = 60 * 60 * 1000; // 1 hour

export function setPool(sessionId: string, items: Image[]): void {
  POOLS.set(sessionId, { items, createdAt: Date.now() });
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

// Start a periodic sweeper (only in production / dev — not in tests)
if (typeof process !== "undefined" && process.env.NODE_ENV !== "test") {
  setInterval(sweepExpired, 5 * 60 * 1000).unref?.();
}
