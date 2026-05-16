import { sql, type SQL } from "drizzle-orm";
import { buildTaxonGroupSQL } from "@/lib/taxonomy";
import type { SubjectType } from "@/lib/subject";

/**
 * Shared filter state used by gallery, session, and facet queries.
 * Each axis maps to one SQL clause; empty arrays / "all" subject skip
 * their clause entirely.
 *
 * `institutions` is optional because the session API + home page
 * never apply institution filtering — only the gallery + gallery
 * facets do. Callers that don't care can omit it.
 */
export interface FilterState {
  subjectType: SubjectType;
  views: string[];
  lifeStages: string[];
  sexes: string[];
  groups: string[];
  institutions?: string[];
}

/**
 * Build the WHERE clauses for the row predicate. Callers concatenate
 * with `sql.join(clauses, sql\` AND \`)` and inject into their SELECT.
 *
 * `alias` is the FROM-clause alias for the `images` table — needed
 * for the NOT EXISTS reports correlation, which would otherwise bind
 * to the inner `reports.image_id` if left bare. Gallery + facet
 * callers use `"i"` (their CTEs read `FROM images i`); the session
 * helper passes `"images"` because drizzle's query builder leaves
 * the table un-aliased and references it by name.
 */
export function buildFilterClauses(
  filters: FilterState,
  alias: "i" | "images" = "i",
): SQL[] {
  const outerImageId = sql.raw(`${alias}.image_id`);
  const clauses: SQL[] = [
    sql`hidden = 0`,
    sql`NOT EXISTS (
      SELECT 1 FROM reports r
      WHERE r.image_id = ${outerImageId} AND r.resolved_at IS NULL
    )`,
  ];

  if (filters.subjectType !== "all") {
    clauses.push(sql`subject_state = ${filters.subjectType}`);
  }

  if (filters.views.length > 0) {
    clauses.push(sql`(${inOrUnknown(sql`view_label`, filters.views)})`);
  }
  if (filters.lifeStages.length > 0) {
    clauses.push(sql`(${inOrUnknown(sql`life_stage`, filters.lifeStages)})`);
  }
  if (filters.sexes.length > 0) {
    clauses.push(sql`(${inOrUnknown(sql`sex`, filters.sexes)})`);
  }
  if (filters.groups.length > 0) {
    const groupClause = buildTaxonGroupSQL(filters.groups, sql`taxon_subgroup`);
    if (groupClause) clauses.push(groupClause);
  }
  if (filters.institutions && filters.institutions.length > 0) {
    const list = sql.join(filters.institutions.map((x) => sql`${x}`), sql`, `);
    clauses.push(sql`institution IN (${list})`);
  }

  return clauses;
}

function inOrUnknown(column: SQL, values: string[]): SQL {
  // Multi-select facet: "unknown" is a synthetic sentinel for the
  // NULL ∪ empty-string bucket (most older iNat rows have no annotation).
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
