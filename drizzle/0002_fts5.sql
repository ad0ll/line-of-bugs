-- FTS5 virtual table for fast species autocomplete.
-- Idempotent — safe to re-run (uses IF NOT EXISTS).

CREATE VIRTUAL TABLE IF NOT EXISTS images_fts USING fts5(
  image_id UNINDEXED,
  common_name,
  taxon_species,
  tokenize = 'unicode61 remove_diacritics 2'
);
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS images_fts_insert AFTER INSERT ON images BEGIN
  INSERT INTO images_fts(image_id, common_name, taxon_species)
  VALUES (new.image_id, new.common_name, new.taxon_species);
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS images_fts_delete AFTER DELETE ON images BEGIN
  DELETE FROM images_fts WHERE image_id = old.image_id;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS images_fts_update AFTER UPDATE ON images BEGIN
  DELETE FROM images_fts WHERE image_id = old.image_id;
  INSERT INTO images_fts(image_id, common_name, taxon_species)
  VALUES (new.image_id, new.common_name, new.taxon_species);
END;
--> statement-breakpoint
-- Backfill only if FTS5 table is empty
INSERT INTO images_fts(image_id, common_name, taxon_species)
SELECT image_id, common_name, taxon_species FROM images
WHERE NOT EXISTS (SELECT 1 FROM images_fts LIMIT 1);
