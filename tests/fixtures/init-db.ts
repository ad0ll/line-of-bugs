/**
 * In-memory test DB setup.
 *
 * tests/setup.ts sets `DATABASE_URL=:memory:` BEFORE db/index.ts is
 * first imported, so the singleton sqlite handle binds to a fresh
 * in-memory database. This module then applies the final schema and
 * seeds a small, predictable fixture so DB-touching tests run in
 * milliseconds instead of seconds against the 40k-row real DB.
 *
 * Idempotent: db/index.ts caches the handle on globalThis when
 * NODE_ENV !== "production", which means in vitest the singleton
 * survives across test files within a worker. CREATE … IF NOT EXISTS
 * + a seed guard let setup.ts re-run safely.
 */
import { sqlite } from "@/db";

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS images (
  image_id text PRIMARY KEY NOT NULL,
  collection_id text NOT NULL,
  source text NOT NULL,
  source_id text NOT NULL,
  source_page_url text NOT NULL,
  image_url text NOT NULL,
  filename text NOT NULL,
  thumbnail_filename text NOT NULL,
  medium_filename text NOT NULL,
  file_size_bytes integer,
  file_sha256 text NOT NULL,
  width integer,
  height integer,
  license text NOT NULL,
  license_url text,
  photographer_attribution text,
  photographer text,
  institution text,
  taxon_order text,
  taxon_species text,
  common_name text,
  view_label text,
  description text,
  captured_date text,
  added_at integer DEFAULT (unixepoch()) NOT NULL,
  hidden integer DEFAULT 0 NOT NULL,
  subject_state text NOT NULL,
  life_stage text,
  sex text,
  host_organism text,
  specimen_condition text,
  raw_metadata text,
  taxon_subgroup text
);

CREATE TABLE IF NOT EXISTS reports (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  image_id text NOT NULL,
  category text NOT NULL,
  message text,
  created_at integer DEFAULT (unixepoch()) NOT NULL,
  resolved_at integer,
  resolved_action text,
  FOREIGN KEY (image_id) REFERENCES images(image_id) ON UPDATE no action ON DELETE cascade
);

CREATE INDEX IF NOT EXISTS idx_images_subject_state ON images (subject_state);
CREATE INDEX IF NOT EXISTS idx_images_taxon_subgroup ON images (taxon_subgroup);
CREATE INDEX IF NOT EXISTS idx_images_view_label ON images (view_label);
CREATE INDEX IF NOT EXISTS idx_images_life_stage ON images (life_stage);
CREATE INDEX IF NOT EXISTS idx_images_sex ON images (sex);
CREATE INDEX IF NOT EXISTS idx_images_hidden ON images (hidden);
CREATE INDEX IF NOT EXISTS idx_reports_image ON reports (image_id);
CREATE INDEX IF NOT EXISTS idx_reports_unresolved ON reports (image_id) WHERE resolved_at IS NULL;

CREATE TABLE IF NOT EXISTS gate_decisions (
  image_id      text PRIMARY KEY NOT NULL,
  decision      text NOT NULL CHECK (decision IN ('keep','reject')),
  reason        text NOT NULL,
  reason_source text NOT NULL CHECK (reason_source IN ('hand','report','rule','ml','default')),
  computed_at   integer NOT NULL,
  model_version text,
  threshold_v   integer,
  FOREIGN KEY (image_id) REFERENCES images(image_id) ON UPDATE no action ON DELETE cascade
);
CREATE INDEX IF NOT EXISTS idx_gate_decisions_decision
  ON gate_decisions (decision);
CREATE INDEX IF NOT EXISTS idx_gate_decisions_reason_source
  ON gate_decisions (reason_source);

CREATE TABLE IF NOT EXISTS species_metadata (
  taxon_species text PRIMARY KEY NOT NULL,
  has_sketchfab_models integer,
  sketchfab_hit_count integer,
  sketchfab_last_checked_at integer,
  sketchfab_hits_json text
);
CREATE INDEX IF NOT EXISTS idx_species_metadata_sketchfab_checked
  ON species_metadata (sketchfab_last_checked_at);

