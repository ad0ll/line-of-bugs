import { cache } from "react";
import { and, eq, sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import { applyRepeatMode, type RepeatMode } from "@/lib/repeat-mode";
import type { Image } from "@/db/schema";
import { buildTaxonGroupSQL } from "@/lib/taxonomy";

export interface SessionFilters {
  subjectType: "nature" | "specimen" | "both";
  /** Multi-select arrays. Empty = no filter on that axis.
   *  "unknown" sentinel matches NULL or empty-string. */
  views: string[];
  lifeStages: string[];
  sexes: string[];
  /** R6 layperson taxonomy chip keys. */
  groups: string[];
}

export interface BuildSessionPoolOpts extends SessionFilters {
  repeatMode: RepeatMode;
  limit?: number;
}

function inOrUnknownArr(column: SQL, values: string[]): SQL {
  const real = values.filter((v) => v !== "unknown");
  const includeUnknown = values.includes("unknown");
  const parts: SQL[] = [];
  if (real.length > 0) {
    parts.push(sql`${column} IN (${sql.join(real.map((v) => sql`${v}`), sql`, `)})`);
  }
  if (includeUnknown) {
    parts.push(sql`(${column} IS NULL OR ${column} = '')`);
  }
  if (parts.length === 0) return sql`1=1`;
  return sql.join(parts, sql` OR `);
}

function buildSessionFilterClauses(opts: SessionFilters): SQL[] {
  const conditions: SQL[] = [
    eq(schema.images.hidden, false),
    sql`NOT EXISTS (
      SELECT 1 FROM ${schema.reports}
      WHERE ${schema.reports.imageId} = ${schema.images.imageId}
        AND ${schema.reports.resolvedAt} IS NULL
    )`,
  ];
  // UI labels "nature"/"specimen" map to DB enum {wild, captive, specimen}.
  if (opts.subjectType === "nature") {
    conditions.push(sql`${schema.images.subjectState} IN ('wild', 'captive')`);
  } else if (opts.subjectType === "specimen") {
    conditions.push(eq(schema.images.subjectState, "specimen"));
  }
  if (opts.views.length > 0) {
    conditions.push(sql`(${inOrUnknownArr(sql`${schema.images.viewLabel}`, opts.views)})`);
  }
  if (opts.lifeStages.length > 0) {
    conditions.push(sql`(${inOrUnknownArr(sql`${schema.images.lifeStage}`, opts.lifeStages)})`);
  }
  if (opts.sexes.length > 0) {
    conditions.push(sql`(${inOrUnknownArr(sql`${schema.images.sex}`, opts.sexes)})`);
  }
  if (opts.groups.length > 0) {
    const groupClause = buildTaxonGroupSQL(
      opts.groups,
      sql`${schema.images.taxonSubgroup}`,
    );
    if (groupClause) conditions.push(groupClause);
  }
  return conditions;
}

/**
 * Build a randomized image queue for a session.
 * Not cached — each call returns a fresh shuffle.
 * Excludes hidden images and any image with an unresolved report.
 */
export async function buildSessionPool(
  opts: BuildSessionPoolOpts,
): Promise<Image[]> {
  const conditions = buildSessionFilterClauses(opts);
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
  const conditions = buildSessionFilterClauses(opts);
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
