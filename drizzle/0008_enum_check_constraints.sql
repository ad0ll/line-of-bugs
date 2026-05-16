-- Add SQL-level CHECK constraints on enum columns to backstop the TS enums in
-- db/schema.ts. Belt-and-braces: app code already validates, but a constraint at
-- the storage layer prevents drift from raw inserts, manual SQL, or future code
-- paths that bypass the ORM.
--
-- Columns and valid values (mirrors db/schema.ts):
--   images.source         → 'inaturalist', 'bugwood'                                    (NOT NULL)
--   images.subject_state  → 'wild', 'captive', 'specimen'                               (NOT NULL)
--   images.life_stage     → 'adult', 'nymph', 'larva', 'pupa',
--                           'egg', 'cocoon', 'juvenile', 'unknown'                      (NULL allowed)
--   images.sex            → 'male', 'female', 'worker', 'unknown'                       (NULL allowed)
--   reports.category      → 'low-resolution', 'spooky', 'cropped', 'ai-generated',
--                           'zoomed-out', 'wheres-the-bug', 'other'                     (NOT NULL)
--   reports.resolved_action → 'dismissed', 'image-hidden', 'image-deleted'              (NULL allowed)
--
-- SQLite cannot add CHECK constraints in place, so we use the table-rebuild dance
-- (same shape as 0005_subject_state_notnull.sql).
--
-- Foreign keys are deferred for the rebuild so we can drop+rename the parent
-- without cascading the children. PRAGMA defer_foreign_keys is per-transaction.

PRAGMA defer_foreign_keys = ON;
--> statement-breakpoint

-- ───────────────────────── images rebuild ─────────────────────────

CREATE TABLE images_new (
  `image_id` text PRIMARY KEY NOT NULL,
  `collection_id` text NOT NULL,
  `source` text NOT NULL,
  `source_id` text NOT NULL,
  `source_page_url` text NOT NULL,
  `image_url` text NOT NULL,
  `filename` text NOT NULL,
  `thumbnail_filename` text NOT NULL,
  `medium_filename` text NOT NULL,
  `file_size_bytes` integer,
  `file_sha256` text NOT NULL,
  `width` integer,
  `height` integer,
  `license` text NOT NULL,
  `license_url` text,
  `photographer_attribution` text,
  `photographer` text,
  `institution` text,
  `taxon_order` text,
  `taxon_species` text,
  `common_name` text,
  `view_label` text,
  `description` text,
  `captured_date` text,
  `added_at` integer DEFAULT (unixepoch()) NOT NULL,
  `hidden` integer DEFAULT false NOT NULL,
  `subject_state` text NOT NULL,
  `life_stage` text,
  `sex` text,
  `host_organism` text,
  `specimen_condition` text,
  `raw_metadata` text,
  `taxon_subgroup` text,
  CONSTRAINT `images_source_check` CHECK (`source` IN ('inaturalist', 'bugwood')),
  CONSTRAINT `images_subject_state_check` CHECK (`subject_state` IN ('wild', 'captive', 'specimen')),
  CONSTRAINT `images_life_stage_check` CHECK (`life_stage` IS NULL OR `life_stage` IN ('adult', 'nymph', 'larva', 'pupa', 'egg', 'cocoon', 'juvenile', 'unknown')),
  CONSTRAINT `images_sex_check` CHECK (`sex` IS NULL OR `sex` IN ('male', 'female', 'worker', 'unknown'))
);
--> statement-breakpoint
INSERT INTO images_new (
  image_id, collection_id, source, source_id, source_page_url, image_url,
  filename, thumbnail_filename, medium_filename, file_size_bytes, file_sha256,
  width, height, license, license_url, photographer_attribution, photographer,
  institution, taxon_order, taxon_species, common_name, view_label, description,
  captured_date, added_at, hidden, subject_state, life_stage, sex, host_organism,
  specimen_condition, raw_metadata, taxon_subgroup
)
SELECT
  image_id, collection_id, source, source_id, source_page_url, image_url,
  filename, thumbnail_filename, medium_filename, file_size_bytes, file_sha256,
  width, height, license, license_url, photographer_attribution, photographer,
  institution, taxon_order, taxon_species, common_name, view_label, description,
  captured_date, added_at, hidden, subject_state, life_stage, sex, host_organism,
  specimen_condition, raw_metadata, taxon_subgroup
FROM images;
--> statement-breakpoint
DROP TABLE images;
--> statement-breakpoint
ALTER TABLE images_new RENAME TO images;
--> statement-breakpoint