CREATE VIRTUAL TABLE IF NOT EXISTS images_fts USING fts5(
  image_id UNINDEXED,
  common_name,
  taxon_species,
  tokenize = 'unicode61 remove_diacritics 2'
);
CREATE TRIGGER IF NOT EXISTS images_fts_insert AFTER INSERT ON images BEGIN
  INSERT INTO images_fts(image_id, common_name, taxon_species)
  VALUES (new.image_id, new.common_name, new.taxon_species);
END;
CREATE TRIGGER IF NOT EXISTS images_fts_delete AFTER DELETE ON images BEGIN
  DELETE FROM images_fts WHERE image_id = old.image_id;
END;
CREATE TRIGGER IF NOT EXISTS images_fts_update AFTER UPDATE ON images BEGIN
  DELETE FROM images_fts WHERE image_id = old.image_id;
  INSERT INTO images_fts(image_id, common_name, taxon_species)
  VALUES (new.image_id, new.common_name, new.taxon_species);
END;
`;

export const FIXTURE = {
  subject: { wild: 20, captive: 7, specimen: 7 },
  taxon: {
    butterflies: { wild: 6, captive: 4, specimen: 2, total: 12 },
    moths:       { wild: 5, captive: 0, specimen: 0, total: 5 },
    cockroaches: { wild: 4, captive: 0, specimen: 1, total: 5 },
    beetles:     { wild: 2, captive: 2, specimen: 1, total: 5 },
    bees:        { wild: 1, captive: 1, specimen: 1, total: 3 },
    ants:        { wild: 0, captive: 0, specimen: 2, total: 2 },
  },
  total: 34,
};

interface SeedRow {
  /** Nullable so we can seed NULL-taxon_subgroup rows for the
   *  "weird" group's catchesNull rollup regression guard. */
  taxon_subgroup: string | null;
  taxon_order: string;
  common_name: string;
  taxon_species: string;
  subject_state: "wild" | "captive" | "specimen";
  sex?: "male" | "female" | "worker";
  life_stage?: "adult" | "egg" | "larva";
  view_label?: string;
}

function rows(): SeedRow[] {
  const out: SeedRow[] = [];
  function add(n: number, r: Omit<SeedRow, "common_name" | "taxon_species"> & { taxon_subgroup: string }) {
    for (let i = 0; i < n; i++) {
      out.push({
        ...r,
        common_name: `${r.taxon_subgroup} ${i + 1}`,
        taxon_species: `Testus ${r.taxon_subgroup}icus ${i + 1}`,
      });
    }
  }
  add(6, { taxon_subgroup: "butterfly",  taxon_order: "Lepidoptera", subject_state: "wild",     life_stage: "adult", view_label: "dorsal" });
  add(4, { taxon_subgroup: "butterfly",  taxon_order: "Lepidoptera", subject_state: "captive",  life_stage: "adult" });
  add(2, { taxon_subgroup: "butterfly",  taxon_order: "Lepidoptera", subject_state: "specimen", life_stage: "adult", view_label: "dorsal" });
  add(5, { taxon_subgroup: "moth",       taxon_order: "Lepidoptera", subject_state: "wild",     life_stage: "adult" });
  add(4, { taxon_subgroup: "cockroach",  taxon_order: "Blattodea",   subject_state: "wild" });
  add(1, { taxon_subgroup: "cockroach",  taxon_order: "Blattodea",   subject_state: "specimen", view_label: "lateral" });
  add(2, { taxon_subgroup: "beetle",     taxon_order: "Coleoptera",  subject_state: "wild" });
  add(2, { taxon_subgroup: "beetle",     taxon_order: "Coleoptera",  subject_state: "captive" });
  add(1, { taxon_subgroup: "beetle",     taxon_order: "Coleoptera",  subject_state: "specimen" });
  add(1, { taxon_subgroup: "bee",        taxon_order: "Hymenoptera", subject_state: "wild",     sex: "worker" });
  add(1, { taxon_subgroup: "bee",        taxon_order: "Hymenoptera", subject_state: "captive",  sex: "worker" });
  add(1, { taxon_subgroup: "bee",        taxon_order: "Hymenoptera", subject_state: "specimen", sex: "female" });
  add(2, { taxon_subgroup: "ant",        taxon_order: "Hymenoptera", subject_state: "specimen", sex: "worker" });
  // NULL-taxon_subgroup rows so the "weird" group's catchesNull
  // rollup is exercised by tests (lib/taxonomy.ts:catchesNull).
  out.push({
    taxon_subgroup: null,
    taxon_order: "Siphonaptera",
    subject_state: "wild",
    life_stage: "adult",
    common_name: "weird thing 1",
    taxon_species: "Pulex irritans",
  });
  out.push({
    taxon_subgroup: null,
    taxon_order: "Zygentoma",
    subject_state: "wild",
    life_stage: "adult",
    common_name: "weird thing 2",
    taxon_species: "Lepisma saccharina",
  });
  return out;
}

export function initTestDb(): void {
  sqlite.exec(SCHEMA_SQL);

  // Seed guard — skip if rows already present from a previous setup
  // pass in this worker.
  const existing = sqlite.prepare("SELECT COUNT(*) AS c FROM images").get() as { c: number };
  if (existing.c > 0) return;

  const insert = sqlite.prepare(`
    INSERT INTO images (
      image_id, collection_id, source, source_id, source_page_url, image_url,
      filename, thumbnail_filename, medium_filename, file_sha256, license,
      taxon_order, taxon_species, common_name,
      subject_state, life_stage, sex, view_label, taxon_subgroup
    ) VALUES (
      @image_id, @collection_id, @source, @source_id, @page, @url,
      @file, @thumb, @medium, @sha, @license,
      @taxon_order, @taxon_species, @common_name,
      @subject_state, @life_stage, @sex, @view_label, @taxon_subgroup
    )
  `);

  const seed = rows();
  const tx = sqlite.transaction((all: SeedRow[]) => {
    all.forEach((r, i) => {
      const id = `test-${String(i).padStart(3, "0")}`;
      insert.run({
        image_id: id,
        collection_id: id,
        source: "inaturalist",
        source_id: id,
        page: `https://example.test/${id}`,
        url: `https://example.test/${id}.jpg`,
        file: `images/${id}.jpg`,
        thumb: `thumbnails/${id}.jpg`,
        medium: `medium/${id}.jpg`,
        sha: id,
        license: "CC0",
        taxon_order: r.taxon_order,
        taxon_species: r.taxon_species,
        common_name: r.common_name,
        subject_state: r.subject_state,
        life_stage: r.life_stage ?? null,
        sex: r.sex ?? null,
        view_label: r.view_label ?? null,
        taxon_subgroup: r.taxon_subgroup,
      });
    });
  });
  tx(seed);
}

