import { sql, type SQL } from "drizzle-orm";
import { cacheTag, cacheLife } from "next/cache";
import { db } from "@/db";

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
  subject: "nature" | "specimen" | "both";
  institutions: string[];
  // Multi-select arrays. Empty array = no filter on that axis.
  // The literal string "unknown" matches NULL or empty-string DB values
  // (since most older iNat rows lack annotation-derived metadata).
  views: string[];
  lifeStages: string[];
  sexes: string[];
  page: number;
};

function inOrUnknown(column: SQL, values: string[]): SQL {
  // Helper: build `column IN (...)` clause that also handles the synthetic
  // "unknown" sentinel mapping to NULL OR ''.
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

  const filters: SQL[] = [sql`i.hidden = 0`];
  filters.push(sql`NOT EXISTS (SELECT 1 FROM reports r WHERE r.image_id = i.image_id AND r.resolved_at IS NULL)`);

  // UI labels "nature"/"specimen" map to DB enum {wild, captive, specimen}.
  // Nature = alive in any setting (wild OR captive); specimen = preserved.
  if (args.subject === "nature") {
    filters.push(sql`i.subject_state IN ('wild', 'captive')`);
  } else if (args.subject === "specimen") {
    filters.push(sql`i.subject_state = 'specimen'`);
  }

  if (args.institutions.length > 0) {
    const list = sql.join(args.institutions.map((x) => sql`${x}`), sql`, `);
    filters.push(sql`i.institution IN (${list})`);
  }

  if (args.views.length > 0) {
    filters.push(sql`(${inOrUnknown(sql`i.view_label`, args.views)})`);
  }
  if (args.lifeStages.length > 0) {
    filters.push(sql`(${inOrUnknown(sql`i.life_stage`, args.lifeStages)})`);
  }
  if (args.sexes.length > 0) {
    filters.push(sql`(${inOrUnknown(sql`i.sex`, args.sexes)})`);
  }

  if (args.q.trim() && !ftsQuery) {
    return { rows: [], totalCount: 0, hasMore: false, page: args.page, pageSize: PAGE_SIZE };
  }

  if (ftsQuery) {
    filters.push(sql`i.image_id IN (SELECT image_id FROM images_fts WHERE images_fts MATCH ${ftsQuery})`);
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

export type SubjectTypeCounts = { nature: number; specimen: number; both: number };

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
  // UI groups "wild + captive" under the "nature" label
  const nature = wild + captive;
  return { nature, specimen, both: nature + specimen };
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
