-- (a) unique source identity: prevents the fetcher from double-inserting the
--     same upstream image under different image_ids.
CREATE UNIQUE INDEX `idx_images_source_source_id` ON `images` (`source`, `source_id`);
--> statement-breakpoint
-- (b) composite index for the common gallery WHERE + ORDER BY (hidden=0 plus a
--     subject_state filter is the hot path on /api/gallery/page).
CREATE INDEX `idx_images_hidden_subject_state` ON `images` (`hidden`, `subject_state`);
--> statement-breakpoint
-- (c) admin queue: list unresolved reports ordered by created_at DESC. Partial
--     index keeps it small.
CREATE INDEX `idx_reports_pending_recent` ON `reports` (`created_at` DESC) WHERE `resolved_at` IS NULL;
--> statement-breakpoint
-- (d) raw_metadata JSON validity / enum CHECK constraints intentionally NOT
--     added here. CHECK constraints require a SQLite table rebuild and the TS
--     enum already enforces these at the application layer. See db/schema.ts
--     for the TODO marker.
