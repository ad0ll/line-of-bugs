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
import { integer, sqliteTable, text, index, uniqueIndex } from "drizzle-orm/sqlite-core";

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
  ],
);

// ──────────────────────────── reports ──────────────────────────

export const reportCategories = [
  "low-resolution",
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
  ],
);

// ──────────────────────────── generated types ──────────────────

export type Image = typeof images.$inferSelect;
export type NewImage = typeof images.$inferInsert;
export type Report = typeof reports.$inferSelect;
export type NewReport = typeof reports.$inferInsert;