-- Recreate every index that DROP TABLE removed.
CREATE INDEX `idx_images_species` ON `images` (`taxon_species`);
--> statement-breakpoint
CREATE INDEX `idx_images_common` ON `images` (`common_name`);
--> statement-breakpoint
CREATE INDEX `idx_images_collection` ON `images` (`collection_id`);
--> statement-breakpoint
CREATE INDEX `idx_images_source` ON `images` (`source`);
--> statement-breakpoint
CREATE INDEX `idx_images_institution` ON `images` (`institution`);
--> statement-breakpoint
CREATE INDEX `idx_images_taxon_order` ON `images` (`taxon_order`);
--> statement-breakpoint
CREATE INDEX `idx_images_sha256` ON `images` (`file_sha256`);
--> statement-breakpoint
CREATE INDEX `idx_images_hidden` ON `images` (`hidden`);
--> statement-breakpoint
CREATE INDEX `idx_images_subject_state` ON `images` (`subject_state`);
--> statement-breakpoint
CREATE INDEX `idx_images_license` ON `images` (`license`);
--> statement-breakpoint
CREATE INDEX `idx_images_view_label` ON `images` (`view_label`);
--> statement-breakpoint
CREATE INDEX `idx_images_life_stage` ON `images` (`life_stage`);
--> statement-breakpoint
CREATE INDEX `idx_images_sex` ON `images` (`sex`);
--> statement-breakpoint
CREATE INDEX `idx_images_taxon_subgroup` ON `images` (`taxon_subgroup`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_images_source_source_id` ON `images` (`source`, `source_id`);
--> statement-breakpoint
CREATE INDEX `idx_images_hidden_subject_state` ON `images` (`hidden`, `subject_state`);
--> statement-breakpoint

-- Recreate FTS5 sync triggers (DROP TABLE images removed them).
CREATE TRIGGER images_fts_insert AFTER INSERT ON images BEGIN
  INSERT INTO images_fts(image_id, common_name, taxon_species)
  VALUES (new.image_id, new.common_name, new.taxon_species);
END;
--> statement-breakpoint
CREATE TRIGGER images_fts_delete AFTER DELETE ON images BEGIN
  DELETE FROM images_fts WHERE image_id = old.image_id;
END;
--> statement-breakpoint
CREATE TRIGGER images_fts_update AFTER UPDATE ON images BEGIN
  DELETE FROM images_fts WHERE image_id = old.image_id;
  INSERT INTO images_fts(image_id, common_name, taxon_species)
  VALUES (new.image_id, new.common_name, new.taxon_species);
END;
--> statement-breakpoint

-- ───────────────────────── reports rebuild ────────────────────────

CREATE TABLE reports_new (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `image_id` text NOT NULL,
  `category` text NOT NULL,
  `message` text,
  `created_at` integer DEFAULT (unixepoch()) NOT NULL,
  `resolved_at` integer,
  `resolved_action` text,
  FOREIGN KEY (`image_id`) REFERENCES `images`(`image_id`) ON UPDATE no action ON DELETE cascade,
  CONSTRAINT `reports_category_check` CHECK (`category` IN ('low-resolution', 'spooky', 'cropped', 'ai-generated', 'zoomed-out', 'wheres-the-bug', 'other')),
  CONSTRAINT `reports_resolved_action_check` CHECK (`resolved_action` IS NULL OR `resolved_action` IN ('dismissed', 'image-hidden', 'image-deleted'))
);
--> statement-breakpoint
INSERT INTO reports_new (id, image_id, category, message, created_at, resolved_at, resolved_action)
SELECT id, image_id, category, message, created_at, resolved_at, resolved_action
FROM reports;
--> statement-breakpoint
DROP TABLE reports;
--> statement-breakpoint
ALTER TABLE reports_new RENAME TO reports;
--> statement-breakpoint

-- Preserve sqlite_sequence so the next AUTOINCREMENT id continues from where
-- the previous reports table left off. Without this, INSERT into the rebuilt
-- table would reset the sequence to MAX(id)+1, which is fine functionally but
-- diverges from "lossless rebuild" intent.
INSERT OR REPLACE INTO sqlite_sequence (name, seq)
  SELECT 'reports', COALESCE((SELECT MAX(id) FROM reports), 0);
--> statement-breakpoint

-- Recreate every index on reports that DROP TABLE removed.
CREATE INDEX `idx_reports_image` ON `reports` (`image_id`);
--> statement-breakpoint
CREATE INDEX `idx_reports_created` ON `reports` (`created_at`);
--> statement-breakpoint
CREATE INDEX `idx_reports_unresolved` ON `reports` (`image_id`) WHERE `resolved_at` IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_reports_dedup_open` ON `reports` (`image_id`, `category`) WHERE `resolved_at` IS NULL;
--> statement-breakpoint
CREATE INDEX `idx_reports_pending_recent` ON `reports` (`created_at` DESC) WHERE `resolved_at` IS NULL;
