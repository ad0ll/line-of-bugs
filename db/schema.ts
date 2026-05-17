/**
 * Drizzle schema — single source of truth for the SQLite database.
 *
 * Tables:
 *   • images   — one row per fetched image (~40k as of R6 / 2026-05-15).
 *                Populated directly by the Python fetchers via
 *                scripts/db.py:DbWriter (R5 dropped the CSV intermediate).
 *   • reports  — user-submitted "this image shouldn't be here" reports.
 *                An image is hidden from the session pool iff it has at
 *                least one unresolved report. Admin reviews and resolves.
 *
 * Generated types are exported below for use throughout the app.
 */
import { sql } from "drizzle-orm";
import { integer, sqliteTable, text, index, uniqueIndex, check } from "drizzle-orm/sqlite-core";

// ──────────────────────────── images ────────────────────────────

/**
 * Maps to Darwin Core `basisOfRecord`:
 *   wild     ↔ HumanObservation (alive, natural habitat)
 *   captive  ↔ LivingSpecimen   (alive, human care; zoo/lab/garden)
 *   specimen ↔ PreservedSpecimen (mounted/dried/pinned)
 */
export const subjectStates = ["wild", "captive", "specimen"] as const;
export type SubjectState = (typeof subjectStates)[number];

export const lifeStages = [
  "adult", "nymph", "larva", "pupa", "egg", "cocoon", "juvenile", "unknown",
] as const;
export type LifeStage = (typeof lifeStages)[number];

export const sexes = ["male", "female", "worker", "unknown"] as const;
export type Sex = (typeof sexes)[number];

export const sources = ["inaturalist", "bugwood"] as const;
export type Source = (typeof sources)[number];

