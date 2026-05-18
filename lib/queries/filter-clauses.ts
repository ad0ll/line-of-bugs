import { sql, type SQL } from "drizzle-orm";
import { buildTaxonGroupSQL } from "@/lib/taxonomy";
import type { SubjectType } from "@/lib/subject";

/**
 * Shared filter state used by gallery, session, and facet queries.
 * Each axis maps to one SQL clause; empty arrays / "all" subject skip
 * their clause entirely.
 *
 * Optional axes (`q`, `institutions`) — leave undefined or empty when
 * the caller doesn't use them. The session API doesn't filter on
 * institution. The facet endpoint doesn't filter on q (autocomplete
 * already narrows). The gallery filters on both.
 */
export type NoveltyMode = "show-everything" | "never-repeat-species" | "allow-different-angles";

export interface FilterState {
  subjectType: SubjectType;
  views: string[];
  lifeStages: string[];
  sexes: string[];
  groups: string[];
  /** Booru-style multi-tag species search. Each tag is AND-joined
   *  on its own tokens; tags are OR'd together via FTS5. */
  q?: string[];
  institutions?: string[];
  novelty?: NoveltyMode;
}

/**
 * Build one FTS5 MATCH expression from one search tag. Multi-word
 * tags are AND'd internally with the last word prefix-matched
 * ("tiger swal" matches "tiger swallowtail").
 *
 * Exported for unit tests; ordinary callers use buildFtsQuery.
 */
export function buildFtsTag(raw: string): string | null {
  const cleaned = raw.replace(/[^\p{L}\p{N}\s]/gu, " ").trim();
  if (!cleaned) return null;
  const tokens = cleaned.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;
  const head = tokens.slice(0, -1).map((t) => `"${t}"`);
  const last = `"${tokens.at(-1)!}"*`;
  return [...head, last].join(" ");
}

/**
 * Combine multiple tags into one FTS5 expression. Tags OR together —
 * selecting "monarch" + "swallowtail" matches rows mentioning either.
 * Returns null if no tags produce valid FTS terms.
 */
export function buildFtsQuery(tags: readonly string[]): string | null {
  const sub = tags
    .map((t) => buildFtsTag(t))
    .filter((s): s is string => s !== null)
    .map((s) => `(${s})`);
  if (sub.length === 0) return null;
  return sub.join(" OR ");
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
    sql`NOT EXISTS (
      SELECT 1 FROM gate_decisions g
      WHERE g.image_id = ${outerImageId} AND g.decision = 'reject'
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
  if (filters.q && filters.q.length > 0) {
    const ftsQuery = buildFtsQuery(filters.q);
    if (ftsQuery) {
      clauses.push(
        sql`${outerImageId} IN (SELECT image_id FROM images_fts WHERE images_fts MATCH ${ftsQuery})`,
      );
    }
  }

  return clauses;
}

function inOrUnknown(column: SQL, values: string[]): SQL {
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
