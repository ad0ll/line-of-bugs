-- Tighten subject_state to NOT NULL. ALTER TABLE in SQLite cannot add NOT NULL
-- directly, so we use the standard table-rebuild dance. Column list mirrors
-- the live schema as observed via `sqlite3 data/db/line-of-bugs.db ".schema images"`.
-- Backfill any stragglers first (defensive; the live DB already has 0 nulls).

UPDATE images SET subject_state = 'wild' WHERE subject_state IS NULL;
--> statement-breakpoint
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
  `taxon_subgroup` text
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
-- Recreate indexes (DROP TABLE removed them).
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
