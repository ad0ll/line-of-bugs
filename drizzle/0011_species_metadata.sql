-- Per-species metadata, primarily for caching expensive external lookups
-- (currently: Sketchfab "are there any models for this species?" flag).
-- Keyed by taxon_species (the same string used in the images table). One
-- row per distinct species; populated by scripts/sketchfab_enrichment.py.
CREATE TABLE `species_metadata` (
  `taxon_species` text PRIMARY KEY NOT NULL,
  -- Sketchfab Data API v3 — pre-checked "is there ≥1 relevant model?"
  -- Null when never checked; 0/1 when checked. NULL => unknown, treat
  -- as true in the UI to avoid hiding a feature for unchecked rows.
  `has_sketchfab_models` integer,
  `sketchfab_hit_count` integer,
  `sketchfab_last_checked_at` integer
);
--> statement-breakpoint

CREATE INDEX `idx_species_metadata_sketchfab_checked`
  ON `species_metadata` (`sketchfab_last_checked_at`);
