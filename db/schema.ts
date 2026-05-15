/**
 * Drizzle schema — single source of truth for the SQLite database.
 *
 * Tables:
 *   • images   — one row per fetched image (5K+ now, target 10K+).
 *                Populated from data/manifest/<source>.csv by db/seed.ts.
 *   • reports  — user-submitted "this image shouldn't be here" reports.
 *                An image is hidden from the session pool iff it has at
 *                least one unresolved report. Admin reviews and resolves.
 *
 * Generated types are exported below for use throughout the app.
 */
import { sql } from "drizzle-orm";
import { integer, sqliteTable, text, index } from "drizzle-orm/sqlite-core";

// ──────────────────────────── images ────────────────────────────

export const subjectTypes = ["nature", "specimen"] as const;
export type SubjectType = (typeof subjectTypes)[number];

export const sources = ["inaturalist", "bugwood", "smithsonian", "usda-ars"] as const;
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
    // 1024-max-edge JPEG q88 — used by gallery hover preview to limit
    // bandwidth (especially for the EU-served deployment).
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

    // Classification
    subjectType: text("subject_type", { enum: subjectTypes }).notNull(),
    viewLabel: text("view_label"),

    // Context
    description: text("description"),
    capturedDate: text("captured_date"),

    // Bookkeeping
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
    index("idx_images_subject_type").on(t.subjectType),
    index("idx_images_institution").on(t.institution),
    index("idx_images_taxon_order").on(t.taxonOrder),
    // Non-unique: same content may exist under different image_ids
    // (e.g., one photographer's image pulled via both iNat and Bugwood).
    // The manifest already dedups by image_id; sha256 here is for audit only.
    index("idx_images_sha256").on(t.fileSha256),
  ],
);

// ──────────────────────────── reports ──────────────────────────

export const reportCategories = [
  "low-resolution",
  "spooky",
  "cropped",
  "ai-generated",
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
  ],
);

// ──────────────────────────── generated types ──────────────────

export type Image = typeof images.$inferSelect;
export type NewImage = typeof images.$inferInsert;
export type Report = typeof reports.$inferSelect;
export type NewReport = typeof reports.$inferInsert;
