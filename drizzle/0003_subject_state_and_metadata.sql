-- Round 4 schema migration:
--   * Rename subject_type → subject_state and expand enum:
--       nature   → wild
--       specimen → specimen   (unchanged)
--       (new value `captive` reserved for future iNat captive=true imports)
--   * Add new metadata columns (all nullable; backfilled by
--     scripts/backfill_metadata.py and going-forward fetcher writes).
--   * Add indexes for license + viewLabel + lifeStage + sex
--     (used by upcoming gallery + home filters).
--
-- Hand-written rather than drizzle-kit generated because the rename
-- needs a data-preserving CASE mapping that drizzle's diff can't infer.

-- 1. Add the new columns. All start nullable; subject_state is filled
--    immediately below so application code can rely on it being non-null.
ALTER TABLE `images` ADD `subject_state` text;--> statement-breakpoint
ALTER TABLE `images` ADD `life_stage` text;--> statement-breakpoint
ALTER TABLE `images` ADD `sex` text;--> statement-breakpoint
ALTER TABLE `images` ADD `host_organism` text;--> statement-breakpoint
ALTER TABLE `images` ADD `specimen_condition` text;--> statement-breakpoint
ALTER TABLE `images` ADD `raw_metadata` text;--> statement-breakpoint

-- 2. Migrate values from the old column.
UPDATE `images` SET `subject_state` = CASE `subject_type`
  WHEN 'nature' THEN 'wild'
  WHEN 'specimen' THEN 'specimen'
  ELSE 'wild'
END;--> statement-breakpoint

-- 3. Drop the old index BEFORE the column — SQLite errors if a
--    DROP COLUMN leaves any index referencing the removed column.
DROP INDEX IF EXISTS `idx_images_subject_type`;--> statement-breakpoint

-- 4. Drop the old column (SQLite ≥3.35).
ALTER TABLE `images` DROP COLUMN `subject_type`;--> statement-breakpoint

-- 5. New indexes.
CREATE INDEX `idx_images_subject_state` ON `images` (`subject_state`);--> statement-breakpoint
CREATE INDEX `idx_images_license` ON `images` (`license`);--> statement-breakpoint
CREATE INDEX `idx_images_view_label` ON `images` (`view_label`);--> statement-breakpoint
CREATE INDEX `idx_images_life_stage` ON `images` (`life_stage`);--> statement-breakpoint
CREATE INDEX `idx_images_sex` ON `images` (`sex`);