/**
 * Test helper: mark an image as rejected in gate_decisions. Used by
 * filter integration tests to verify the gallery/session/count helpers
 * exclude the row. reason_source defaults to 'rule' (most common path).
 */
export function markRejected(
  imageId: string,
  reason: string = "rule:bbox-content_no-bug",
  reasonSource: "hand" | "report" | "rule" | "ml" | "default" = "rule",
): void {
  sqlite
    .prepare(
      "INSERT INTO gate_decisions " +
      "(image_id, decision, reason, reason_source, computed_at) " +
      "VALUES (?, 'reject', ?, ?, unixepoch()) " +
      "ON CONFLICT(image_id) DO UPDATE SET " +
      "decision='reject', reason=excluded.reason, " +
      "reason_source=excluded.reason_source, " +
      "computed_at=excluded.computed_at",
    )
    .run(imageId, reason, reasonSource);
}

/**
 * Test helper: insert a 'keep' decision (used when a test wants to
 * confirm a kept-decision image stays visible).
 */
export function markKept(imageId: string): void {
  sqlite
    .prepare(
      "INSERT INTO gate_decisions " +
      "(image_id, decision, reason, reason_source, computed_at) " +
      "VALUES (?, 'keep', 'defaults_pass', 'default', unixepoch()) " +
      "ON CONFLICT(image_id) DO UPDATE SET " +
      "decision='keep', reason='defaults_pass', reason_source='default', " +
      "computed_at=unixepoch()",
    )
    .run(imageId);
}
