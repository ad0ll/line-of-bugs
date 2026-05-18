-- Content filtering data layer (plan 1, design 2026-05-17).
-- Five tables that move label storage out of labels.json into SQLite,
-- cache ML pipeline outputs, and store one precomputed gate decision
-- per image for the production gallery + session pool to read.

CREATE TABLE `image_labels` (
  `image_id`    text PRIMARY KEY NOT NULL REFERENCES `images`(`image_id`) ON DELETE CASCADE,
  `col1`        text,
  `col2_count`  text,
  `col2_flags`  text,
  `col3`        text,
  `col4`        text,
  `unsure`      integer NOT NULL DEFAULT 0 CHECK (`unsure` IN (0, 1)),
  `reviewed_at` integer,
  `user_edited` integer NOT NULL DEFAULT 0 CHECK (`user_edited` IN (0, 1)),
  `variant_tag` text
);
--> statement-breakpoint
CREATE INDEX `idx_image_labels_reviewed`
  ON `image_labels` (`reviewed_at`)
  WHERE `reviewed_at` IS NOT NULL;
--> statement-breakpoint

CREATE TABLE `detections` (
  `image_id`               text PRIMARY KEY NOT NULL REFERENCES `images`(`image_id`) ON DELETE CASCADE,
  `variant`                text NOT NULL,
  `suggested_labels`       text NOT NULL,
  `gate_rule_only`         text NOT NULL CHECK (`gate_rule_only` IN ('keep', 'reject')),
  `has_bbox`               integer NOT NULL CHECK (`has_bbox` IN (0, 1)),
  `bbox_x`                 real,
  `bbox_y`                 real,
  `bbox_w`                 real,
  `bbox_h`                 real,
  `mask_area_ratio`        real,
  `lab_delta_e`            real,
  `boundary_sharpness`     real,
  `mask_iou_score`         real,
  `crop_x`                 real,
  `crop_y`                 real,
  `crop_w`                 real,
  `crop_h`                 real,
  `post_crop_subject_area` real,
  `processed_at`           integer NOT NULL,
  `schema_version`         integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_detections_variant` ON `detections` (`variant`);
--> statement-breakpoint
CREATE INDEX `idx_detections_has_bbox` ON `detections` (`has_bbox`);
--> statement-breakpoint

CREATE TABLE `predictions` (
  `image_id`      text NOT NULL REFERENCES `images`(`image_id`) ON DELETE CASCADE,
  `label`         text NOT NULL,
  `p`             real NOT NULL,
  `unreliable`    integer NOT NULL DEFAULT 0 CHECK (`unreliable` IN (0, 1)),
  `model_version` text NOT NULL,
  `predicted_at`  integer NOT NULL,
  PRIMARY KEY (`image_id`, `label`)
);
--> statement-breakpoint
CREATE INDEX `idx_predictions_label_p` ON `predictions` (`label`, `p`);
--> statement-breakpoint

CREATE TABLE `gate_decisions` (
  `image_id`      text PRIMARY KEY NOT NULL REFERENCES `images`(`image_id`) ON DELETE CASCADE,
  `decision`      text NOT NULL CHECK (`decision` IN ('keep', 'reject')),
  `reason`        text NOT NULL,
  `reason_source` text NOT NULL CHECK (`reason_source` IN ('hand', 'report', 'rule', 'ml', 'default')),
  `computed_at`   integer NOT NULL,
  `model_version` text,
  `threshold_v`   integer
);
--> statement-breakpoint
CREATE INDEX `idx_gate_decisions_decision` ON `gate_decisions` (`decision`);
--> statement-breakpoint
CREATE INDEX `idx_gate_decisions_reason_source` ON `gate_decisions` (`reason_source`);
--> statement-breakpoint

CREATE TABLE `label_thresholds` (
  `label`               text PRIMARY KEY NOT NULL,
  `tier`                integer NOT NULL CHECK (`tier` IN (1, 2)),
  `threshold`           real NOT NULL,
  `suggested_threshold` real,
  `threshold_v`         integer NOT NULL,
  `notes`               text,
  `updated_at`          integer NOT NULL
);
--> statement-breakpoint

-- Seed: one row for the only tier-1 label that has a trained model today.
-- threshold=0.5 is a conservative initial (ML will gate at p>=0.5).
-- threshold_v starts at 1; bumped any time a human edits `threshold`.
-- suggested_threshold is NULL until train.py writes the recall-≥-0.95 value.
INSERT INTO `label_thresholds` (
  `label`, `tier`, `threshold`, `suggested_threshold`,
  `threshold_v`, `notes`, `updated_at`
)
VALUES (
  'mask_blur_unusable', 1, 0.5, NULL,
  1, 'Initial seed from 0013_content_filtering_tables.sql', unixepoch()
);
