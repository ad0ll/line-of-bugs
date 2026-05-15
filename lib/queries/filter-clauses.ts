import { sql, type SQL } from "drizzle-orm";
import { buildTaxonGroupSQL } from "@/lib/taxonomy";
import type { SubjectType } from "@/lib/subject";

/**
 * Shared filter state used by gallery, session, and facet queries.
 * Each axis maps to one SQL clause; empty arrays / "all" subject skip
 * their clause entirely.
 */
export interface FilterState {
  subjectType: SubjectType;
  views: string[];
  lifeStages: string[];
  sexes: string[];
  groups: string[];
}

/**
 * Build the WHERE clauses for the `images i` row predicate. Callers
 * concatenate these with `sql.join(clauses, sql\` AND \`)` and inject
 * into their own SELECT.
 *
 * Both raw `db.all(sql\`...\`)` callers (gallery) and drizzle query-
 * builder callers (session) work — drizzle resolves the `i.column`
 * references against whichever table is in the FROM clause as long
 * as `images` is the only table aliased `i` in scope.
 */
export function buildFilterClauses(filters: FilterState): SQL[] {
  const clauses: SQL[] = [
    sql`hidden = 0`,
    sql`NOT EXISTS (
      SELECT 1 FROM reports r
      WHERE r.image_id = images.image_id AND r.resolved_at IS NULL
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
