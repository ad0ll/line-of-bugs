-- R6: layperson taxonomy filter.
-- Adds the taxon_subgroup column + its index. The column is populated
-- separately by scripts/backfill_taxon_subgroup.py (one-shot) and going
-- forward by the fetchers at write time.

ALTER TABLE `images` ADD `taxon_subgroup` text;--> statement-breakpoint
CREATE INDEX `idx_images_taxon_subgroup` ON `images` (`taxon_subgroup`);
