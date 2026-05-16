-- Prevent duplicate unresolved reports for the same (image_id, category) pair.
-- The plan originally referenced a session_id column we never shipped; the
-- closest practical dedup with the current schema is on category so that the
-- same image can't accumulate multiple "cropped" or "low-resolution" reports
-- before an admin acts. SQLite supports partial unique indexes, scoped here to
-- unresolved rows so a future resolved+reopened pair stays allowed.

CREATE UNIQUE INDEX `idx_reports_dedup_open` ON `reports` (`image_id`, `category`) WHERE `resolved_at` IS NULL;
