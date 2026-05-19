import { sql } from "drizzle-orm";
import { cacheTag, cacheLife } from "next/cache";
import { db } from "@/db";
import { TAXON_GROUPS } from "@/lib/taxonomy";
import { buildFilterClauses, type FilterState, type NoveltyMode } from "@/lib/queries/filter-clauses";

export interface FacetCount {
  name: string;
  count: number;
}

export interface FacetSnapshot {
  /** Total rows matching the full filter state. */
  total: number;
  /** Subject-state buckets, computed ignoring the subject filter. */
  subject: { wild: number; captive: number; specimen: number };
  /** view_label buckets (NULL/'' folded into "unknown"), own-axis excluded. */
  views: FacetCount[];
  lifeStages: FacetCount[];
  sexes: FacetCount[];
  /** taxon_subgroup buckets folded into chip keys, own-axis excluded. */
  taxonGroups: FacetCount[];
}

/**
 * Snapshot of all facet counts for a given filter state.
 *
 * Each axis's counts apply every OTHER axis's filters but ignore the
 * axis's own selection, so multi-select chips stay orthogonal within
 * an axis (clicking butterflies doesn't zero the cockroach chip).
 *
 * Not cached — the per-filter-state cache key would explode and a
 * single COUNT(*) over the ~40k indexed pool is sub-10ms anyway.
 * Use `getUnfilteredFacets()` for the SSR initial render where the
 * snapshot is stable.
 */
function noveltyCountExpr(mode: NoveltyMode): ReturnType<typeof sql> {
  switch (mode) {
    case "never-repeat-species":
      return sql`COUNT(DISTINCT COALESCE(taxon_species, common_name, image_id))`;
    case "allow-different-angles":
      return sql`COUNT(DISTINCT COALESCE(collection_id, image_id))`;
    case "show-everything":
    default:
      return sql`COUNT(*)`;
  }
}

export async function getFacetCounts(filters: FilterState): Promise<FacetSnapshot> {
  const totalClauses = buildFilterClauses(filters);
  const totalWhere = sql.join(totalClauses, sql` AND `);
  const expr = noveltyCountExpr(filters.novelty ?? "show-everything");
  const totalRow = db.get<{ c: number }>(sql`
    SELECT ${expr} AS c FROM images i WHERE ${totalWhere}
  `);

  return {
    total: totalRow?.c ?? 0,
    subject: runSubjectCounts(filters),
    views: runColumnCounts({ ...filters, views: [] }, "view_label"),
    lifeStages: runColumnCounts({ ...filters, lifeStages: [] }, "life_stage"),
    sexes: runColumnCounts({ ...filters, sexes: [] }, "sex"),
    taxonGroups: runTaxonGroupCounts(filters),
  };
}

/**
 * Cached unfiltered snapshot — used as the "total" baseline. The chip
 * UI displays "filtered / total"; this is the total half. Revalidated
 * with the same tag the report-resolve admin route already invalidates.
 */
export async function getUnfilteredFacets(): Promise<FacetSnapshot> {
  "use cache";
  cacheTag("images-stats");
  cacheLife("days");
  // CACHE STALENESS NOTE: gate_decisions changes don't invalidate this tag.
  // Only report submit/hide/delete actions do. The unfiltered total + per-
  // axis baselines can lag by up to cacheLife("days") after a recompute_gate
  // run or model retrain. See cf-frontend plan → Out of scope.
  return getFacetCounts({
    subjectType: "all",
    views: [],
    lifeStages: [],
    sexes: [],
    groups: [],
  });
}

function runSubjectCounts(filters: FilterState): FacetSnapshot["subject"] {
  const cleared: FilterState = { ...filters, subjectType: "all" };
  const clauses = buildFilterClauses(cleared);
  const whereClause = sql.join(clauses, sql` AND `);
  const rows = db.all<{ subject_state: string; c: number }>(sql`
    SELECT subject_state, COUNT(*) AS c
    FROM images i
    WHERE ${whereClause}
    GROUP BY subject_state
  `);
  return {
    wild: rows.find((r) => r.subject_state === "wild")?.c ?? 0,
    captive: rows.find((r) => r.subject_state === "captive")?.c ?? 0,
    specimen: rows.find((r) => r.subject_state === "specimen")?.c ?? 0,
  };
}

function runColumnCounts(
  filters: FilterState,
  column: "view_label" | "life_stage" | "sex",
): FacetCount[] {
  const clauses = buildFilterClauses(filters);
  const whereClause = sql.join(clauses, sql` AND `);
  const colRef = sql.raw(column);
  const rows = db.all<{ name: string | null; c: number }>(sql`
    SELECT
      CASE
        WHEN ${colRef} IS NULL OR ${colRef} = '' THEN 'unknown'
        ELSE ${colRef}
      END AS name,
      COUNT(*) AS c
    FROM images i
    WHERE ${whereClause}
    GROUP BY name
  `);
  return rows.map((r) => ({ name: r.name ?? "unknown", count: r.c }));
}

export function runTaxonGroupCounts(filters: FilterState): FacetCount[] {
  const cleared: FilterState = { ...filters, groups: [] };
  const clauses = buildFilterClauses(cleared);
  const whereClause = sql.join(clauses, sql` AND `);
  const rows = db.all<{ subgroup: string | null; c: number }>(sql`
    SELECT taxon_subgroup AS subgroup, COUNT(*) AS c
    FROM images i
    WHERE ${whereClause}
    GROUP BY taxon_subgroup
  `);
  const byDbValue = new Map<string | null, number>();
  for (const r of rows) byDbValue.set(r.subgroup, r.c);
  const nullCount = byDbValue.get(null) ?? 0;

  const out: FacetCount[] = [];
  for (const g of TAXON_GROUPS) {
    let count = 0;
    for (const v of g.dbValues) count += byDbValue.get(v) ?? 0;
    if (g.catchesNull) count += nullCount;
    out.push({ name: g.key, count }); // keep zero-count buckets — UI greys them
  }
  return out;
}
