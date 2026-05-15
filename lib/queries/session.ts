import { cache } from "react";
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { applyRepeatMode, type RepeatMode } from "@/lib/repeat-mode";
import type { Image } from "@/db/schema";
import { buildFilterClauses, type FilterState } from "@/lib/queries/filter-clauses";

export type SessionFilters = FilterState;

export interface BuildSessionPoolOpts extends SessionFilters {
  repeatMode: RepeatMode;
  limit?: number;
}

/**
 * Build a randomized image queue for a session.
 * Not cached — each call returns a fresh shuffle.
 * Excludes hidden images and any image with an unresolved report.
 */
export async function buildSessionPool(
  opts: BuildSessionPoolOpts,
): Promise<Image[]> {
  const conditions = buildFilterClauses(opts);
  const all = await db
    .select()
    .from(schema.images)
    .where(and(...conditions))
    .orderBy(sql`RANDOM()`)
    .limit(opts.limit ?? 500);

  return applyRepeatMode(all, opts.repeatMode);
}

/**
 * Count how many images would be eligible for a session given the
 * current filter selection. Used by the home page to show a live
 * "X images in your session pool" indicator before the user starts.
 */
export async function countSessionPool(opts: SessionFilters): Promise<number> {
  const conditions = buildFilterClauses(opts);
  const result = await db
    .select({ c: sql<number>`COUNT(*)` })
    .from(schema.images)
    .where(and(...conditions))
    .get();
  return result?.c ?? 0;
}

// Enforces the same visibility predicate as buildSessionPool — a hidden image
// or one with an unresolved report should not be reachable even by direct
// imageId lookup (e.g., bookmarked session URL).
export const getImage = cache(async (imageId: string) => {
  return db
    .select()
    .from(schema.images)
    .where(
      and(
        eq(schema.images.imageId, imageId),
        eq(schema.images.hidden, false),
        sql`NOT EXISTS (
          SELECT 1 FROM ${schema.reports}
          WHERE ${schema.reports.imageId} = ${schema.images.imageId}
            AND ${schema.reports.resolvedAt} IS NULL
        )`,
      ),
    )
    .get();
});
