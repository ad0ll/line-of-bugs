import { sql, type SQL } from "drizzle-orm";
import { cacheTag, cacheLife } from "next/cache";
import { db } from "@/db";
import { TAXON_GROUPS } from "@/lib/taxonomy";
import type { SubjectType } from "@/lib/subject";
import { buildFilterClauses } from "@/lib/queries/filter-clauses";

export type GalleryRow = {
  image_id: string;
  collection_id: string;
  source: string;
  source_page_url: string;
  image_url: string;
  thumbnail_filename: string;
  medium_filename: string;
  filename: string;
  width: number | null;
  height: number | null;
  taxon_order: string | null;
  taxon_species: string | null;
  common_name: string | null;
  subject_state: string;
  institution: string | null;
  collection_index: number;
  collection_size: number;
};

export type SearchGalleryArgs = {
  q: string;
  subject: SubjectType;
  institutions: string[];
  // Multi-select arrays. Empty array = no filter on that axis.
  // The literal string "unknown" matches NULL or empty-string DB values
  // (since most older iNat rows lack annotation-derived metadata).
  views: string[];
  lifeStages: string[];
  sexes: string[];
  /** R6 layperson taxonomy filter — chip keys from lib/taxonomy.ts. */
  groups: string[];
  page: number;
};

export type SearchGalleryResult = {
  rows: GalleryRow[];
  totalCount: number;
  hasMore: boolean;
  page: number;
  pageSize: number;
};

const PAGE_SIZE = 50;

function buildFtsQuery(raw: string): string | null {
  const cleaned = raw.replace(/[^\p{L}\p{N}\s]/gu, " ").trim();
  if (!cleaned) return null;
  const tokens = cleaned.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;
  const head = tokens.slice(0, -1).map((t) => `"${t}"`);
  const last = `"${tokens.at(-1)!}"*`;
  return [...head, last].join(" ");
}

export async function searchGallery(args: SearchGalleryArgs): Promise<SearchGalleryResult> {
  "use cache";
  cacheTag("gallery-results");
  cacheLife("hours");

  const offset = (args.page - 1) * PAGE_SIZE;
  const ftsQuery = buildFtsQuery(args.q);

  const filters: SQL[] = buildFilterClauses({
    subjectType: args.subject,
    views: args.views,
    lifeStages: args.lifeStages,
    sexes: args.sexes,
    groups: args.groups,
  });

  // Institution is gallery-only — not part of the shared FilterState.
  if (args.institutions.length > 0) {
    const list = sql.join(args.institutions.map((x) => sql`${x}`), sql`, `);
    filters.push(sql`institution IN (${list})`);
  }

  if (args.q.trim() && !ftsQuery) {
    return { rows: [], totalCount: 0, hasMore: false, page: args.page, pageSize: PAGE_SIZE };
  }

  if (ftsQuery) {
    filters.push(sql`image_id IN (SELECT image_id FROM images_fts WHERE images_fts MATCH ${ftsQuery})`);
  }

  const whereClause = sql.join(filters, sql` AND `);

  const rowsResult = db.all<GalleryRow>(sql`
    WITH visible AS (
      SELECT i.* FROM images i WHERE ${whereClause}
    )
    SELECT
      image_id, collection_id, source, source_page_url, image_url,
      thumbnail_filename, medium_filename, filename,
      width, height, taxon_order, taxon_species, common_name,
      subject_state, institution,
      ROW_NUMBER() OVER (PARTITION BY collection_id ORDER BY image_id) AS collection_index,
      COUNT(*) OVER (PARTITION BY collection_id) AS collection_size
    FROM visible
    ORDER BY collection_id, image_id
    LIMIT ${PAGE_SIZE} OFFSET ${offset}
  `);

  const totalResult = db.get<{ c: number }>(sql`
    SELECT COUNT(*) AS c FROM images i WHERE ${whereClause}
  `);

  return {
    rows: rowsResult,
    totalCount: totalResult?.c ?? 0,
    hasMore: offset + rowsResult.length < (totalResult?.c ?? 0),
    page: args.page,
    pageSize: PAGE_SIZE,
  };
}

export type InstitutionRow = { name: string; count: number };

export async function listInstitutions(): Promise<InstitutionRow[]> {
  "use cache";
  cacheTag("institutions");
  cacheLife("days");

  return db.all<InstitutionRow>(sql`
    SELECT i.institution AS name, COUNT(*) AS count
    FROM images i
    WHERE i.hidden = 0
      AND i.institution IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM reports r
        WHERE r.image_id = i.image_id AND r.resolved_at IS NULL
      )
    GROUP BY i.institution
    ORDER BY count DESC, name ASC
  `);
}

export type SubjectTypeCounts = {
  wild: number;
  captive: number;
  specimen: number;
  all: number;
};

