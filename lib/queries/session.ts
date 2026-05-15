import { cache } from "react";
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { applyRepeatMode, type RepeatMode } from "@/lib/repeat-mode";
import type { Image } from "@/db/schema";

export interface BuildSessionPoolOpts {
  subjectType: "nature" | "specimen" | "both";
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
  const conditions = [
    eq(schema.images.hidden, false),
    sql`NOT EXISTS (
      SELECT 1 FROM ${schema.reports}
      WHERE ${schema.reports.imageId} = ${schema.images.imageId}
        AND ${schema.reports.resolvedAt} IS NULL
    )`,
  ];
  if (opts.subjectType !== "both") {
    conditions.push(eq(schema.images.subjectType, opts.subjectType));
  }
  const all = await db
    .select()
    .from(schema.images)
    .where(and(...conditions))
    .orderBy(sql`RANDOM()`)
    .limit(opts.limit ?? 500);

  return applyRepeatMode(all, opts.repeatMode);
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