export const images = sqliteTable(
  "images",
  {
    // Identity
    imageId: text("image_id").primaryKey(),
    collectionId: text("collection_id").notNull(),
    source: text("source", { enum: sources }).notNull(),
    sourceId: text("source_id").notNull(),

    // URLs
    sourcePageUrl: text("source_page_url").notNull(),
    imageUrl: text("image_url").notNull(),
    filename: text("filename").notNull(),
    thumbnailFilename: text("thumbnail_filename").notNull(),
    // 1024-max-edge JPEG q88 — used by the gallery hover-zoom preview.
    mediumFilename: text("medium_filename").notNull(),

    // File facts
    fileSizeBytes: integer("file_size_bytes"),
    fileSha256: text("file_sha256").notNull(),
    width: integer("width"),
    height: integer("height"),

    // Licensing
    license: text("license").notNull(),
    licenseUrl: text("license_url"),

    // Attribution
    photographerAttribution: text("photographer_attribution"),
    photographer: text("photographer"),
    institution: text("institution"),

    // Taxonomy
    taxonOrder: text("taxon_order"),
    taxonSpecies: text("taxon_species"),
    commonName: text("common_name"),

    // Classification — DwC-aligned (see subjectStates docstring above)
    subjectState: text("subject_state", { enum: subjectStates }).notNull(),
    viewLabel: text("view_label"),
    // Biology extracted from source metadata (iNat annotations, Bugwood descriptor/gender).
    // Nullable — most older iNat photos won't have these.
    lifeStage: text("life_stage", { enum: lifeStages }),
    sex: text("sex", { enum: sexes }),
    // Bugwood-only structured extras.
    hostOrganism: text("host_organism"),
    specimenCondition: text("specimen_condition"),
    // Layperson grouping (R6). Values mirror lib/taxonomy.ts:
    // butterfly / moth / caterpillar / ladybug / beetle / bee / wasp /
    // ant / fly / mosquito / dragonfly / grasshopper / cricket / mantis /
    // stick_insect / cockroach / stink_bug / cicada / aphid / earwig / weird.
    // Populated by scripts/backfill_taxon_subgroup.py + at fetch time.
    taxonSubgroup: text("taxon_subgroup"),

    // Context
    description: text("description"),
    capturedDate: text("captured_date"),
    // Full raw API response (JSON string) from the source. Lossless archive
    // for future re-analysis. Backfilled by scripts/backfill_metadata.py.
    rawMetadata: text("raw_metadata"),

    // Bookkeeping
    hidden: integer("hidden", { mode: "boolean" }).notNull().default(false),
    addedAt: integer("added_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [
    // Search / autocomplete
    index("idx_images_species").on(t.taxonSpecies),
    index("idx_images_common").on(t.commonName),
    // Filters
    index("idx_images_collection").on(t.collectionId),
    index("idx_images_source").on(t.source),
    index("idx_images_subject_state").on(t.subjectState),
    index("idx_images_institution").on(t.institution),
    index("idx_images_taxon_order").on(t.taxonOrder),
    index("idx_images_license").on(t.license),
    index("idx_images_view_label").on(t.viewLabel),
    index("idx_images_life_stage").on(t.lifeStage),
    index("idx_images_sex").on(t.sex),
    index("idx_images_taxon_subgroup").on(t.taxonSubgroup),
    // Non-unique: same content may exist under different image_ids
    // (e.g., one photographer's image pulled via both iNat and Bugwood).
    // The manifest already dedups by image_id; sha256 here is for audit only.
    index("idx_images_sha256").on(t.fileSha256),
    index("idx_images_hidden").on(t.hidden),
    // (0007) Unique upstream identity — prevents double-inserting the same
    // upstream image under different image_ids when fetchers re-run.
    uniqueIndex("idx_images_source_source_id").on(t.source, t.sourceId),
    // (0007) Composite for the gallery hot path (hidden=0 + subject_state filter).
    index("idx_images_hidden_subject_state").on(t.hidden, t.subjectState),
    // (0008) SQL-level enum CHECK constraints. The TS enums in the column
    // definitions above are the canonical source — these constraints just
    // backstop the storage layer against raw inserts that bypass the ORM.
    // Drizzle-orm 0.45 only supports table-level `check(name, sql)`; there
    // is no column-level `.$check()` API. Keep the IN-lists in sync with
    // sources / subjectStates / lifeStages / sexes above.
    check(
      "images_source_check",
      sql`${t.source} IN ('inaturalist', 'bugwood')`,
    ),
    check(
      "images_subject_state_check",
      sql`${t.subjectState} IN ('wild', 'captive', 'specimen')`,
    ),
    check(
      "images_life_stage_check",
      sql`${t.lifeStage} IS NULL OR ${t.lifeStage} IN ('adult', 'nymph', 'larva', 'pupa', 'egg', 'cocoon', 'juvenile', 'unknown')`,
    ),
    check(
      "images_sex_check",
      sql`${t.sex} IS NULL OR ${t.sex} IN ('male', 'female', 'worker', 'unknown')`,
    ),
  ],
);

// ──────────────────────────── reports ──────────────────────────

export const reportCategories = [
  "low-resolution",
  "blurry",
  "bug-too-small",
  "hard-to-see",
  "spooky",
  "cropped",
  "ai-generated",
  "zoomed-out",
  "wheres-the-bug",
  "other",
] as const;
export type ReportCategory = (typeof reportCategories)[number];

export const reportResolutions = [
  "dismissed",
  "image-hidden",
  "image-deleted",
] as const;
export type ReportResolution = (typeof reportResolutions)[number];

export const reports = sqliteTable(
  "reports",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    imageId: text("image_id")
      .notNull()
      .references(() => images.imageId, { onDelete: "cascade" }),
    category: text("category", { enum: reportCategories }).notNull(),
    // For category === "other"; max 250 chars enforced in the application layer.
    message: text("message"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    resolvedAt: integer("resolved_at", { mode: "timestamp" }),
    resolvedAction: text("resolved_action", { enum: reportResolutions }),
  },
  (t) => [
    index("idx_reports_image").on(t.imageId),
    index("idx_reports_created").on(t.createdAt),
    // Partial index for the hot path: "is this image hidden?"
    index("idx_reports_unresolved").on(t.imageId).where(sql`${t.resolvedAt} IS NULL`),
    // Dedup unresolved reports by (image_id, category). Scoped to open rows so
    // resolving a report lets the same category be reopened later.
    uniqueIndex("idx_reports_dedup_open")
      .on(t.imageId, t.category)
      .where(sql`${t.resolvedAt} IS NULL`),
    // (0007) Admin queue: open reports newest-first. DESC + partial keeps it
    // tiny and lets the queue page skip a sort.
    index("idx_reports_pending_recent")
      .on(sql`${t.createdAt} DESC`)
      .where(sql`${t.resolvedAt} IS NULL`),
    // (0008) SQL-level enum CHECK constraints — see same note on images.
    check(
      "reports_category_check",
      sql`${t.category} IN ('low-resolution', 'blurry', 'bug-too-small', 'hard-to-see', 'spooky', 'cropped', 'ai-generated', 'zoomed-out', 'wheres-the-bug', 'other')`,
    ),
    check(
      "reports_resolved_action_check",
      sql`${t.resolvedAction} IS NULL OR ${t.resolvedAction} IN ('dismissed', 'image-hidden', 'image-deleted')`,
    ),
  ],
);

// ──────────────────────────── species_metadata ─────────────

/**
 * Per-species cache for expensive external lookups. Currently holds a
 * "does Sketchfab have any 3D models for this species?" flag populated by
 * scripts/sketchfab_enrichment.py (cron). Keyed on the same taxon_species
 * string used in the images table; one row per distinct species.
 *
 * Nullable booleans:
 *   - hasSketchfabModels: null = never checked; true/false = checked result.
 *     UI treats null as "unknown — show button optimistically".
 */
export const speciesMetadata = sqliteTable(
  "species_metadata",
  {
    taxonSpecies: text("taxon_species").primaryKey(),
    hasSketchfabModels: integer("has_sketchfab_models", { mode: "boolean" }),
    sketchfabHitCount: integer("sketchfab_hit_count"),
    sketchfabLastCheckedAt: integer("sketchfab_last_checked_at", { mode: "timestamp" }),
  },
  (t) => [
    index("idx_species_metadata_sketchfab_checked").on(t.sketchfabLastCheckedAt),
  ],
);

// ──────────────────────────── generated types ──────────────────

export type Image = typeof images.$inferSelect;
export type NewImage = typeof images.$inferInsert;
export type Report = typeof reports.$inferSelect;
export type NewReport = typeof reports.$inferInsert;
export type SpeciesMetadata = typeof speciesMetadata.$inferSelect;
export type NewSpeciesMetadata = typeof speciesMetadata.$inferInsert;