export async function listSubjectTypeCounts(): Promise<SubjectTypeCounts> {
  "use cache";
  cacheTag("images-stats");
  cacheLife("days");

  const rows = db.all<{ subject_state: string; c: number }>(sql`
    SELECT subject_state, COUNT(*) AS c
    FROM images i
    WHERE i.hidden = 0
      AND NOT EXISTS (
        SELECT 1 FROM reports r
        WHERE r.image_id = i.image_id AND r.resolved_at IS NULL
      )
    GROUP BY subject_state
  `);

  const wild = rows.find((r) => r.subject_state === "wild")?.c ?? 0;
  const captive = rows.find((r) => r.subject_state === "captive")?.c ?? 0;
  const specimen = rows.find((r) => r.subject_state === "specimen")?.c ?? 0;
  return { wild, captive, specimen, all: wild + captive + specimen };
}

export type FacetRow = { name: string; count: number };

/**
 * Generic facet count for view_label / life_stage / sex.
 * NULL or empty-string values are bucketed under "unknown" so the UI
 * can show a literal chip rather than something cryptic.
 */
function listFacet(column: string, cacheKey: string) {
  return async function (): Promise<FacetRow[]> {
    "use cache";
    cacheTag(cacheKey);
    cacheLife("days");
    const rows = db.all<FacetRow>(sql`
      SELECT
        CASE
          WHEN ${sql.raw(`i.${column}`)} IS NULL OR ${sql.raw(`i.${column}`)} = '' THEN 'unknown'
          ELSE ${sql.raw(`i.${column}`)}
        END AS name,
        COUNT(*) AS count
      FROM images i
      WHERE i.hidden = 0
        AND NOT EXISTS (
          SELECT 1 FROM reports r
          WHERE r.image_id = i.image_id AND r.resolved_at IS NULL
        )
      GROUP BY name
      ORDER BY (CASE WHEN name = 'unknown' THEN 1 ELSE 0 END), count DESC, name ASC
    `);
    return rows;
  };
}

export const listViewCounts = listFacet("view_label", "view-counts");
export const listLifeStageCounts = listFacet("life_stage", "life-stage-counts");
export const listSexCounts = listFacet("sex", "sex-counts");

/**
 * Counts per taxon-group chip (R6). Folds NULL taxon_subgroup rows into
 * the chip(s) flagged `catchesNull` (currently just "weird stuff").
 * Returns the chips in TAXON_GROUPS display order so the UI can render
 * them as-is, dropping any chip whose count is zero.
 */
export async function listTaxonGroupCounts(): Promise<FacetRow[]> {
  "use cache";
  cacheTag("taxon-group-counts");
  cacheLife("days");

  const rows = db.all<{ subgroup: string | null; c: number }>(sql`
    SELECT taxon_subgroup AS subgroup, COUNT(*) AS c
    FROM images i
    WHERE i.hidden = 0
      AND NOT EXISTS (
        SELECT 1 FROM reports r
        WHERE r.image_id = i.image_id AND r.resolved_at IS NULL
      )
    GROUP BY taxon_subgroup
  `);

  const byDbValue = new Map<string | null, number>();
  for (const r of rows) byDbValue.set(r.subgroup, r.c);
  const nullCount = byDbValue.get(null) ?? 0;

  const out: FacetRow[] = [];
  for (const g of TAXON_GROUPS) {
    let count = 0;
    for (const v of g.dbValues) count += byDbValue.get(v) ?? 0;
    if (g.catchesNull) count += nullCount;
    if (count > 0) out.push({ name: g.key, count });
  }
  return out;
}

export type SpeciesRow = {
  common_name: string | null;
  taxon_species: string | null;
  taxon_order: string | null;
  count: number;
};

const SPECIES_LIMIT = 12;

export async function searchSpecies(q: string): Promise<SpeciesRow[]> {
  "use cache";
  cacheTag("species-index");
  cacheLife("hours");

  const trimmed = q.trim();
  if (trimmed.length < 2) return [];

  const ftsQuery = buildFtsQuery(trimmed);
  if (!ftsQuery) return [];

  return db.all<SpeciesRow>(sql`
    WITH matches AS (
      SELECT i.common_name, i.taxon_species, i.taxon_order
      FROM images_fts
      JOIN images i ON i.image_id = images_fts.image_id
      WHERE images_fts MATCH ${ftsQuery}
        AND i.hidden = 0
        AND NOT EXISTS (
          SELECT 1 FROM reports r
          WHERE r.image_id = i.image_id AND r.resolved_at IS NULL
        )
    )
    SELECT common_name, taxon_species, taxon_order, COUNT(*) AS count
    FROM matches
    GROUP BY common_name, taxon_species
    ORDER BY count DESC, common_name ASC
    LIMIT ${SPECIES_LIMIT}
  `);
}
