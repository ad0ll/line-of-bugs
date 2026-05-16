-- Expand reports.category enum to add three new layperson-friendly options
-- the user requested: 'blurry', 'bug-too-small', 'hard-to-see'. Existing
-- 'low-resolution' stays (it overlaps slightly with 'blurry' but the user
-- chose to keep both so existing reports remain meaningful).
--
-- SQLite cannot alter a CHECK constraint in place; same table-rebuild dance
-- as 0008.

PRAGMA defer_foreign_keys = ON;
--> statement-breakpoint

CREATE TABLE reports_new (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `image_id` text NOT NULL,
  `category` text NOT NULL,
  `message` text,
  `created_at` integer DEFAULT (unixepoch()) NOT NULL,
  `resolved_at` integer,
  `resolved_action` text,
  FOREIGN KEY (`image_id`) REFERENCES `images`(`image_id`) ON UPDATE no action ON DELETE cascade,
  CONSTRAINT `reports_category_check` CHECK (`category` IN ('low-resolution', 'blurry', 'bug-too-small', 'hard-to-see', 'spooky', 'cropped', 'ai-generated', 'zoomed-out', 'wheres-the-bug', 'other')),
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

INSERT OR REPLACE INTO sqlite_sequence (name, seq)
  SELECT 'reports', COALESCE((SELECT MAX(id) FROM reports), 0);
--> statement-breakpoint

CREATE INDEX `idx_reports_image` ON `reports` (`image_id`);
--> statement-breakpoint
CREATE INDEX `idx_reports_created` ON `reports` (`created_at`);
--> statement-breakpoint
CREATE INDEX `idx_reports_unresolved` ON `reports` (`image_id`) WHERE `resolved_at` IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_reports_dedup_open` ON `reports` (`image_id`, `category`) WHERE `resolved_at` IS NULL;
--> statement-breakpoint
CREATE INDEX `idx_reports_open_queue` ON `reports` (`created_at` DESC) WHERE `resolved_at` IS NULL;
