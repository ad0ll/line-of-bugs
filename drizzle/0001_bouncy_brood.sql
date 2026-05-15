ALTER TABLE `images` ADD `hidden` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_images_hidden` ON `images` (`hidden`);