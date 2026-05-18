import { cache } from "react";
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { applyRepeatMode, type RepeatMode } from "@/lib/repeat-mode";
import type { Image } from "@/db/schema";
import { buildFilterClauses, type FilterState } from "@/lib/queries/filter-clauses";
import { IMAGE_COLS_NO_RAW } from "@/lib/queries/_image-cols";

export type SessionFilters = FilterState;

export interface BuildSessionPoolOpts extends SessionFilters {
  repeatMode: RepeatMode;
  limit?: number;
}

/**
 * Build a randomized image queue for a session.
 * Not cached — each call returns a fresh shuffle.
 * Excludes hidden images and any image with an unresolved report.
 *
 * Projection skips `raw_metadata` (see lib/queries/_image-cols.ts). The
 * return type stays Image[] for compatibility with callers; rawMetadata
 * is structurally present in the type but undefined at runtime, which is
 * fine because nothing reads it.
 */
export async function buildSessionPool(
  opts: BuildSessionPoolOpts,
): Promise<Image[]> {
  const conditions = buildFilterClauses(opts, "images");
  // No LIMIT — the in-memory pool map handles arbitrarily large pools
  // and deliverable-count = displayed-count is a load-bearing principle
  // (see docs/superpowers/specs/2026-05-16-design-pass-v2-design.md).
  const query = db
    .select(IMAGE_COLS_NO_RAW)
    .from(schema.images)
    .where(and(...conditions))
    .orderBy(sql`RANDOM()`);
  const all = opts.limit !== undefined ? await query.limit(opts.limit) : await query;
  return applyRepeatMode(all as unknown as Image[], opts.repeatMode);
}

/**
 * Count how many images would be eligible for a session given the
 * current filter selection. Used by the home page to show a live
 * "X images in your session pool" indicator before the user starts.
 */
export async function countSessionPool(opts: SessionFilters): Promise<number> {
  const conditions = buildFilterClauses(opts, "images");
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
// Projection skips `raw_metadata` — no consumer of getImage reads it.
export const getImage = cache(async (imageId: string) => {
  return db
    .select(IMAGE_COLS_NO_RAW)
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
        sql`NOT EXISTS (
          SELECT 1 FROM gate_decisions g
          WHERE g.image_id = ${schema.images.imageId}
            AND g.decision = 'reject'
        )`,
      ),
    )
    .get();
});
