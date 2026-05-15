CREATE TABLE `images` (
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
	`subject_type` text NOT NULL,
	`view_label` text,
	`description` text,
	`captured_date` text,
	`added_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_images_species` ON `images` (`taxon_species`);--> statement-breakpoint
CREATE INDEX `idx_images_common` ON `images` (`common_name`);--> statement-breakpoint
CREATE INDEX `idx_images_collection` ON `images` (`collection_id`);--> statement-breakpoint
CREATE INDEX `idx_images_source` ON `images` (`source`);--> statement-breakpoint
CREATE INDEX `idx_images_subject_type` ON `images` (`subject_type`);--> statement-breakpoint
CREATE INDEX `idx_images_institution` ON `images` (`institution`);--> statement-breakpoint
CREATE INDEX `idx_images_taxon_order` ON `images` (`taxon_order`);--> statement-breakpoint
CREATE INDEX `idx_images_sha256` ON `images` (`file_sha256`);--> statement-breakpoint
CREATE TABLE `reports` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`image_id` text NOT NULL,
	`category` text NOT NULL,
	`message` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`resolved_at` integer,
	`resolved_action` text,
	FOREIGN KEY (`image_id`) REFERENCES `images`(`image_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_reports_image` ON `reports` (`image_id`);--> statement-breakpoint
CREATE INDEX `idx_reports_created` ON `reports` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_reports_unresolved` ON `reports` (`image_id`) WHERE "reports"."resolved_at" IS NULL;