# Content Filtering Data Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 5 SQLite tables that turn ML predictions, rule outputs, hand labels, and user reports into one per-image keep/reject decision the production app can read.

**Architecture:** New tables (`image_labels`, `detections`, `predictions`, `gate_decisions`, `label_thresholds`) land via Drizzle migration. Python sync modules push from the parquet ML working store into SQLite. A `recompute_gate.py` module implements a strict trust hierarchy (hand > report > rule > ML > default) and writes a precomputed `gate_decisions` row per image. The frontend filter change (plan 2) reads that table.

**Tech Stack:** SQLite (better-sqlite3 / sqlite3), Drizzle ORM, Python 3.13, polars + pyarrow, pytest.

**Spec:** `docs/superpowers/specs/2026-05-17-content-filtering-design.md`

**Conventions to follow:**
- All schema changes go through `drizzle/000N_*.sql` + matching journal entry. Never raw SQL on the live DB. (CLAUDE.md)
- Verify each migration against a copy of the DB before committing.
- Commit with `--no-gpg-sign`. Use explicit `git add <file>` and `git commit --only -- <files>` (parallel agents may stage other files).
- Files that are written once and discarded: drop them after the run lands.
- camelCase in TS, snake_case in SQL.
- Python tests under `tests/python/`. Use `monkeypatch.setattr` + tmp DB pattern from `test_db_writer.py`.

---

## File structure

**Created Python (sources):**
- `scripts/detect_subjects/sqlite_db.py` — connection factory with PRAGMA setup
- `scripts/detect_subjects/image_labels_io.py` — read/write `image_labels`
- `scripts/detect_subjects/detections_sync.py` — parquet → `detections` upserts
- `scripts/detect_subjects/predictions_sync.py` — parquet → `predictions` upserts
- `scripts/detect_subjects/recompute_gate.py` — trust hierarchy + CLI
- `scripts/migrate_labels_to_sqlite.py` — one-shot migration (deleted post-run)

**Created SQL:**
- `drizzle/0013_content_filtering_tables.sql`

**Modified:**
- `db/schema.ts` — add 5 sqliteTable defs + types
- `drizzle/meta/_journal.json` — add 0013 entry
- `scripts/detect_subjects/ml_labeler/train.py` — `_load_xy_for_label` reads SQLite
- `scripts/detect_subjects/ml_labeler/predict.py` — post-write calls sync + recompute
- `scripts/detect_subjects/classify.py` — post-loop calls `sync_detections_from_parquet`
- `scripts/detect_subjects/label_server.py` — read/write image_labels; recompute per image

**Created Python (tests):**
- `tests/python/test_sqlite_db.py`
- `tests/python/test_image_labels_io.py`
- `tests/python/test_detections_sync.py`
- `tests/python/test_predictions_sync.py`
- `tests/python/test_recompute_gate.py`
- `tests/python/test_migrate_labels_to_sqlite.py`

**Modified tests:**
- `tests/python/test_ml_labeler_train.py` — fixture now writes labels into SQLite, not labels.json

---

## Task sequencing

Tasks land in this order because of dependencies:

1. Schema first — every other task uses the tables
2. Helpers (`sqlite_db.py`, `image_labels_io.py`) — used by sync, gate, train, label_server
3. One-shot migration script (labels.json → image_labels) — required before train.py can read SQLite
4. Sync modules (detections, predictions) + recompute_gate
5. Wire ML pipeline to SQLite (train, predict, classify)
6. Wire label_server.py to SQLite (last — it stops the in-flight autosnapshot thread)
7. Operate: run migration, backfill `gate_decisions`, delete one-shot script

---

## Task 1: Add Drizzle schema for 5 content-filtering tables

**Files:**
- Modify: `db/schema.ts` (append 5 sqliteTable defs + types)
- Create: `drizzle/0013_content_filtering_tables.sql`
- Modify: `drizzle/meta/_journal.json` (add 0013 entry, idx=13)

**Background for the engineer:**
The existing pattern is: declare the table in `db/schema.ts` (TypeScript, drizzle-orm), then mirror it in a `drizzle/000N_*.sql` migration file with backticked identifiers. Statements are separated by `--> statement-breakpoint`. The journal at `drizzle/meta/_journal.json` lists every migration in order — incrementing `idx`, version `"6"`, current millisecond `when`, descriptive `tag`. See `drizzle/0011_species_metadata.sql` + the `speciesMetadata` block in `schema.ts` for the canonical reference.

- [ ] **Step 1: Add 5 new sqliteTable definitions to `db/schema.ts`**

Append AFTER the `speciesMetadata` block, BEFORE the `// generated types` divider:

```typescript
// ──────────────────────────── image_labels ─────────────────

/**
 * Hand-labels from the validator UI (replaces data/cache/labels.json,
 * post-migration). One row per labeled image. JSON-typed columns hold
 * arrays serialized as TEXT — Python reads/writes via json.loads.
 *
 * reviewed_at is unix epoch MILLISECONDS (matches the validator's
 * Date.now() output, kept for round-trip compatibility with the
 * legacy labels.json snapshots).
 */
export const imageLabels = sqliteTable(
  "image_labels",
  {
    imageId: text("image_id")
      .primaryKey()
      .references(() => images.imageId, { onDelete: "cascade" }),
    col1: text("col1"),               // e.g., bbox_correct-subject_not-clipped
    col2Count: text("col2_count"),    // e.g., bbox-content_single
    col2Flags: text("col2_flags"),    // JSON array of strings
    col3: text("col3"),               // JSON array of mask labels
    col4: text("col4"),               // JSON array of ml labels
    unsure: integer("unsure").notNull().default(0),
    reviewedAt: integer("reviewed_at"),         // unix epoch ms
    userEdited: integer("user_edited").notNull().default(0),
    variantTag: text("variant_tag"),
  },
  (t) => [
    index("idx_image_labels_reviewed")
      .on(t.reviewedAt)
      .where(sql`${t.reviewedAt} IS NOT NULL`),
    check("image_labels_unsure_check", sql`${t.unsure} IN (0, 1)`),
    check("image_labels_user_edited_check", sql`${t.userEdited} IN (0, 1)`),
  ],
);

// ──────────────────────────── detections ───────────────────

/**
 * Per-image sync target from framing_detections.parquet. Latest-variant-
 * wins on upsert (ordered by processed_at desc when the parquet holds
 * multiple variants for the same image_id). Holds rule output, bbox,
 * mask scalars, and recommended crop coords. Frontend may render
 * cropped previews via these coords.
 *
 * gate_rule_only is the legacy per-row rule decision; the new full
 * hierarchical decision lives in gate_decisions.
 */
export const detections = sqliteTable(
  "detections",
  {
    imageId: text("image_id")
      .primaryKey()
      .references(() => images.imageId, { onDelete: "cascade" }),
    variant: text("variant").notNull(),
    suggestedLabels: text("suggested_labels").notNull(),  // JSON array
    gateRuleOnly: text("gate_rule_only").notNull(),
    hasBbox: integer("has_bbox").notNull(),
    bboxX: integer("bbox_x", { mode: "number" }),
    bboxY: integer("bbox_y", { mode: "number" }),
    bboxW: integer("bbox_w", { mode: "number" }),
    bboxH: integer("bbox_h", { mode: "number" }),
    maskAreaRatio: integer("mask_area_ratio", { mode: "number" }),
    labDeltaE: integer("lab_delta_e", { mode: "number" }),
    boundarySharpness: integer("boundary_sharpness", { mode: "number" }),
    maskIouScore: integer("mask_iou_score", { mode: "number" }),
    cropX: integer("crop_x", { mode: "number" }),
    cropY: integer("crop_y", { mode: "number" }),
    cropW: integer("crop_w", { mode: "number" }),
    cropH: integer("crop_h", { mode: "number" }),
    postCropSubjectArea: integer("post_crop_subject_area", { mode: "number" }),
    processedAt: integer("processed_at").notNull(),
    schemaVersion: integer("schema_version").notNull(),
  },
  (t) => [
    index("idx_detections_variant").on(t.variant),
    index("idx_detections_has_bbox").on(t.hasBbox),
    check("detections_gate_rule_only_check",
      sql`${t.gateRuleOnly} IN ('keep', 'reject')`),
    check("detections_has_bbox_check", sql`${t.hasBbox} IN (0, 1)`),
  ],
);

// ──────────────────────────── predictions ──────────────────

/**
 * Per-(image, label) ML probability. Sparse — only image_ids with a
 * model that ran appear. model_version is "<label>@<unix_epoch_s>"
 * encoding which retrain produced the row (so a bad model rollout
 * can be rolled back by purging rows with the bad version).
 */
export const predictions = sqliteTable(
  "predictions",
  {
    imageId: text("image_id")
      .notNull()
      .references(() => images.imageId, { onDelete: "cascade" }),
    label: text("label").notNull(),
    p: integer("p", { mode: "number" }).notNull(),
    unreliable: integer("unreliable").notNull().default(0),
    modelVersion: text("model_version").notNull(),
    predictedAt: integer("predicted_at").notNull(),
  },
  (t) => [
    uniqueIndex("idx_predictions_pk").on(t.imageId, t.label),
    index("idx_predictions_label_p").on(t.label, t.p),
    check("predictions_unreliable_check", sql`${t.unreliable} IN (0, 1)`),
  ],
);

// ──────────────────────────── gate_decisions ───────────────

/**
 * Per-image final keep/reject decision after applying the trust
 * hierarchy. Dense — every image has a row after the first full
 * recompute_gate --all backfill. Production query joins on
 * `decision = 'reject'`, so the decision index is load-bearing.
 *
 * reason format examples:
 *   'ml:mask_blur_unusable:0.87'
 *   'rule:bbox-content_no-bug'
 *   'hand:mask:mask_blur_unusable'
 *   'hand:pass'
 *   'report:ai-generated'
 *   'defaults_pass'
 */
export const gateDecisions = sqliteTable(
  "gate_decisions",
  {
    imageId: text("image_id")
      .primaryKey()
      .references(() => images.imageId, { onDelete: "cascade" }),
    decision: text("decision").notNull(),
    reason: text("reason").notNull(),
    reasonSource: text("reason_source").notNull(),
    computedAt: integer("computed_at").notNull(),
    modelVersion: text("model_version"),
    thresholdV: integer("threshold_v"),
  },
  (t) => [
    index("idx_gate_decisions_decision").on(t.decision),
    index("idx_gate_decisions_reason_source").on(t.reasonSource),
    check("gate_decisions_decision_check",
      sql`${t.decision} IN ('keep', 'reject')`),
    check("gate_decisions_reason_source_check",
      sql`${t.reasonSource} IN ('hand', 'report', 'rule', 'ml', 'default')`),
  ],
);

// ──────────────────────────── label_thresholds ────────────

/**
 * Per-label gating config. tier=1 labels with p>=threshold trigger
 * rejection via the ML tier. tier=2 labels are stored in predictions
 * but never gate (they exist so we can promote later without losing
 * historical scores). threshold is human-edited; suggested_threshold
 * is auto-written by train.py based on recall ≥ 0.95 from CV.
 * threshold_v is bumped any time a human edits threshold.
 */
export const labelThresholds = sqliteTable(
  "label_thresholds",
  {
    label: text("label").primaryKey(),
    tier: integer("tier").notNull(),
    threshold: integer("threshold", { mode: "number" }).notNull(),
    suggestedThreshold: integer("suggested_threshold", { mode: "number" }),
    thresholdV: integer("threshold_v").notNull(),
    notes: text("notes"),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    check("label_thresholds_tier_check", sql`${t.tier} IN (1, 2)`),
  ],
);
```

Then add to the `// generated types` section at the bottom:

```typescript
export type ImageLabel = typeof imageLabels.$inferSelect;
export type NewImageLabel = typeof imageLabels.$inferInsert;
export type Detection = typeof detections.$inferSelect;
export type NewDetection = typeof detections.$inferInsert;
export type Prediction = typeof predictions.$inferSelect;
export type NewPrediction = typeof predictions.$inferInsert;
export type GateDecision = typeof gateDecisions.$inferSelect;
export type NewGateDecision = typeof gateDecisions.$inferInsert;
export type LabelThreshold = typeof labelThresholds.$inferSelect;
export type NewLabelThreshold = typeof labelThresholds.$inferInsert;
```

Note: Drizzle's `integer({ mode: "number" })` is the only way to map a SQLite REAL through better-sqlite3 in this codebase pattern. The actual SQL migration uses `REAL` — Drizzle handles the type coercion.

- [ ] **Step 2: Write the migration SQL**

Create `drizzle/0013_content_filtering_tables.sql`:

```sql
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
```

- [ ] **Step 3: Add journal entry**

Modify `drizzle/meta/_journal.json` to append a new entry to the `entries` array:

```json
    {
      "idx": 13,
      "version": "6",
      "when": 1779100000000,
      "tag": "0013_content_filtering_tables",
      "breakpoints": true
    }
```

(The `when` value should be the current time in ms — use a value slightly larger than 0012's `1779000002000`. The exact value doesn't matter for correctness, but it must be monotonically increasing.)

- [ ] **Step 4: Verify migration against a copy of the live DB**

```bash
cp data/db/line-of-bugs.db /tmp/migrate-test-0013.db
DATABASE_URL=/tmp/migrate-test-0013.db npx drizzle-kit migrate
```

Expected output: drizzle reports `0013_content_filtering_tables` applied. Verify the tables exist:

```bash
sqlite3 /tmp/migrate-test-0013.db "
  SELECT name FROM sqlite_master
  WHERE type='table' AND name IN
    ('image_labels','detections','predictions','gate_decisions','label_thresholds')
  ORDER BY name;
"
```

Expected output (5 lines):
```
detections
gate_decisions
image_labels
label_thresholds
predictions
```

Then verify the seed row:

```bash
sqlite3 /tmp/migrate-test-0013.db "SELECT label, tier, threshold, threshold_v FROM label_thresholds;"
```

Expected: `mask_blur_unusable|1|0.5|1`

- [ ] **Step 5: Commit**

```bash
git add db/schema.ts drizzle/0013_content_filtering_tables.sql drizzle/meta/_journal.json
git commit --only --no-gpg-sign -- db/schema.ts drizzle/0013_content_filtering_tables.sql drizzle/meta/_journal.json -m "$(cat <<'EOF'
feat(db): add content filtering tables (image_labels, detections, predictions, gate_decisions, label_thresholds)

Drizzle migration 0013. See docs/superpowers/specs/2026-05-17-content-filtering-design.md
for the design. Seeds label_thresholds with mask_blur_unusable@0.5 so the
first recompute_gate --all has a tier-1 row to evaluate.
EOF
)"
```

---

## Task 2: sqlite_db.py — shared connection factory

**Files:**
- Create: `scripts/detect_subjects/sqlite_db.py`
- Test: `tests/python/test_sqlite_db.py`

**Background:**
Every Python module that talks to SQLite needs the same PRAGMA setup (WAL, foreign_keys ON, busy_timeout). Centralizing it avoids drift. The pattern mirrors `db/index.ts` (TS side) and the PRAGMA block in `scripts/db.py:DbWriter.__init__`.

- [ ] **Step 1: Write the failing test**

Create `tests/python/test_sqlite_db.py`:

```python
"""Connection factory: PRAGMAs land as expected, default path resolves."""
from __future__ import annotations
import sqlite3
import tempfile
from pathlib import Path

import pytest


def test_open_conn_sets_pragmas(tmp_path):
    from scripts.detect_subjects.sqlite_db import open_conn
    db_path = tmp_path / "x.db"
    # Create the file so SQLite has somewhere to set WAL.
    sqlite3.connect(db_path).close()
    conn = open_conn(db_path)
    try:
        assert conn.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
        assert conn.execute("PRAGMA foreign_keys").fetchone()[0] == 1
        assert conn.execute("PRAGMA busy_timeout").fetchone()[0] == 5000
        # synchronous=NORMAL is value 1
        assert conn.execute("PRAGMA synchronous").fetchone()[0] == 1
    finally:
        conn.close()


def test_open_conn_default_path_resolves_to_project_db():
    from scripts.detect_subjects.sqlite_db import DEFAULT_DB_PATH
    assert DEFAULT_DB_PATH.name == "line-of-bugs.db"
    assert DEFAULT_DB_PATH.parent.name == "db"


def test_open_conn_returns_sqlite3_connection(tmp_path):
    from scripts.detect_subjects.sqlite_db import open_conn
    db_path = tmp_path / "y.db"
    sqlite3.connect(db_path).close()
    conn = open_conn(db_path)
    try:
        assert isinstance(conn, sqlite3.Connection)
    finally:
        conn.close()
```

- [ ] **Step 2: Run test to verify it fails**

```bash
.venv/bin/python -m pytest tests/python/test_sqlite_db.py -v
```

Expected: 3 FAIL with `ModuleNotFoundError: No module named 'scripts.detect_subjects.sqlite_db'`.

- [ ] **Step 3: Implement `sqlite_db.py`**

Create `scripts/detect_subjects/sqlite_db.py`:

```python
"""SQLite connection helper for the detect_subjects ML pipeline.

Single source of truth for the PRAGMA set used by every Python module
that opens a connection to data/db/line-of-bugs.db. Mirrors db/index.ts
on the Next.js side and scripts/db.py:DbWriter on the fetcher side.

Convention: every function that takes a `db_path` argument should default
it to None and resolve to `DEFAULT_DB_PATH` at CALL TIME (not as a default
argument value). This makes monkeypatching `DEFAULT_DB_PATH` in tests
actually work — Python binds default-arg values at function-definition
time, so `def f(db: Path = DEFAULT_DB_PATH)` would capture the original
constant and ignore any later monkeypatch.
"""
from __future__ import annotations
import sqlite3
from pathlib import Path
from typing import Optional

ROOT = Path(__file__).resolve().parent.parent.parent
DEFAULT_DB_PATH = ROOT / "data" / "db" / "line-of-bugs.db"


def open_conn(db_path: Optional[Path] = None) -> sqlite3.Connection:
    """Return a sqlite3.Connection with WAL + foreign_keys + busy_timeout
    set. Use this everywhere instead of bare sqlite3.connect()."""
    if db_path is None:
        db_path = DEFAULT_DB_PATH
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA synchronous = NORMAL")
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA busy_timeout = 5000")
    return conn
```

- [ ] **Step 4: Run test to verify it passes**

```bash
.venv/bin/python -m pytest tests/python/test_sqlite_db.py -v
```

Expected: 3 PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/detect_subjects/sqlite_db.py tests/python/test_sqlite_db.py
git commit --only --no-gpg-sign -- scripts/detect_subjects/sqlite_db.py tests/python/test_sqlite_db.py -m "feat(detect_subjects): sqlite_db connection helper with shared PRAGMA setup"
```

---

## Task 3: image_labels_io.py — read/write the image_labels table

**Files:**
- Create: `scripts/detect_subjects/image_labels_io.py`
- Test: `tests/python/test_image_labels_io.py`

**Background:**
The labels.json shape is `{image_id: {col1, col2_count, col2_flags (list), col3 (list), col4 (list), unsure (bool), reviewed_at (ms), user_edited (bool), variant_tag}}`. The SQLite table stores list columns as JSON-encoded TEXT. This module provides three functions: fetch one record, upsert one record, fetch all reviewed records. train.py and label_server.py both consume these.

- [ ] **Step 1: Write the failing test**

Create `tests/python/test_image_labels_io.py`:

```python
"""CRUD on image_labels — JSON columns roundtrip, missing-id returns None."""
from __future__ import annotations
import sqlite3
from pathlib import Path

import pytest


IMAGES_SCHEMA = """
CREATE TABLE images (
  image_id TEXT PRIMARY KEY,
  collection_id TEXT NOT NULL,
  source TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_page_url TEXT NOT NULL,
  image_url TEXT NOT NULL,
  filename TEXT NOT NULL,
  thumbnail_filename TEXT NOT NULL,
  medium_filename TEXT NOT NULL,
  file_sha256 TEXT NOT NULL,
  license TEXT NOT NULL,
  subject_state TEXT NOT NULL,
  hidden INTEGER NOT NULL DEFAULT 0,
  added_at INTEGER NOT NULL DEFAULT (unixepoch())
);
"""

IMAGE_LABELS_SCHEMA = """
CREATE TABLE image_labels (
  image_id    TEXT PRIMARY KEY REFERENCES images(image_id) ON DELETE CASCADE,
  col1        TEXT,
  col2_count  TEXT,
  col2_flags  TEXT,
  col3        TEXT,
  col4        TEXT,
  unsure      INTEGER NOT NULL DEFAULT 0 CHECK (unsure IN (0, 1)),
  reviewed_at INTEGER,
  user_edited INTEGER NOT NULL DEFAULT 0 CHECK (user_edited IN (0, 1)),
  variant_tag TEXT
);
"""


@pytest.fixture
def tmp_db(tmp_path):
    db = tmp_path / "test.db"
    conn = sqlite3.connect(db)
    conn.executescript(IMAGES_SCHEMA)
    conn.executescript(IMAGE_LABELS_SCHEMA)
    # Insert a stub image so the FK passes.
    for image_id in ("img-1", "img-2", "img-3"):
        conn.execute(
            "INSERT INTO images (image_id, collection_id, source, source_id, "
            "source_page_url, image_url, filename, thumbnail_filename, "
            "medium_filename, file_sha256, license, subject_state) "
            "VALUES (?, 'c', 'inaturalist', 's', 'u', 'u', 'f', 't', 'm', "
            "'sha', 'lic', 'wild')",
            (image_id,),
        )
    conn.commit()
    conn.close()
    return db


def test_fetch_label_returns_none_for_missing(tmp_db):
    from scripts.detect_subjects.sqlite_db import open_conn
    from scripts.detect_subjects.image_labels_io import fetch_label
    conn = open_conn(tmp_db)
    try:
        assert fetch_label(conn, "missing-id") is None
    finally:
        conn.close()


def test_upsert_then_fetch_roundtrips_all_fields(tmp_db):
    from scripts.detect_subjects.sqlite_db import open_conn
    from scripts.detect_subjects.image_labels_io import upsert_label, fetch_label
    record = {
        "col1": "bbox_correct-subject_not-clipped",
        "col2_count": "bbox-content_single",
        "col2_flags": ["bbox-content_subject-too-small"],
        "col3": ["mask_blur_unusable"],
        "col4": [],
        "unsure": False,
        "reviewed_at": 1779042405201,
        "user_edited": True,
        "variant_tag": "sam3__sam3",
    }
    conn = open_conn(tmp_db)
    try:
        upsert_label(conn, "img-1", record)
        conn.commit()  # upsert_label no longer commits — caller controls
        got = fetch_label(conn, "img-1")
    finally:
        conn.close()
    assert got == record


def test_upsert_overwrites_existing_row(tmp_db):
    from scripts.detect_subjects.sqlite_db import open_conn
    from scripts.detect_subjects.image_labels_io import upsert_label, fetch_label
    first = {
        "col1": "bbox_correct-subject_not-clipped",
        "col2_count": "bbox-content_single",
        "col2_flags": [], "col3": [], "col4": [],
        "unsure": False, "reviewed_at": 1, "user_edited": True,
        "variant_tag": "sam3__sam3",
    }
    second = {**first, "col3": ["mask_blur_unusable"], "reviewed_at": 2}
    conn = open_conn(tmp_db)
    try:
        upsert_label(conn, "img-1", first)
        upsert_label(conn, "img-1", second)
        conn.commit()
        got = fetch_label(conn, "img-1")
    finally:
        conn.close()
    assert got["col3"] == ["mask_blur_unusable"]
    assert got["reviewed_at"] == 2


def test_delete_labels_not_in_removes_orphans(tmp_db):
    """delete_labels_not_in removes rows whose image_id isn't in the keep set."""
    from scripts.detect_subjects.sqlite_db import open_conn
    from scripts.detect_subjects.image_labels_io import (
        upsert_label, delete_labels_not_in, fetch_label,
    )
    base = {
        "col1": "bbox_correct-subject_not-clipped",
        "col2_count": "bbox-content_single",
        "col2_flags": [], "col3": [], "col4": [],
        "unsure": False, "reviewed_at": 1, "user_edited": True,
        "variant_tag": "sam3__sam3",
    }
    conn = open_conn(tmp_db)
    try:
        upsert_label(conn, "img-1", base)
        upsert_label(conn, "img-2", base)
        upsert_label(conn, "img-3", base)
        conn.commit()
        deleted = delete_labels_not_in(conn, {"img-1", "img-3"})
        conn.commit()
        got_1 = fetch_label(conn, "img-1")
        got_2 = fetch_label(conn, "img-2")
        got_3 = fetch_label(conn, "img-3")
    finally:
        conn.close()
    assert deleted == 1
    assert got_1 is not None
    assert got_2 is None
    assert got_3 is not None


def test_delete_labels_not_in_empty_set_clears_all(tmp_db):
    """An empty keep set deletes every row (POST with {} body)."""
    from scripts.detect_subjects.sqlite_db import open_conn
    from scripts.detect_subjects.image_labels_io import (
        upsert_label, delete_labels_not_in,
    )
    base = {
        "col1": "bbox_correct-subject_not-clipped",
        "col2_count": "bbox-content_single",
        "col2_flags": [], "col3": [], "col4": [],
        "unsure": False, "reviewed_at": 1, "user_edited": True,
        "variant_tag": "sam3__sam3",
    }
    conn = open_conn(tmp_db)
    try:
        upsert_label(conn, "img-1", base)
        upsert_label(conn, "img-2", base)
        conn.commit()
        deleted = delete_labels_not_in(conn, set())
        conn.commit()
        n = conn.execute("SELECT COUNT(*) FROM image_labels").fetchone()[0]
    finally:
        conn.close()
    assert deleted == 2
    assert n == 0


def test_fetch_all_reviewed_returns_dict_by_image_id(tmp_db):
    from scripts.detect_subjects.sqlite_db import open_conn
    from scripts.detect_subjects.image_labels_io import (
        upsert_label, fetch_all_reviewed_labels,
    )
    reviewed = {
        "col1": "bbox_correct-subject_not-clipped",
        "col2_count": "bbox-content_single",
        "col2_flags": [], "col3": [], "col4": [],
        "unsure": False, "reviewed_at": 100, "user_edited": True,
        "variant_tag": "sam3__sam3",
    }
    unreviewed = {**reviewed, "reviewed_at": None}
    conn = open_conn(tmp_db)
    try:
        upsert_label(conn, "img-1", reviewed)
        upsert_label(conn, "img-2", unreviewed)
        upsert_label(conn, "img-3", reviewed)
        conn.commit()
        got = fetch_all_reviewed_labels(conn)
    finally:
        conn.close()
    assert set(got.keys()) == {"img-1", "img-3"}


def test_fetch_all_reviewed_filters_by_variant_tag(tmp_db):
    from scripts.detect_subjects.sqlite_db import open_conn
    from scripts.detect_subjects.image_labels_io import (
        upsert_label, fetch_all_reviewed_labels,
    )
    base = {
        "col1": "bbox_correct-subject_not-clipped",
        "col2_count": "bbox-content_single",
        "col2_flags": [], "col3": [], "col4": [],
        "unsure": False, "reviewed_at": 100, "user_edited": True,
    }
    conn = open_conn(tmp_db)
    try:
        upsert_label(conn, "img-1", {**base, "variant_tag": "sam3__sam3"})
        upsert_label(conn, "img-2", {**base, "variant_tag": "grounding_dino__insectsam"})
        conn.commit()
        got = fetch_all_reviewed_labels(conn, variant_tag="sam3__sam3")
    finally:
        conn.close()
    assert set(got.keys()) == {"img-1"}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
.venv/bin/python -m pytest tests/python/test_image_labels_io.py -v
```

Expected: 5 FAIL with `ModuleNotFoundError`.

- [ ] **Step 3: Implement `image_labels_io.py`**

Create `scripts/detect_subjects/image_labels_io.py`:

```python
"""Read/write the `image_labels` table.

The validator UI emits labels as JSON dicts with this shape:
  {
    "col1": "bbox_correct-subject_not-clipped",
    "col2_count": "bbox-content_single",
    "col2_flags": [...],   # JSON array
    "col3": [...],         # JSON array
    "col4": [...],         # JSON array
    "unsure": bool,
    "reviewed_at": int_ms_or_None,
    "user_edited": bool,
    "variant_tag": str,
  }

This module is the single source of truth for translating that shape
to/from SQLite. JSON columns (col2_flags, col3, col4) are stored as
TEXT with JSON content — Python does the encoding here so consumers
can deal in native dicts/lists.
"""
from __future__ import annotations
import json
import sqlite3
from typing import Optional


_COLS = (
    "image_id", "col1", "col2_count", "col2_flags", "col3", "col4",
    "unsure", "reviewed_at", "user_edited", "variant_tag",
)
_UPDATE_COLS = tuple(c for c in _COLS if c != "image_id")

_UPSERT_SQL = (
    f"INSERT INTO image_labels ({', '.join(_COLS)}) "
    f"VALUES ({', '.join('?' for _ in _COLS)}) "
    f"ON CONFLICT(image_id) DO UPDATE SET "
    + ", ".join(f"{c}=excluded.{c}" for c in _UPDATE_COLS)
)


def _decode_row(row: tuple) -> dict:
    """Turn a SELECT row into the JSON-flavoured dict the UI uses."""
    (col1, col2_count, col2_flags_j, col3_j, col4_j,
     unsure, reviewed_at, user_edited, variant_tag) = row
    return {
        "col1": col1,
        "col2_count": col2_count,
        "col2_flags": json.loads(col2_flags_j) if col2_flags_j else [],
        "col3": json.loads(col3_j) if col3_j else [],
        "col4": json.loads(col4_j) if col4_j else [],
        "unsure": bool(unsure),
        "reviewed_at": reviewed_at,
        "user_edited": bool(user_edited),
        "variant_tag": variant_tag,
    }


def fetch_label(conn: sqlite3.Connection, image_id: str) -> Optional[dict]:
    row = conn.execute(
        "SELECT col1, col2_count, col2_flags, col3, col4, "
        "unsure, reviewed_at, user_edited, variant_tag "
        "FROM image_labels WHERE image_id = ?",
        (image_id,),
    ).fetchone()
    if row is None:
        return None
    return _decode_row(row)


def upsert_label(
    conn: sqlite3.Connection, image_id: str, record: dict,
) -> None:
    """Upsert one image_labels row from a UI-shaped dict.

    Does NOT commit — callers are responsible for the transaction boundary.
    This matters for batch saves (label_server POST) where we want all-or-
    nothing semantics matching the legacy labels.json atomic-rename behavior.
    """
    values = (
        image_id,
        record.get("col1"),
        record.get("col2_count"),
        json.dumps(record.get("col2_flags") or []),
        json.dumps(record.get("col3") or []),
        json.dumps(record.get("col4") or []),
        int(bool(record.get("unsure", False))),
        record.get("reviewed_at"),
        int(bool(record.get("user_edited", False))),
        record.get("variant_tag"),
    )
    conn.execute(_UPSERT_SQL, values)


def delete_labels_not_in(
    conn: sqlite3.Connection, keep_ids: set[str],
) -> int:
    """Delete image_labels rows whose image_id is NOT in keep_ids. Returns
    the count deleted. Used by the POST /api/labels handler to honor the
    legacy 'POST body is the full state' semantic — if the UI removed a key
    from its LABELS dict (user cleared every label on a card), we must
    remove the corresponding row instead of leaving it orphaned.

    Does NOT commit."""
    if not keep_ids:
        cur = conn.execute("DELETE FROM image_labels")
        return cur.rowcount
    # SQLite parameter limit is high (32k+) — fine for our ~300 keys.
    placeholders = ",".join("?" * len(keep_ids))
    cur = conn.execute(
        f"DELETE FROM image_labels WHERE image_id NOT IN ({placeholders})",
        tuple(keep_ids),
    )
    return cur.rowcount


def fetch_all_reviewed_labels(
    conn: sqlite3.Connection,
    variant_tag: Optional[str] = None,
) -> dict[str, dict]:
    """Return {image_id: record_dict} for rows where reviewed_at IS NOT NULL.

    If variant_tag is given, also filters by it (useful for the
    sam3-only training selector)."""
    sql = (
        "SELECT image_id, col1, col2_count, col2_flags, col3, col4, "
        "unsure, reviewed_at, user_edited, variant_tag "
        "FROM image_labels WHERE reviewed_at IS NOT NULL"
    )
    args: tuple = ()
    if variant_tag is not None:
        sql += " AND variant_tag = ?"
        args = (variant_tag,)
    out: dict[str, dict] = {}
    for row in conn.execute(sql, args):
        out[row[0]] = _decode_row(row[1:])
    return out
```

- [ ] **Step 4: Run test to verify it passes**

```bash
.venv/bin/python -m pytest tests/python/test_image_labels_io.py -v
```

Expected: 5 PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/detect_subjects/image_labels_io.py tests/python/test_image_labels_io.py
git commit --only --no-gpg-sign -- scripts/detect_subjects/image_labels_io.py tests/python/test_image_labels_io.py -m "feat(detect_subjects): image_labels_io for CRUD on the new SQLite labels table"
```

---

## Task 4: migrate_labels_to_sqlite.py — one-shot labels.json → image_labels

**Files:**
- Create: `scripts/migrate_labels_to_sqlite.py`
- Test: `tests/python/test_migrate_labels_to_sqlite.py`

**Background:**
labels.json has 320 records as of 2026-05-18. We move it into SQLite once, take a backup, and delete the file. Orphan image_ids (no matching row in `images`) get skipped with a warning, not an error — we don't want one stale label to abort the migration. The script is one-shot — deleted from the repo in Task 12 after it's run.

- [ ] **Step 1: Write the failing test**

Create `tests/python/test_migrate_labels_to_sqlite.py`:

```python
"""End-to-end test for the labels.json → image_labels one-shot migration."""
from __future__ import annotations
import json
import sqlite3
from pathlib import Path

import pytest


IMAGES_SCHEMA = """
CREATE TABLE images (
  image_id TEXT PRIMARY KEY,
  collection_id TEXT NOT NULL, source TEXT NOT NULL, source_id TEXT NOT NULL,
  source_page_url TEXT NOT NULL, image_url TEXT NOT NULL,
  filename TEXT NOT NULL, thumbnail_filename TEXT NOT NULL,
  medium_filename TEXT NOT NULL, file_sha256 TEXT NOT NULL,
  license TEXT NOT NULL, subject_state TEXT NOT NULL,
  hidden INTEGER NOT NULL DEFAULT 0,
  added_at INTEGER NOT NULL DEFAULT (unixepoch())
);
"""
IMAGE_LABELS_SCHEMA = """
CREATE TABLE image_labels (
  image_id TEXT PRIMARY KEY REFERENCES images(image_id) ON DELETE CASCADE,
  col1 TEXT, col2_count TEXT, col2_flags TEXT, col3 TEXT, col4 TEXT,
  unsure INTEGER NOT NULL DEFAULT 0 CHECK (unsure IN (0, 1)),
  reviewed_at INTEGER,
  user_edited INTEGER NOT NULL DEFAULT 0 CHECK (user_edited IN (0, 1)),
  variant_tag TEXT
);
"""


@pytest.fixture
def tmp_db(tmp_path):
    db = tmp_path / "test.db"
    conn = sqlite3.connect(db)
    conn.executescript(IMAGES_SCHEMA)
    conn.executescript(IMAGE_LABELS_SCHEMA)
    for iid in ("img-1", "img-2"):
        conn.execute(
            "INSERT INTO images (image_id, collection_id, source, source_id, "
            "source_page_url, image_url, filename, thumbnail_filename, "
            "medium_filename, file_sha256, license, subject_state) "
            "VALUES (?, 'c', 'inaturalist', 's', 'u', 'u', 'f', 't', 'm', "
            "'sha', 'lic', 'wild')",
            (iid,),
        )
    conn.commit()
    conn.close()
    return db


@pytest.fixture
def tmp_labels_json(tmp_path):
    """3 records: 2 valid (img-1, img-2), 1 orphan (img-99 missing in images)."""
    labels = {
        "img-1": {
            "col1": "bbox_correct-subject_not-clipped",
            "col2_count": "bbox-content_single",
            "col2_flags": [], "col3": ["mask_blur_unusable"], "col4": [],
            "unsure": False, "reviewed_at": 100, "user_edited": True,
            "variant_tag": "sam3__sam3",
        },
        "img-2": {
            "col1": "bbox_correct-subject_not-clipped",
            "col2_count": "bbox-content_single",
            "col2_flags": [], "col3": [], "col4": [],
            "unsure": False, "reviewed_at": 200, "user_edited": True,
            "variant_tag": "sam3__sam3",
        },
        "img-99": {
            "col1": "bbox_correct-subject_not-clipped",
            "col2_count": "bbox-content_single",
            "col2_flags": [], "col3": [], "col4": [],
            "unsure": False, "reviewed_at": 300, "user_edited": True,
            "variant_tag": "sam3__sam3",
        },
    }
    p = tmp_path / "labels.json"
    p.write_text(json.dumps(labels))
    return p


def test_migrate_moves_valid_records_and_skips_orphans(tmp_db, tmp_labels_json):
    from scripts.migrate_labels_to_sqlite import migrate
    summary = migrate(labels_path=tmp_labels_json, db_path=tmp_db)
    assert summary["migrated"] == 2
    assert summary["skipped_orphans"] == 1
    # Backup file should have been created next to labels.json.
    backups = list(tmp_labels_json.parent.glob("labels.json.bak-pre-sqlite-migration-*"))
    assert len(backups) == 1
    # Original labels.json is left in place (Task 12 deletes it after operator
    # confirms label_server.py has flipped over).
    assert tmp_labels_json.exists()
    conn = sqlite3.connect(tmp_db)
    rows = list(conn.execute("SELECT image_id, col3 FROM image_labels ORDER BY image_id"))
    conn.close()
    assert rows == [
        ("img-1", json.dumps(["mask_blur_unusable"])),
        ("img-2", json.dumps([])),
    ]


def test_migrate_is_idempotent(tmp_db, tmp_labels_json):
    """Re-running shouldn't duplicate rows (UPSERT semantics)."""
    from scripts.migrate_labels_to_sqlite import migrate
    migrate(labels_path=tmp_labels_json, db_path=tmp_db)
    migrate(labels_path=tmp_labels_json, db_path=tmp_db)
    conn = sqlite3.connect(tmp_db)
    n = conn.execute("SELECT COUNT(*) FROM image_labels").fetchone()[0]
    conn.close()
    assert n == 2
```

- [ ] **Step 2: Run test to verify it fails**

```bash
.venv/bin/python -m pytest tests/python/test_migrate_labels_to_sqlite.py -v
```

Expected: 2 FAIL with `ModuleNotFoundError`.

- [ ] **Step 3: Implement `migrate_labels_to_sqlite.py`**

Create `scripts/migrate_labels_to_sqlite.py`:

```python
"""One-shot: migrate data/cache/labels.json → SQLite image_labels.

After this runs once successfully and label_server.py is rewired to
SQLite (Task 11), this script is deleted from the repo (Task 12) per
the CLAUDE.md "delete one-shot scripts after they run" convention.

Behavior:
  - Read labels.json
  - For each record, upsert into image_labels (skipping orphan image_ids
    whose images-table row is missing)
  - Write a sibling backup labels.json.bak-pre-sqlite-migration-<ts>
  - Print a summary

Idempotent — upsert means a re-run is a no-op if the DB already matches.
labels.json is intentionally NOT deleted by this script; the operator
deletes it in Task 12 after confirming label_server.py is working off
SQLite.
"""
from __future__ import annotations
import json
import shutil
import sys
import time
from pathlib import Path

from scripts.detect_subjects.sqlite_db import open_conn, DEFAULT_DB_PATH
from scripts.detect_subjects.image_labels_io import upsert_label

DEFAULT_LABELS_PATH = Path(__file__).resolve().parent.parent / "data" / "cache" / "labels.json"


def migrate(
    labels_path: Path = DEFAULT_LABELS_PATH,
    db_path: Path = DEFAULT_DB_PATH,
) -> dict:
    """Run the migration. Returns {migrated, skipped_orphans}."""
    if not labels_path.exists():
        raise FileNotFoundError(f"labels.json not found at {labels_path}")
    labels = json.loads(labels_path.read_text())
    ts = int(time.time())
    backup = labels_path.with_suffix(f".json.bak-pre-sqlite-migration-{ts}")
    shutil.copy2(labels_path, backup)
    print(f"[migrate] backed up labels.json → {backup}")

    conn = open_conn(db_path)
    try:
        existing_image_ids = {
            r[0] for r in conn.execute("SELECT image_id FROM images")
        }
        migrated = 0
        skipped_orphans = 0
        conn.execute("BEGIN")
        try:
            for image_id, record in labels.items():
                if image_id not in existing_image_ids:
                    print(f"[migrate] WARN orphan label, skipping: {image_id}")
                    skipped_orphans += 1
                    continue
                upsert_label(conn, image_id, record)
                migrated += 1
            conn.commit()
        except Exception:
            conn.rollback()
            raise
    finally:
        conn.close()

    print(f"[migrate] {migrated} migrated, {skipped_orphans} orphans skipped")
    return {"migrated": migrated, "skipped_orphans": skipped_orphans}


if __name__ == "__main__":
    summary = migrate()
    sys.exit(0 if summary["migrated"] > 0 else 1)
```

- [ ] **Step 4: Run test to verify it passes**

```bash
.venv/bin/python -m pytest tests/python/test_migrate_labels_to_sqlite.py -v
```

Expected: 2 PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/migrate_labels_to_sqlite.py tests/python/test_migrate_labels_to_sqlite.py
git commit --only --no-gpg-sign -- scripts/migrate_labels_to_sqlite.py tests/python/test_migrate_labels_to_sqlite.py -m "feat: one-shot migrator labels.json → image_labels (deleted post-run in T12)"
```

---

## Task 5: detections_sync.py — parquet → detections

**Files:**
- Create: `scripts/detect_subjects/detections_sync.py`
- Test: `tests/python/test_detections_sync.py`

**Background:**
`framing_detections.parquet` accumulates one row per (image_id, variant). The `detections` SQLite table holds one row per image_id with the *latest variant* — production reads it as the canonical detection result. The sync function groups by image_id, picks the row with the largest `processed_at`, and upserts. Idempotent: re-running is a no-op.

The `gate_rule_only` column is derived locally by calling `decide_drawability()` on the suggested_labels (matches classify.py's existing `gate_decision_str` logic — keep it as an analytics baseline).

- [ ] **Step 1: Write the failing test**

Create `tests/python/test_detections_sync.py`:

```python
"""parquet → detections sync — latest-variant-wins, idempotent."""
from __future__ import annotations
import json
import sqlite3
from pathlib import Path

import polars as pl
import pytest


IMAGES_SCHEMA = """
CREATE TABLE images (
  image_id TEXT PRIMARY KEY,
  collection_id TEXT NOT NULL, source TEXT NOT NULL, source_id TEXT NOT NULL,
  source_page_url TEXT NOT NULL, image_url TEXT NOT NULL,
  filename TEXT NOT NULL, thumbnail_filename TEXT NOT NULL,
  medium_filename TEXT NOT NULL, file_sha256 TEXT NOT NULL,
  license TEXT NOT NULL, subject_state TEXT NOT NULL,
  hidden INTEGER NOT NULL DEFAULT 0,
  added_at INTEGER NOT NULL DEFAULT (unixepoch())
);
"""
DETECTIONS_SCHEMA = """
CREATE TABLE detections (
  image_id TEXT PRIMARY KEY REFERENCES images(image_id) ON DELETE CASCADE,
  variant TEXT NOT NULL,
  suggested_labels TEXT NOT NULL,
  gate_rule_only TEXT NOT NULL CHECK (gate_rule_only IN ('keep', 'reject')),
  has_bbox INTEGER NOT NULL CHECK (has_bbox IN (0, 1)),
  bbox_x REAL, bbox_y REAL, bbox_w REAL, bbox_h REAL,
  mask_area_ratio REAL, lab_delta_e REAL, boundary_sharpness REAL,
  mask_iou_score REAL,
  crop_x REAL, crop_y REAL, crop_w REAL, crop_h REAL,
  post_crop_subject_area REAL,
  processed_at INTEGER NOT NULL,
  schema_version INTEGER NOT NULL
);
"""


@pytest.fixture
def tmp_db(tmp_path):
    db = tmp_path / "test.db"
    conn = sqlite3.connect(db)
    conn.executescript(IMAGES_SCHEMA)
    conn.executescript(DETECTIONS_SCHEMA)
    for iid in ("img-1", "img-2"):
        conn.execute(
            "INSERT INTO images (image_id, collection_id, source, source_id, "
            "source_page_url, image_url, filename, thumbnail_filename, "
            "medium_filename, file_sha256, license, subject_state) "
            "VALUES (?, 'c', 'inaturalist', 's', 'u', 'u', 'f', 't', 'm', "
            "'sha', 'lic', 'wild')",
            (iid,),
        )
    conn.commit()
    conn.close()
    return db


def _make_parquet(tmp_path: Path, rows: list[dict]) -> Path:
    """Build a parquet with the columns sync_detections_from_parquet expects."""
    df = pl.DataFrame(rows)
    p = tmp_path / "test.parquet"
    df.write_parquet(p)
    return p


def test_sync_creates_one_row_per_image_id(tmp_db, tmp_path):
    from scripts.detect_subjects.detections_sync import sync_detections_from_parquet
    parquet = _make_parquet(tmp_path, [
        {
            "image_id": "img-1", "variant": "sam3__sam3",
            "suggested_labels": ["bbox-content_single"],
            "bbox_x": 0.1, "bbox_y": 0.1, "bbox_w": 0.2, "bbox_h": 0.2,
            "mask_area_ratio": 0.03, "lab_delta_e": 15.0,
            "boundary_sharpness": 5.0, "mask_iou_score": 0.8,
            "crop_x": 0.0, "crop_y": 0.0, "crop_w": 0.5, "crop_h": 0.5,
            "post_crop_subject_area": 0.3,
            "processed_at": 1779000000000, "schema_version": 3,
        },
    ])
    result = sync_detections_from_parquet(parquet, tmp_db)
    assert result["upserted"] == 1
    conn = sqlite3.connect(tmp_db)
    row = conn.execute(
        "SELECT image_id, variant, suggested_labels, gate_rule_only, has_bbox "
        "FROM detections"
    ).fetchone()
    conn.close()
    assert row == ("img-1", "sam3__sam3", json.dumps(["bbox-content_single"]), "keep", 1)


def test_sync_latest_variant_wins(tmp_db, tmp_path):
    """If parquet has both grounding_dino and sam3 for img-1, sam3 (newer
    processed_at) wins."""
    from scripts.detect_subjects.detections_sync import sync_detections_from_parquet
    parquet = _make_parquet(tmp_path, [
        {
            "image_id": "img-1", "variant": "grounding_dino__insectsam",
            "suggested_labels": ["bbox-content_no-bug"],
            "bbox_x": None, "bbox_y": None, "bbox_w": None, "bbox_h": None,
            "mask_area_ratio": None, "lab_delta_e": None,
            "boundary_sharpness": None, "mask_iou_score": None,
            "crop_x": None, "crop_y": None, "crop_w": None, "crop_h": None,
            "post_crop_subject_area": None,
            "processed_at": 1779000000000, "schema_version": 2,
        },
        {
            "image_id": "img-1", "variant": "sam3__sam3",
            "suggested_labels": ["bbox-content_single"],
            "bbox_x": 0.1, "bbox_y": 0.1, "bbox_w": 0.2, "bbox_h": 0.2,
            "mask_area_ratio": 0.03, "lab_delta_e": 15.0,
            "boundary_sharpness": 5.0, "mask_iou_score": 0.8,
            "crop_x": 0.0, "crop_y": 0.0, "crop_w": 0.5, "crop_h": 0.5,
            "post_crop_subject_area": 0.3,
            "processed_at": 1779100000000, "schema_version": 3,
        },
    ])
    sync_detections_from_parquet(parquet, tmp_db)
    conn = sqlite3.connect(tmp_db)
    row = conn.execute(
        "SELECT variant, gate_rule_only FROM detections WHERE image_id='img-1'"
    ).fetchone()
    conn.close()
    assert row == ("sam3__sam3", "keep")


def test_sync_is_idempotent(tmp_db, tmp_path):
    from scripts.detect_subjects.detections_sync import sync_detections_from_parquet
    parquet = _make_parquet(tmp_path, [
        {
            "image_id": "img-1", "variant": "sam3__sam3",
            "suggested_labels": ["bbox-content_no-bug"],
            "bbox_x": None, "bbox_y": None, "bbox_w": None, "bbox_h": None,
            "mask_area_ratio": None, "lab_delta_e": None,
            "boundary_sharpness": None, "mask_iou_score": None,
            "crop_x": None, "crop_y": None, "crop_w": None, "crop_h": None,
            "post_crop_subject_area": None,
            "processed_at": 1779000000000, "schema_version": 3,
        },
    ])
    sync_detections_from_parquet(parquet, tmp_db)
    sync_detections_from_parquet(parquet, tmp_db)
    conn = sqlite3.connect(tmp_db)
    n = conn.execute("SELECT COUNT(*) FROM detections").fetchone()[0]
    conn.close()
    assert n == 1


def test_sync_sets_has_bbox_zero_when_bbox_is_null(tmp_db, tmp_path):
    from scripts.detect_subjects.detections_sync import sync_detections_from_parquet
    parquet = _make_parquet(tmp_path, [
        {
            "image_id": "img-1", "variant": "sam3__sam3",
            "suggested_labels": ["bbox-content_no-bug"],
            "bbox_x": None, "bbox_y": None, "bbox_w": None, "bbox_h": None,
            "mask_area_ratio": None, "lab_delta_e": None,
            "boundary_sharpness": None, "mask_iou_score": None,
            "crop_x": None, "crop_y": None, "crop_w": None, "crop_h": None,
            "post_crop_subject_area": None,
            "processed_at": 1779000000000, "schema_version": 3,
        },
    ])
    sync_detections_from_parquet(parquet, tmp_db)
    conn = sqlite3.connect(tmp_db)
    row = conn.execute(
        "SELECT has_bbox, gate_rule_only FROM detections WHERE image_id='img-1'"
    ).fetchone()
    conn.close()
    assert row == (0, "reject")  # no-bug → reject


def test_sync_skips_orphan_image_ids(tmp_db, tmp_path):
    """Parquet rows whose image_id isn't in the images table are skipped."""
    from scripts.detect_subjects.detections_sync import sync_detections_from_parquet
    parquet = _make_parquet(tmp_path, [
        {
            "image_id": "img-orphan", "variant": "sam3__sam3",
            "suggested_labels": ["bbox-content_single"],
            "bbox_x": 0.1, "bbox_y": 0.1, "bbox_w": 0.2, "bbox_h": 0.2,
            "mask_area_ratio": 0.03, "lab_delta_e": 15.0,
            "boundary_sharpness": 5.0, "mask_iou_score": 0.8,
            "crop_x": 0.0, "crop_y": 0.0, "crop_w": 0.5, "crop_h": 0.5,
            "post_crop_subject_area": 0.3,
            "processed_at": 1779000000000, "schema_version": 3,
        },
    ])
    result = sync_detections_from_parquet(parquet, tmp_db)
    assert result["upserted"] == 0
    assert result["skipped_orphans"] == 1
```

- [ ] **Step 2: Run test to verify it fails**

```bash
.venv/bin/python -m pytest tests/python/test_detections_sync.py -v
```

Expected: 5 FAIL with `ModuleNotFoundError`.

- [ ] **Step 3: Implement `detections_sync.py`**

Create `scripts/detect_subjects/detections_sync.py`:

```python
"""Sync parquet (framing_detections.parquet) → SQLite `detections` table.

Latest-variant-wins per image_id: when a parquet row exists for both
grounding_dino and sam3, the larger processed_at wins. Idempotent —
re-running with the same parquet is a no-op.

gate_rule_only is derived from suggested_labels via gate.decide_drawability()
— same logic classify.py uses for the parquet's gate_decision column.
"""
from __future__ import annotations
import json
import sqlite3
from pathlib import Path
from typing import Any, Optional

import polars as pl

from scripts.detect_subjects.sqlite_db import open_conn, DEFAULT_DB_PATH


_REJECT_RULE_LABELS = frozenset({
    "bbox-content_no-bug",
    "bbox-content_bbox-multibug_unusable",
    "bbox-content_subject-too-small",
})

_COLS = (
    "image_id", "variant", "suggested_labels", "gate_rule_only", "has_bbox",
    "bbox_x", "bbox_y", "bbox_w", "bbox_h",
    "mask_area_ratio", "lab_delta_e", "boundary_sharpness", "mask_iou_score",
    "crop_x", "crop_y", "crop_w", "crop_h", "post_crop_subject_area",
    "processed_at", "schema_version",
)
_UPDATE_COLS = tuple(c for c in _COLS if c != "image_id")

_UPSERT_SQL = (
    f"INSERT INTO detections ({', '.join(_COLS)}) "
    f"VALUES ({', '.join('?' for _ in _COLS)}) "
    f"ON CONFLICT(image_id) DO UPDATE SET "
    + ", ".join(f"{c}=excluded.{c}" for c in _UPDATE_COLS)
)


def _rule_gate(suggested_labels: list[str]) -> str:
    """Return 'keep' or 'reject' from the rule output alone."""
    for lbl in suggested_labels:
        if lbl in _REJECT_RULE_LABELS:
            return "reject"
    return "keep"


def _val(row: dict, col: str) -> Any:
    """Coerce polars-row scalars; polars hands back numpy types occasionally."""
    v = row.get(col)
    if v is None:
        return None
    if hasattr(v, "item"):  # numpy scalar
        return v.item()
    return v


def sync_detections_from_parquet(
    parquet_path: Path,
    db_path: Optional[Path] = None,
) -> dict:
    """Upsert detections from parquet. Returns {upserted, skipped_orphans}."""
    if db_path is None:
        db_path = DEFAULT_DB_PATH
    df = pl.read_parquet(parquet_path)
    # Pick the latest processed_at row per image_id (ties broken by polars
    # internal order — fine, we just need one winner per id).
    df = df.sort("processed_at", descending=True).unique(
        subset=["image_id"], keep="first", maintain_order=True,
    )

    conn = open_conn(db_path)
    try:
        existing_image_ids = {
            r[0] for r in conn.execute("SELECT image_id FROM images")
        }
        upserted = 0
        skipped_orphans = 0
        conn.execute("BEGIN")
        for row in df.iter_rows(named=True):
            image_id = row["image_id"]
            if image_id not in existing_image_ids:
                skipped_orphans += 1
                continue
            suggested = list(row.get("suggested_labels") or [])
            gate = _rule_gate(suggested)
            has_bbox = 1 if row.get("bbox_x") is not None else 0
            values = (
                image_id,
                row["variant"],
                json.dumps(suggested),
                gate,
                has_bbox,
                _val(row, "bbox_x"), _val(row, "bbox_y"),
                _val(row, "bbox_w"), _val(row, "bbox_h"),
                _val(row, "mask_area_ratio"),
                _val(row, "lab_delta_e"),
                _val(row, "boundary_sharpness"),
                _val(row, "mask_iou_score"),
                _val(row, "crop_x"), _val(row, "crop_y"),
                _val(row, "crop_w"), _val(row, "crop_h"),
                _val(row, "post_crop_subject_area"),
                _val(row, "processed_at"),
                _val(row, "schema_version"),
            )
            conn.execute(_UPSERT_SQL, values)
            upserted += 1
        conn.commit()
    finally:
        conn.close()

    print(f"[sync:detections] {upserted} upserted, {skipped_orphans} orphans skipped")
    return {"upserted": upserted, "skipped_orphans": skipped_orphans}


if __name__ == "__main__":
    from scripts.detect_subjects.config import PARQUET_PATH
    sync_detections_from_parquet(PARQUET_PATH)
```

Note: `_rule_gate` in this module mirrors the rule-tier reject logic from `recompute_gate.py`. They use the same reject-label set. The two implementations are intentionally separate because `detections.gate_rule_only` is an analytics baseline computed once at sync time, while `recompute_gate` recomputes the full hierarchy at decision time.

- [ ] **Step 4: Run test to verify it passes**

```bash
.venv/bin/python -m pytest tests/python/test_detections_sync.py -v
```

Expected: 5 PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/detect_subjects/detections_sync.py tests/python/test_detections_sync.py
git commit --only --no-gpg-sign -- scripts/detect_subjects/detections_sync.py tests/python/test_detections_sync.py -m "feat(detect_subjects): sync_detections_from_parquet (latest-variant-wins upsert)"
```

---

## Task 6: predictions_sync.py — parquet → predictions

**Files:**
- Create: `scripts/detect_subjects/predictions_sync.py`
- Test: `tests/python/test_predictions_sync.py`

**Background:**
After `predict.py` writes the `predicted_<label>_p` and `predicted_<label>_unreliable` columns to parquet, we mirror them into SQLite `predictions`. One row per (image_id, label). model_version comes from the joblib bundle's `trained_at`: `<label>@<trained_at>`.

- [ ] **Step 1: Write the failing test**

Create `tests/python/test_predictions_sync.py`:

```python
"""parquet → predictions sync — one row per (image_id, label), model_version
encoded, idempotent."""
from __future__ import annotations
import sqlite3
from pathlib import Path

import polars as pl
import pytest


IMAGES_SCHEMA = """
CREATE TABLE images (
  image_id TEXT PRIMARY KEY,
  collection_id TEXT NOT NULL, source TEXT NOT NULL, source_id TEXT NOT NULL,
  source_page_url TEXT NOT NULL, image_url TEXT NOT NULL,
  filename TEXT NOT NULL, thumbnail_filename TEXT NOT NULL,
  medium_filename TEXT NOT NULL, file_sha256 TEXT NOT NULL,
  license TEXT NOT NULL, subject_state TEXT NOT NULL,
  hidden INTEGER NOT NULL DEFAULT 0,
  added_at INTEGER NOT NULL DEFAULT (unixepoch())
);
"""
PREDICTIONS_SCHEMA = """
CREATE TABLE predictions (
  image_id TEXT NOT NULL REFERENCES images(image_id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  p REAL NOT NULL,
  unreliable INTEGER NOT NULL DEFAULT 0 CHECK (unreliable IN (0, 1)),
  model_version TEXT NOT NULL,
  predicted_at INTEGER NOT NULL,
  PRIMARY KEY (image_id, label)
);
"""


@pytest.fixture
def tmp_db(tmp_path):
    db = tmp_path / "test.db"
    conn = sqlite3.connect(db)
    conn.executescript(IMAGES_SCHEMA)
    conn.executescript(PREDICTIONS_SCHEMA)
    for iid in ("img-1", "img-2"):
        conn.execute(
            "INSERT INTO images (image_id, collection_id, source, source_id, "
            "source_page_url, image_url, filename, thumbnail_filename, "
            "medium_filename, file_sha256, license, subject_state) "
            "VALUES (?, 'c', 'inaturalist', 's', 'u', 'u', 'f', 't', 'm', "
            "'sha', 'lic', 'wild')",
            (iid,),
        )
    conn.commit()
    conn.close()
    return db


def _make_parquet(tmp_path: Path, rows: list[dict]) -> Path:
    df = pl.DataFrame(rows)
    p = tmp_path / "test.parquet"
    df.write_parquet(p)
    return p


def test_sync_upserts_one_row_per_image_label_pair(tmp_db, tmp_path):
    from scripts.detect_subjects.predictions_sync import sync_predictions_from_parquet
    parquet = _make_parquet(tmp_path, [
        {
            "image_id": "img-1", "variant": "sam3__sam3",
            "predicted_mask_blur_unusable_p": 0.75,
            "predicted_mask_blur_unusable_unreliable": False,
        },
        {
            "image_id": "img-2", "variant": "sam3__sam3",
            "predicted_mask_blur_unusable_p": 0.20,
            "predicted_mask_blur_unusable_unreliable": False,
        },
    ])
    result = sync_predictions_from_parquet(
        parquet, ["mask_blur_unusable"], model_versions={"mask_blur_unusable": "mask_blur_unusable@1779000000"},
        now_s=1779100000, db_path=tmp_db,
    )
    assert result["mask_blur_unusable"]["upserted"] == 2
    conn = sqlite3.connect(tmp_db)
    rows = list(conn.execute(
        "SELECT image_id, label, p, unreliable, model_version FROM predictions "
        "ORDER BY image_id"
    ))
    conn.close()
    assert rows == [
        ("img-1", "mask_blur_unusable", 0.75, 0, "mask_blur_unusable@1779000000"),
        ("img-2", "mask_blur_unusable", 0.20, 0, "mask_blur_unusable@1779000000"),
    ]


def test_sync_skips_rows_with_null_p(tmp_db, tmp_path):
    """A row whose predicted_<label>_p is NaN/None means the model didn't
    score this image — don't insert a noise row."""
    from scripts.detect_subjects.predictions_sync import sync_predictions_from_parquet
    parquet = _make_parquet(tmp_path, [
        {
            "image_id": "img-1", "variant": "sam3__sam3",
            "predicted_mask_blur_unusable_p": 0.75,
            "predicted_mask_blur_unusable_unreliable": False,
        },
        {
            "image_id": "img-2", "variant": "grounding_dino__insectsam",
            "predicted_mask_blur_unusable_p": None,
            "predicted_mask_blur_unusable_unreliable": None,
        },
    ])
    sync_predictions_from_parquet(
        parquet, ["mask_blur_unusable"],
        model_versions={"mask_blur_unusable": "mask_blur_unusable@1779000000"},
        now_s=1779100000, db_path=tmp_db,
    )
    conn = sqlite3.connect(tmp_db)
    rows = list(conn.execute(
        "SELECT image_id FROM predictions ORDER BY image_id"
    ))
    conn.close()
    assert rows == [("img-1",)]


def test_sync_updates_existing_row(tmp_db, tmp_path):
    """Re-syncing with new probability overwrites old."""
    from scripts.detect_subjects.predictions_sync import sync_predictions_from_parquet
    p1 = _make_parquet(tmp_path / "v1", [
        {
            "image_id": "img-1", "variant": "sam3__sam3",
            "predicted_mask_blur_unusable_p": 0.20,
            "predicted_mask_blur_unusable_unreliable": False,
        },
    ])
    p2 = _make_parquet(tmp_path / "v2", [
        {
            "image_id": "img-1", "variant": "sam3__sam3",
            "predicted_mask_blur_unusable_p": 0.85,
            "predicted_mask_blur_unusable_unreliable": False,
        },
    ])
    sync_predictions_from_parquet(
        p1, ["mask_blur_unusable"],
        model_versions={"mask_blur_unusable": "mask_blur_unusable@1779000000"},
        now_s=1779100000, db_path=tmp_db,
    )
    sync_predictions_from_parquet(
        p2, ["mask_blur_unusable"],
        model_versions={"mask_blur_unusable": "mask_blur_unusable@1779200000"},
        now_s=1779300000, db_path=tmp_db,
    )
    conn = sqlite3.connect(tmp_db)
    row = conn.execute(
        "SELECT p, model_version FROM predictions WHERE image_id='img-1'"
    ).fetchone()
    conn.close()
    assert row == (0.85, "mask_blur_unusable@1779200000")
```

The `_make_parquet` helper writes to a sub-path; ensure the path exists by creating the parent. Update the test to add `(tmp_path / "v1").mkdir()` / `(tmp_path / "v2").mkdir()` before writing.

Actually update _make_parquet:
```python
def _make_parquet(tmp_path: Path, rows: list[dict]) -> Path:
    tmp_path.mkdir(parents=True, exist_ok=True)
    df = pl.DataFrame(rows)
    p = tmp_path / "test.parquet"
    df.write_parquet(p)
    return p
```

- [ ] **Step 2: Run test to verify it fails**

```bash
.venv/bin/python -m pytest tests/python/test_predictions_sync.py -v
```

Expected: 3 FAIL with `ModuleNotFoundError`.

- [ ] **Step 3: Implement `predictions_sync.py`**

Create `scripts/detect_subjects/predictions_sync.py`:

```python
"""Sync parquet predicted_<label>_p columns → SQLite `predictions`.

One row per (image_id, label). model_version is supplied by the caller
(predict.py reads it from the joblib bundle's `trained_at` int). Rows
with NaN/None probability are skipped — a NaN p means the model didn't
score this image (typically non-sam3 variants for a sam3-trained label).
"""
from __future__ import annotations
import math
import sqlite3
from pathlib import Path
from typing import Optional

import polars as pl

from scripts.detect_subjects.sqlite_db import open_conn, DEFAULT_DB_PATH


_UPSERT_SQL = (
    "INSERT INTO predictions "
    "(image_id, label, p, unreliable, model_version, predicted_at) "
    "VALUES (?, ?, ?, ?, ?, ?) "
    "ON CONFLICT(image_id, label) DO UPDATE SET "
    "p=excluded.p, "
    "unreliable=excluded.unreliable, "
    "model_version=excluded.model_version, "
    "predicted_at=excluded.predicted_at"
)


def sync_predictions_from_parquet(
    parquet_path: Path,
    labels: list[str],
    model_versions: dict[str, str],
    now_s: int,
    db_path: Optional[Path] = None,
) -> dict[str, dict]:
    """Upsert predictions for `labels`. Returns {label: {upserted: int}}."""
    if db_path is None:
        db_path = DEFAULT_DB_PATH
    df = pl.read_parquet(parquet_path)
    image_ids = df["image_id"].to_list()
    results: dict[str, dict] = {}

    conn = open_conn(db_path)
    try:
        existing_image_ids = {
            r[0] for r in conn.execute("SELECT image_id FROM images")
        }
        for label in labels:
            p_col = f"predicted_{label}_p"
            u_col = f"predicted_{label}_unreliable"
            if p_col not in df.columns:
                results[label] = {"upserted": 0, "missing_column": True}
                continue
            probs = df[p_col].to_list()
            unrel = df[u_col].to_list() if u_col in df.columns else [False] * len(probs)
            mv = model_versions[label]
            upserted = 0
            conn.execute("BEGIN")
            for iid, p, u in zip(image_ids, probs, unrel):
                if iid not in existing_image_ids:
                    continue
                if p is None or (isinstance(p, float) and math.isnan(p)):
                    continue
                conn.execute(_UPSERT_SQL, (
                    iid, label, float(p),
                    int(bool(u)) if u is not None else 0,
                    mv, now_s,
                ))
                upserted += 1
            conn.commit()
            results[label] = {"upserted": upserted}
            print(f"[sync:predictions:{label}] {upserted} upserted")
    finally:
        conn.close()
    return results


def model_version_for(label: str, bundle: dict) -> str:
    """Format the model_version string from a loaded joblib bundle."""
    return f"{label}@{bundle['trained_at']}"
```

- [ ] **Step 4: Run test to verify it passes**

```bash
.venv/bin/python -m pytest tests/python/test_predictions_sync.py -v
```

Expected: 3 PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/detect_subjects/predictions_sync.py tests/python/test_predictions_sync.py
git commit --only --no-gpg-sign -- scripts/detect_subjects/predictions_sync.py tests/python/test_predictions_sync.py -m "feat(detect_subjects): sync_predictions_from_parquet (one row per image+label)"
```

---

## Task 7: recompute_gate.py — trust hierarchy + CLI

**Files:**
- Create: `scripts/detect_subjects/recompute_gate.py`
- Test: `tests/python/test_recompute_gate.py`

**Background:**
This is the heart of the data layer. Three callable functions implement the trust hierarchy:

```
recompute_for_image(image_id, conn, *, now_s) -> dict     # 1 image
recompute_for_label(label, conn, *, now_s) -> int         # all sam3 rows for this label
recompute_all(conn, *, now_s) -> dict                     # entire images table
```

The trust hierarchy (priority order, first match wins):
1. **Hand** — `image_labels` row with `reviewed_at IS NOT NULL AND user_edited=1`. Calls `decide_drawability()`. KEEP → reason `hand:pass`. REJECT → reason `hand:<first failing column>`.
2. **Report** — at least one `reports` row with `resolved_at IS NULL`. REJECT, reason `report:<category>`.
3. **Rule** — `detections.suggested_labels` contains any of `bbox-content_no-bug`, `bbox-content_bbox-multibug_unusable`, `bbox-content_subject-too-small`. REJECT, reason `rule:<label>`.
4. **ML** — any `predictions` row with `unreliable=0` AND `p >= label_thresholds.threshold` AND `label_thresholds.tier = 1`. REJECT, reason `ml:<label>:<p>`, also writes model_version + threshold_v.
5. **Default** — none of the above. KEEP, reason `defaults_pass`.

The CLI provides `--all`, `--image-id <id>`, `--label <label>`.

- [ ] **Step 1: Write the failing test**

Create `tests/python/test_recompute_gate.py`:

```python
"""Trust hierarchy tests: each tier in isolation + higher tiers winning."""
from __future__ import annotations
import json
import sqlite3
import time
from pathlib import Path

import pytest


SCHEMA = """
CREATE TABLE images (
  image_id TEXT PRIMARY KEY,
  collection_id TEXT NOT NULL, source TEXT NOT NULL, source_id TEXT NOT NULL,
  source_page_url TEXT NOT NULL, image_url TEXT NOT NULL,
  filename TEXT NOT NULL, thumbnail_filename TEXT NOT NULL,
  medium_filename TEXT NOT NULL, file_sha256 TEXT NOT NULL,
  license TEXT NOT NULL, subject_state TEXT NOT NULL,
  hidden INTEGER NOT NULL DEFAULT 0,
  added_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  image_id TEXT NOT NULL REFERENCES images(image_id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  message TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  resolved_at INTEGER,
  resolved_action TEXT
);

CREATE TABLE image_labels (
  image_id TEXT PRIMARY KEY REFERENCES images(image_id) ON DELETE CASCADE,
  col1 TEXT, col2_count TEXT, col2_flags TEXT, col3 TEXT, col4 TEXT,
  unsure INTEGER NOT NULL DEFAULT 0 CHECK (unsure IN (0, 1)),
  reviewed_at INTEGER,
  user_edited INTEGER NOT NULL DEFAULT 0 CHECK (user_edited IN (0, 1)),
  variant_tag TEXT
);

CREATE TABLE detections (
  image_id TEXT PRIMARY KEY REFERENCES images(image_id) ON DELETE CASCADE,
  variant TEXT NOT NULL,
  suggested_labels TEXT NOT NULL,
  gate_rule_only TEXT NOT NULL CHECK (gate_rule_only IN ('keep','reject')),
  has_bbox INTEGER NOT NULL CHECK (has_bbox IN (0, 1)),
  bbox_x REAL, bbox_y REAL, bbox_w REAL, bbox_h REAL,
  mask_area_ratio REAL, lab_delta_e REAL, boundary_sharpness REAL,
  mask_iou_score REAL,
  crop_x REAL, crop_y REAL, crop_w REAL, crop_h REAL,
  post_crop_subject_area REAL,
  processed_at INTEGER NOT NULL,
  schema_version INTEGER NOT NULL
);

CREATE TABLE predictions (
  image_id TEXT NOT NULL REFERENCES images(image_id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  p REAL NOT NULL,
  unreliable INTEGER NOT NULL DEFAULT 0 CHECK (unreliable IN (0, 1)),
  model_version TEXT NOT NULL,
  predicted_at INTEGER NOT NULL,
  PRIMARY KEY (image_id, label)
);

CREATE TABLE gate_decisions (
  image_id TEXT PRIMARY KEY REFERENCES images(image_id) ON DELETE CASCADE,
  decision TEXT NOT NULL CHECK (decision IN ('keep','reject')),
  reason TEXT NOT NULL,
  reason_source TEXT NOT NULL CHECK (reason_source IN ('hand','report','rule','ml','default')),
  computed_at INTEGER NOT NULL,
  model_version TEXT,
  threshold_v INTEGER
);

CREATE TABLE label_thresholds (
  label TEXT PRIMARY KEY,
  tier INTEGER NOT NULL CHECK (tier IN (1, 2)),
  threshold REAL NOT NULL,
  suggested_threshold REAL,
  threshold_v INTEGER NOT NULL,
  notes TEXT,
  updated_at INTEGER NOT NULL
);
"""


def _setup_image(conn, image_id):
    conn.execute(
        "INSERT INTO images (image_id, collection_id, source, source_id, "
        "source_page_url, image_url, filename, thumbnail_filename, "
        "medium_filename, file_sha256, license, subject_state) "
        "VALUES (?, 'c', 'inaturalist', 's', 'u', 'u', 'f', 't', 'm', "
        "'sha', 'lic', 'wild')",
        (image_id,),
    )


def _insert_threshold(conn, label, tier=1, threshold=0.5):
    conn.execute(
        "INSERT INTO label_thresholds (label, tier, threshold, threshold_v, "
        "updated_at) VALUES (?, ?, ?, 1, 1779000000)",
        (label, tier, threshold),
    )


def _insert_detection(conn, image_id, suggested_labels, variant="sam3__sam3"):
    conn.execute(
        "INSERT INTO detections (image_id, variant, suggested_labels, "
        "gate_rule_only, has_bbox, processed_at, schema_version) "
        "VALUES (?, ?, ?, 'keep', 1, 1779000000000, 3)",
        (image_id, variant, json.dumps(suggested_labels)),
    )


def _insert_image_label(conn, image_id, **kwargs):
    flags = json.dumps(kwargs.get("col2_flags", []))
    c3 = json.dumps(kwargs.get("col3", []))
    c4 = json.dumps(kwargs.get("col4", []))
    conn.execute(
        "INSERT INTO image_labels (image_id, col1, col2_count, col2_flags, "
        "col3, col4, unsure, reviewed_at, user_edited, variant_tag) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            image_id,
            kwargs.get("col1", "bbox_correct-subject_not-clipped"),
            kwargs.get("col2_count", "bbox-content_single"),
            flags, c3, c4,
            int(kwargs.get("unsure", False)),
            kwargs.get("reviewed_at", 1),
            int(kwargs.get("user_edited", True)),
            kwargs.get("variant_tag", "sam3__sam3"),
        ),
    )


def _insert_report(conn, image_id, category="ai-generated", resolved=False):
    conn.execute(
        "INSERT INTO reports (image_id, category, resolved_at) "
        "VALUES (?, ?, ?)",
        (image_id, category, None if not resolved else 1779100000),
    )


def _insert_prediction(conn, image_id, label, p, unreliable=0,
                       model_version="mv@1"):
    conn.execute(
        "INSERT INTO predictions (image_id, label, p, unreliable, "
        "model_version, predicted_at) VALUES (?, ?, ?, ?, ?, 1)",
        (image_id, label, p, unreliable, model_version),
    )


@pytest.fixture
def tmp_db(tmp_path):
    db = tmp_path / "test.db"
    conn = sqlite3.connect(db)
    conn.executescript(SCHEMA)
    conn.commit()
    conn.close()
    return db


def test_default_keep_when_no_signals(tmp_db):
    from scripts.detect_subjects.sqlite_db import open_conn
    from scripts.detect_subjects.recompute_gate import recompute_for_image
    conn = open_conn(tmp_db)
    try:
        _setup_image(conn, "img-1")
        conn.commit()
        row = recompute_for_image("img-1", conn, now_s=100)
    finally:
        conn.close()
    assert row["decision"] == "keep"
    assert row["reason"] == "defaults_pass"
    assert row["reason_source"] == "default"


def test_reject_on_unresolved_report(tmp_db):
    from scripts.detect_subjects.sqlite_db import open_conn
    from scripts.detect_subjects.recompute_gate import recompute_for_image
    conn = open_conn(tmp_db)
    try:
        _setup_image(conn, "img-1")
        _insert_report(conn, "img-1", category="ai-generated")
        conn.commit()
        row = recompute_for_image("img-1", conn, now_s=100)
    finally:
        conn.close()
    assert row["decision"] == "reject"
    assert row["reason"] == "report:ai-generated"
    assert row["reason_source"] == "report"


def test_resolved_report_does_not_gate(tmp_db):
    """Reports with resolved_at set are not active; fall through."""
    from scripts.detect_subjects.sqlite_db import open_conn
    from scripts.detect_subjects.recompute_gate import recompute_for_image
    conn = open_conn(tmp_db)
    try:
        _setup_image(conn, "img-1")
        _insert_report(conn, "img-1", category="ai-generated", resolved=True)
        conn.commit()
        row = recompute_for_image("img-1", conn, now_s=100)
    finally:
        conn.close()
    assert row["decision"] == "keep"


def test_reject_on_rule_no_bug(tmp_db):
    from scripts.detect_subjects.sqlite_db import open_conn
    from scripts.detect_subjects.recompute_gate import recompute_for_image
    conn = open_conn(tmp_db)
    try:
        _setup_image(conn, "img-1")
        _insert_detection(conn, "img-1", ["bbox-content_no-bug"])
        conn.commit()
        row = recompute_for_image("img-1", conn, now_s=100)
    finally:
        conn.close()
    assert row["decision"] == "reject"
    assert row["reason"] == "rule:bbox-content_no-bug"
    assert row["reason_source"] == "rule"


def test_rule_single_does_not_gate(tmp_db):
    from scripts.detect_subjects.sqlite_db import open_conn
    from scripts.detect_subjects.recompute_gate import recompute_for_image
    conn = open_conn(tmp_db)
    try:
        _setup_image(conn, "img-1")
        _insert_detection(conn, "img-1", ["bbox-content_single"])
        conn.commit()
        row = recompute_for_image("img-1", conn, now_s=100)
    finally:
        conn.close()
    assert row["decision"] == "keep"


def test_reject_on_ml_above_threshold(tmp_db):
    from scripts.detect_subjects.sqlite_db import open_conn
    from scripts.detect_subjects.recompute_gate import recompute_for_image
    conn = open_conn(tmp_db)
    try:
        _setup_image(conn, "img-1")
        _insert_threshold(conn, "mask_blur_unusable", tier=1, threshold=0.5)
        _insert_prediction(conn, "img-1", "mask_blur_unusable", p=0.85,
                           model_version="mask_blur_unusable@1779000000")
        conn.commit()
        row = recompute_for_image("img-1", conn, now_s=100)
    finally:
        conn.close()
    assert row["decision"] == "reject"
    assert row["reason_source"] == "ml"
    assert row["reason"].startswith("ml:mask_blur_unusable:")
    assert row["model_version"] == "mask_blur_unusable@1779000000"
    assert row["threshold_v"] == 1


def test_ml_below_threshold_does_not_gate(tmp_db):
    from scripts.detect_subjects.sqlite_db import open_conn
    from scripts.detect_subjects.recompute_gate import recompute_for_image
    conn = open_conn(tmp_db)
    try:
        _setup_image(conn, "img-1")
        _insert_threshold(conn, "mask_blur_unusable", tier=1, threshold=0.5)
        _insert_prediction(conn, "img-1", "mask_blur_unusable", p=0.20)
        conn.commit()
        row = recompute_for_image("img-1", conn, now_s=100)
    finally:
        conn.close()
    assert row["decision"] == "keep"
    assert row["reason"] == "defaults_pass"


def test_unreliable_ml_does_not_gate(tmp_db):
    """Tier-2 (unreliable=1) labels never gate even if p is huge."""
    from scripts.detect_subjects.sqlite_db import open_conn
    from scripts.detect_subjects.recompute_gate import recompute_for_image
    conn = open_conn(tmp_db)
    try:
        _setup_image(conn, "img-1")
        _insert_threshold(conn, "some_label", tier=1, threshold=0.5)
        _insert_prediction(conn, "img-1", "some_label", p=0.99, unreliable=1)
        conn.commit()
        row = recompute_for_image("img-1", conn, now_s=100)
    finally:
        conn.close()
    assert row["decision"] == "keep"


def test_tier2_label_does_not_gate(tmp_db):
    """Tier-2 labels are stored in predictions but excluded from gating."""
    from scripts.detect_subjects.sqlite_db import open_conn
    from scripts.detect_subjects.recompute_gate import recompute_for_image
    conn = open_conn(tmp_db)
    try:
        _setup_image(conn, "img-1")
        _insert_threshold(conn, "some_label", tier=2, threshold=0.5)
        _insert_prediction(conn, "img-1", "some_label", p=0.99, unreliable=0)
        conn.commit()
        row = recompute_for_image("img-1", conn, now_s=100)
    finally:
        conn.close()
    assert row["decision"] == "keep"


def test_hand_pass_overrides_lower_tiers(tmp_db):
    """Hand-reviewed clean wins over a rule-tier rejection."""
    from scripts.detect_subjects.sqlite_db import open_conn
    from scripts.detect_subjects.recompute_gate import recompute_for_image
    conn = open_conn(tmp_db)
    try:
        _setup_image(conn, "img-1")
        _insert_detection(conn, "img-1", ["bbox-content_no-bug"])  # would reject
        _insert_image_label(conn, "img-1")  # defaults clean
        conn.commit()
        row = recompute_for_image("img-1", conn, now_s=100)
    finally:
        conn.close()
    assert row["decision"] == "keep"
    assert row["reason"] == "hand:pass"
    assert row["reason_source"] == "hand"


def test_hand_reject_via_mask_label(tmp_db):
    """Hand label with col3 set → reject; reason names the label."""
    from scripts.detect_subjects.sqlite_db import open_conn
    from scripts.detect_subjects.recompute_gate import recompute_for_image
    conn = open_conn(tmp_db)
    try:
        _setup_image(conn, "img-1")
        _insert_image_label(conn, "img-1", col3=["mask_blur_unusable"])
        conn.commit()
        row = recompute_for_image("img-1", conn, now_s=100)
    finally:
        conn.close()
    assert row["decision"] == "reject"
    assert row["reason_source"] == "hand"
    assert "mask_blur_unusable" in row["reason"]


def test_hand_unreviewed_falls_through(tmp_db):
    """An image_labels row with reviewed_at=NULL is ignored by tier 1."""
    from scripts.detect_subjects.sqlite_db import open_conn
    from scripts.detect_subjects.recompute_gate import recompute_for_image
    conn = open_conn(tmp_db)
    try:
        _setup_image(conn, "img-1")
        _insert_image_label(conn, "img-1", reviewed_at=None)
        conn.commit()
        row = recompute_for_image("img-1", conn, now_s=100)
    finally:
        conn.close()
    assert row["decision"] == "keep"
    assert row["reason"] == "defaults_pass"


def test_hand_unsure_falls_through_to_rule(tmp_db):
    """unsure=1 means 'user couldn't decide' — fall through to rule/ML/default,
    don't treat as a hand reject. Prevents undecidable cards from getting
    hidden just because the user clicked 'unsure'."""
    from scripts.detect_subjects.sqlite_db import open_conn
    from scripts.detect_subjects.recompute_gate import recompute_for_image
    conn = open_conn(tmp_db)
    try:
        _setup_image(conn, "img-1")
        _insert_detection(conn, "img-1", ["bbox-content_single"])
        # Reviewed + edited but marked unsure → no hand signal.
        _insert_image_label(conn, "img-1", unsure=True)
        conn.commit()
        row = recompute_for_image("img-1", conn, now_s=100)
    finally:
        conn.close()
    assert row["decision"] == "keep"
    assert row["reason_source"] != "hand"


def test_recompute_for_image_writes_to_gate_decisions(tmp_db):
    from scripts.detect_subjects.sqlite_db import open_conn
    from scripts.detect_subjects.recompute_gate import recompute_for_image
    conn = open_conn(tmp_db)
    try:
        _setup_image(conn, "img-1")
        conn.commit()
        recompute_for_image("img-1", conn, now_s=100)
        row = conn.execute(
            "SELECT decision, reason, computed_at FROM gate_decisions "
            "WHERE image_id='img-1'"
        ).fetchone()
    finally:
        conn.close()
    assert row == ("keep", "defaults_pass", 100)


def test_recompute_all_creates_one_row_per_image(tmp_db):
    from scripts.detect_subjects.sqlite_db import open_conn
    from scripts.detect_subjects.recompute_gate import recompute_all
    conn = open_conn(tmp_db)
    try:
        for i in range(5):
            _setup_image(conn, f"img-{i}")
        conn.commit()
        result = recompute_all(conn, now_s=100)
        n_rows = conn.execute("SELECT COUNT(*) FROM gate_decisions").fetchone()[0]
    finally:
        conn.close()
    assert result["kept"] == 5
    assert result["rejected"] == 0
    assert n_rows == 5


def test_recompute_for_label_touches_only_relevant_images(tmp_db):
    """Recompute_for_label re-evaluates images whose label appears in predictions."""
    from scripts.detect_subjects.sqlite_db import open_conn
    from scripts.detect_subjects.recompute_gate import recompute_for_label
    conn = open_conn(tmp_db)
    try:
        _setup_image(conn, "img-1")
        _setup_image(conn, "img-2")
        _insert_threshold(conn, "mask_blur_unusable", tier=1, threshold=0.5)
        _insert_prediction(conn, "img-1", "mask_blur_unusable", p=0.85)
        # img-2 has no prediction; recompute_for_label should not touch it.
        conn.commit()
        n_touched = recompute_for_label("mask_blur_unusable", conn, now_s=100)
        row_1 = conn.execute(
            "SELECT decision FROM gate_decisions WHERE image_id='img-1'"
        ).fetchone()
        row_2 = conn.execute(
            "SELECT decision FROM gate_decisions WHERE image_id='img-2'"
        ).fetchone()
    finally:
        conn.close()
    assert n_touched == 1
    assert row_1 == ("reject",)
    assert row_2 is None  # not touched
```

- [ ] **Step 2: Run test to verify it fails**

```bash
.venv/bin/python -m pytest tests/python/test_recompute_gate.py -v
```

Expected: 15 FAIL with `ModuleNotFoundError`.

- [ ] **Step 3: Implement `recompute_gate.py`**

Create `scripts/detect_subjects/recompute_gate.py`:

```python
"""Trust-hierarchy gate recompute. Reads image_labels, reports, detections,
predictions, label_thresholds; writes gate_decisions.

Hierarchy (first match wins):
  1. Hand   — image_labels reviewed by a human (decide_drawability rules)
  2. Report — at least one unresolved report row
  3. Rule   — detections.suggested_labels contains a reject label
  4. ML     — any tier-1, reliable prediction with p >= threshold
  5. Default — keep ('innocent until proven flagged')

Three entry points:
  recompute_for_image(image_id, conn, now_s) — called by label_server.py + reports backend
  recompute_for_label(label, conn, now_s)    — called by predict.py after retrain
  recompute_all(conn, now_s)                 — manual rebuild

CLI:
  python -m scripts.detect_subjects.recompute_gate --all
  python -m scripts.detect_subjects.recompute_gate --image-id <id>
  python -m scripts.detect_subjects.recompute_gate --label <label>
"""
from __future__ import annotations
import argparse
import json
import sqlite3
import time
from pathlib import Path
from typing import Optional

from scripts.detect_subjects.gate import decide_drawability
from scripts.detect_subjects.sqlite_db import open_conn, DEFAULT_DB_PATH


REJECT_RULE_LABELS = frozenset({
    "bbox-content_no-bug",
    "bbox-content_bbox-multibug_unusable",
    "bbox-content_subject-too-small",
})

_UPSERT_GATE_SQL = (
    "INSERT INTO gate_decisions "
    "(image_id, decision, reason, reason_source, computed_at, "
    "model_version, threshold_v) "
    "VALUES (?, ?, ?, ?, ?, ?, ?) "
    "ON CONFLICT(image_id) DO UPDATE SET "
    "decision=excluded.decision, reason=excluded.reason, "
    "reason_source=excluded.reason_source, "
    "computed_at=excluded.computed_at, "
    "model_version=excluded.model_version, "
    "threshold_v=excluded.threshold_v"
)


def _write(
    conn: sqlite3.Connection, image_id: str, decision: str, reason: str,
    reason_source: str, now_s: int, *,
    model_version: Optional[str] = None, threshold_v: Optional[int] = None,
) -> dict:
    conn.execute(_UPSERT_GATE_SQL, (
        image_id, decision, reason, reason_source, now_s,
        model_version, threshold_v,
    ))
    return {
        "image_id": image_id, "decision": decision, "reason": reason,
        "reason_source": reason_source, "computed_at": now_s,
        "model_version": model_version, "threshold_v": threshold_v,
    }


def _hand_reject_reason(
    col1: Optional[str], col2_count: Optional[str],
    flags: list[str], col3: list[str], col4: list[str],
) -> str:
    """Build a 'hand:<which-failure>' reason string. First failure wins."""
    if col1 and col1 != "bbox_correct-subject_not-clipped":
        return f"hand:bbox:{col1}"
    if col2_count and col2_count != "bbox-content_single":
        return f"hand:count:{col2_count}"
    if "bbox-content_subject-too-small" in flags:
        return "hand:bbox_too_small"
    if col3:
        return f"hand:mask:{col3[0]}"
    if col4:
        return f"hand:ml:{col4[0]}"
    return "hand:reject"


def recompute_for_image(
    image_id: str, conn: sqlite3.Connection, *, now_s: int,
) -> dict:
    """Compute and write one gate_decisions row. Returns the row dict."""
    # Tier 1: Hand label.
    # unsure=1 means the user marked the card "can't decide" — it is NOT a
    # confirmed hand signal; fall through to lower tiers (rule/ML/default).
    row = conn.execute(
        "SELECT col1, col2_count, col2_flags, col3, col4 "
        "FROM image_labels "
        "WHERE image_id = ? AND reviewed_at IS NOT NULL "
        "  AND user_edited = 1 AND unsure = 0",
        (image_id,),
    ).fetchone()
    if row:
        col1, col2_count, flags_j, col3_j, col4_j = row
        flags = json.loads(flags_j or "[]")
        col3 = json.loads(col3_j or "[]")
        col4 = json.loads(col4_j or "[]")
        decision_enum = decide_drawability({
            "bbox": col1 or "",
            "bbox_content_count": col2_count or "",
            "bbox_too_small": "bbox-content_subject-too-small" in flags,
            "mask_labels": col3,
            "ml_labels": col4,
            "bbox_content_image_multi_bug": "bbox-content_image-multi-bug" in flags,
        })
        if decision_enum.value == "keep":
            return _write(conn, image_id, "keep", "hand:pass", "hand", now_s)
        return _write(
            conn, image_id, "reject",
            _hand_reject_reason(col1, col2_count, flags, col3, col4),
            "hand", now_s,
        )

    # Tier 2: Unresolved report
    rep = conn.execute(
        "SELECT category FROM reports "
        "WHERE image_id = ? AND resolved_at IS NULL "
        "ORDER BY category LIMIT 1",
        (image_id,),
    ).fetchone()
    if rep:
        return _write(conn, image_id, "reject", f"report:{rep[0]}",
                      "report", now_s)

    # Tier 3: Rule
    det = conn.execute(
        "SELECT suggested_labels FROM detections WHERE image_id = ?",
        (image_id,),
    ).fetchone()
    if det:
        rule_labels = json.loads(det[0] or "[]")
        for lbl in rule_labels:
            if lbl in REJECT_RULE_LABELS:
                return _write(conn, image_id, "reject", f"rule:{lbl}",
                              "rule", now_s)

    # Tier 4: ML
    ml = conn.execute(
        "SELECT p.label, p.p, p.model_version, t.threshold, t.threshold_v "
        "FROM predictions p "
        "JOIN label_thresholds t ON p.label = t.label "
        "WHERE p.image_id = ? AND p.unreliable = 0 AND t.tier = 1 "
        "ORDER BY p.label",
        (image_id,),
    ).fetchall()
    for label, p, mv, thresh, thresh_v in ml:
        if p >= thresh:
            return _write(
                conn, image_id, "reject",
                f"ml:{label}:{p:.3f}", "ml", now_s,
                model_version=mv, threshold_v=thresh_v,
            )

    # Tier 5: Default keep
    return _write(conn, image_id, "keep", "defaults_pass", "default", now_s)


def recompute_for_label(
    label: str, conn: sqlite3.Connection, *, now_s: int,
) -> int:
    """Recompute every image with a prediction row for `label`. Returns count."""
    rows = conn.execute(
        "SELECT image_id FROM predictions WHERE label = ?",
        (label,),
    ).fetchall()
    conn.execute("BEGIN")
    try:
        for (image_id,) in rows:
            recompute_for_image(image_id, conn, now_s=now_s)
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    return len(rows)


def recompute_all(conn: sqlite3.Connection, *, now_s: int) -> dict:
    """Recompute every image in `images`. Returns {kept, rejected, elapsed_s}."""
    t0 = time.perf_counter()
    image_ids = [r[0] for r in conn.execute("SELECT image_id FROM images")]
    kept = 0
    rejected = 0
    conn.execute("BEGIN")
    try:
        for image_id in image_ids:
            row = recompute_for_image(image_id, conn, now_s=now_s)
            if row["decision"] == "keep":
                kept += 1
            else:
                rejected += 1
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    elapsed = time.perf_counter() - t0
    print(f"[recompute_gate] {len(image_ids)} images: "
          f"{kept} kept, {rejected} rejected ({elapsed:.1f}s)")
    return {"kept": kept, "rejected": rejected, "elapsed_s": round(elapsed, 1)}


def _cli() -> None:
    ap = argparse.ArgumentParser()
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--all", action="store_true",
                   help="Recompute every image in images.")
    g.add_argument("--image-id", help="Recompute one image.")
    g.add_argument("--label", help="Recompute all rows with a prediction "
                   "for this label.")
    args = ap.parse_args()
    conn = open_conn()
    now_s = int(time.time())
    try:
        if args.all:
            recompute_all(conn, now_s=now_s)
        elif args.image_id:
            row = recompute_for_image(args.image_id, conn, now_s=now_s)
            conn.commit()
            print(json.dumps(row, indent=2))
        else:
            n = recompute_for_label(args.label, conn, now_s=now_s)
            print(f"[recompute_gate] {n} rows touched for label={args.label!r}")
    finally:
        conn.close()


if __name__ == "__main__":
    _cli()
```

- [ ] **Step 4: Run test to verify it passes**

```bash
.venv/bin/python -m pytest tests/python/test_recompute_gate.py -v
```

Expected: 15 PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/detect_subjects/recompute_gate.py tests/python/test_recompute_gate.py
git commit --only --no-gpg-sign -- scripts/detect_subjects/recompute_gate.py tests/python/test_recompute_gate.py -m "feat(detect_subjects): recompute_gate trust hierarchy + CLI"
```

---

## Task 8: Wire train.py to read SQLite image_labels

**Files:**
- Modify: `scripts/detect_subjects/ml_labeler/train.py:25-60` — replace `_load_xy_for_label`
- Modify: `tests/python/test_ml_labeler_train.py` — fixture builds SQLite + image_labels rows

**Background:**
`train.py:_load_xy_for_label` currently parses `data/cache/labels.json` directly. After Task 4 runs, labels live in SQLite. Replace the body to query `image_labels` via `fetch_all_reviewed_labels`. The function signature and (X, y, ids) return shape stay identical so the rest of train.py is unchanged. The existing test (`test_ml_labeler_train.py`) is updated to seed labels via SQLite.

The legacy `flags` schema branch in the current `_load_xy_for_label` is no longer reachable (SQLite has only the new schema). The migrator preserved data already, so this is safe to remove.

- [ ] **Step 1: Update `test_ml_labeler_train.py` to use SQLite labels**

Modify `tests/python/test_ml_labeler_train.py`:

```python
"""Verify training script persists a fitted classifier with metrics."""
import json
import sqlite3
from pathlib import Path
import numpy as np
import polars as pl


IMAGES_SCHEMA = """
CREATE TABLE images (
  image_id TEXT PRIMARY KEY,
  collection_id TEXT NOT NULL, source TEXT NOT NULL, source_id TEXT NOT NULL,
  source_page_url TEXT NOT NULL, image_url TEXT NOT NULL,
  filename TEXT NOT NULL, thumbnail_filename TEXT NOT NULL,
  medium_filename TEXT NOT NULL, file_sha256 TEXT NOT NULL,
  license TEXT NOT NULL, subject_state TEXT NOT NULL,
  hidden INTEGER NOT NULL DEFAULT 0,
  added_at INTEGER NOT NULL DEFAULT (unixepoch())
);
"""
IMAGE_LABELS_SCHEMA = """
CREATE TABLE image_labels (
  image_id TEXT PRIMARY KEY REFERENCES images(image_id) ON DELETE CASCADE,
  col1 TEXT, col2_count TEXT, col2_flags TEXT, col3 TEXT, col4 TEXT,
  unsure INTEGER NOT NULL DEFAULT 0 CHECK (unsure IN (0, 1)),
  reviewed_at INTEGER,
  user_edited INTEGER NOT NULL DEFAULT 0 CHECK (user_edited IN (0, 1)),
  variant_tag TEXT
);
"""


def _fake_parquet_and_db(tmpdir: Path):
    """Build a tiny synthetic parquet + SQLite DB with blur_unusable positives."""
    rng = np.random.default_rng(0)
    n = 80
    image_ids = [f"img-{i:03d}" for i in range(n)]
    sharpness = rng.uniform(100, 500, n)
    sharpness[:40] -= 200  # first 40 are positives, lower sharpness
    df = pl.DataFrame({
        "image_id": image_ids,
        "variant": ["sam3__sam3"] * n,
        "bbox_x": [0.4] * n, "bbox_y": [0.4] * n,
        "bbox_w": [0.2] * n, "bbox_h": [0.2] * n,
        "bbox_area_ratio": [0.04] * n,
        "offcenter": [0.1] * n,
        "bbox_min_edge_px": [200.0] * n,
        "bbox_long_edge_px": [300.0] * n,
        "mask_area_ratio": [0.03] * n,
        "lab_delta_e": [15.0] * n,
        "boundary_sharpness": [5.0] * n,
        "subject_sharpness": sharpness.tolist(),
        "top10pct_lap_mask": [50.0] * n,
        "edge_density_mask_vs_bg": [1.5] * n,
        "confidence": [0.9] * n,
        "n_distinct_detections": [1] * n,
    })
    parquet_path = tmpdir / "test.parquet"
    df.write_parquet(parquet_path)

    db_path = tmpdir / "test.db"
    conn = sqlite3.connect(db_path)
    conn.executescript(IMAGES_SCHEMA)
    conn.executescript(IMAGE_LABELS_SCHEMA)
    for iid in image_ids:
        conn.execute(
            "INSERT INTO images (image_id, collection_id, source, source_id, "
            "source_page_url, image_url, filename, thumbnail_filename, "
            "medium_filename, file_sha256, license, subject_state) "
            "VALUES (?, 'c', 'inaturalist', 's', 'u', 'u', 'f', 't', 'm', "
            "'sha', 'lic', 'wild')",
            (iid,),
        )
    for i, iid in enumerate(image_ids):
        col3 = json.dumps(["mask_blur_unusable"] if i < 40 else [])
        conn.execute(
            "INSERT INTO image_labels (image_id, col1, col2_count, col2_flags, "
            "col3, col4, unsure, reviewed_at, user_edited, variant_tag) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (iid, "bbox_correct-subject_not-clipped", "bbox-content_single",
             "[]", col3, "[]", 0, 1, 1, "sam3__sam3"),
        )
    conn.commit()
    conn.close()
    return parquet_path, db_path


def test_train_blur_unusable_persists_model_and_metrics(tmp_path):
    from scripts.detect_subjects.ml_labeler.train import train_label
    parquet_path, db_path = _fake_parquet_and_db(tmp_path)
    out_dir = tmp_path / "models" / "mask_blur_unusable"
    metrics = train_label(
        label="mask_blur_unusable",
        parquet_path=parquet_path, db_path=db_path,
        out_dir=out_dir, random_state=42,
    )
    assert (out_dir / "arm_scalar_latest.joblib").exists()
    assert (out_dir / "metrics.json").exists()
    assert metrics["arm_scalar"]["mcc_mean"] > 0.3
    assert metrics["n_positives"] == 40
    assert metrics["n_total"] == 80
```

- [ ] **Step 2: Run the updated test to verify it fails**

```bash
.venv/bin/python -m pytest tests/python/test_ml_labeler_train.py -v
```

Expected: FAIL — `train_label()` doesn't accept `db_path` yet; old signature uses `labels_path`.

- [ ] **Step 3: Modify `train.py` to read SQLite**

Replace lines 1-60 of `scripts/detect_subjects/ml_labeler/train.py` with:

```python
"""Per-label training — V1: scalar-arm scikit-learn HistGradientBoostingClassifier
(TabPFN-v2 deferred pending license token) for mask_blur_unusable.

Loads framing_detections.parquet + SQLite image_labels, builds (X, y) for one
label, runs 5x5 stratified CV, fits a final model on all data, persists
joblib + metrics + writes suggested_threshold (recall ≥ 0.95) into
label_thresholds.

Future (Plan 2+): adds image arm (DINOv3+DoRA), runs both arms, picks winner.
"""
from __future__ import annotations
import json
import time
from pathlib import Path
from typing import Optional

import joblib
import numpy as np
import polars as pl

from scripts.detect_subjects.ml_labeler.features import (
    SCALAR_FEATURE_NAMES, scalar_feature_vector,
)
from scripts.detect_subjects.ml_labeler.evaluation import cv_evaluate
from scripts.detect_subjects.sqlite_db import open_conn, DEFAULT_DB_PATH
from scripts.detect_subjects.image_labels_io import fetch_all_reviewed_labels


def _load_xy_for_label(
    parquet_path: Path, db_path: Path, label: str,
) -> tuple[np.ndarray, np.ndarray, list[str]]:
    """Return X (n,12), y (n,), image_ids list. Only sam3__sam3 rows whose
    image_id has a reviewed, user_edited row in image_labels are included."""
    conn = open_conn(db_path)
    try:
        labels = fetch_all_reviewed_labels(conn)
    finally:
        conn.close()
    df = pl.read_parquet(parquet_path).filter(pl.col("variant") == "sam3__sam3")
    X_rows, y_rows, ids = [], [], []
    for row in df.iter_rows(named=True):
        iid = row["image_id"]
        lbl = labels.get(iid)
        if not lbl or not lbl.get("user_edited"):
            continue
        # 'unsure' = user couldn't decide; not a negative example — exclude.
        if lbl.get("unsure"):
            continue
        col3 = lbl.get("col3") or []
        if label in col3:
            y_rows.append(1)
        elif lbl.get("col1") is not None or lbl.get("col2_count") is not None:
            y_rows.append(0)
        else:
            continue  # empty record, ambiguous — skip
        X_rows.append(scalar_feature_vector(row))
        ids.append(iid)
    X = np.asarray(X_rows, dtype=np.float32)
    y = np.asarray(y_rows, dtype=np.int8)
    return X, y, ids
```

Then update `train_label()` (lines 78+ of the existing file) to accept `db_path` instead of `labels_path`:

```python
def train_label(
    label: str,
    parquet_path: Path = Path("data/cache/framing_detections.parquet"),
    db_path: Path = DEFAULT_DB_PATH,
    out_dir: Optional[Path] = None,
    random_state: int = 42,
) -> dict:
    """Train scalar-arm HistGradientBoosting classifier for `label`. Returns metrics dict.

    Also writes label_thresholds.suggested_threshold for `label` (recall ≥ 0.95
    on the CV held-out probabilities). Does NOT touch the live `threshold`
    column — that is human-edited only.
    """
    if out_dir is None:
        from scripts.detect_subjects.ml_labeler import MODELS_DIR
        out_dir = MODELS_DIR / label
    out_dir.mkdir(parents=True, exist_ok=True)

    X, y, ids = _load_xy_for_label(parquet_path, db_path, label)
    n_pos = int(y.sum())
    n_total = len(y)
    print(f"[train:{label}] n_total={n_total}, n_positives={n_pos}")

    if n_pos < 5 or n_total - n_pos < 5:
        raise ValueError(
            f"Label {label!r} too imbalanced: {n_pos} pos / {n_total-n_pos} neg. "
            "Need >=5 of each class."
        )

    t0 = time.perf_counter()
    cv_metrics = cv_evaluate(_scalar_clf_factory, X, y, n_splits=5, n_repeats=5,
                             random_state=random_state)
    cv_elapsed = time.perf_counter() - t0
    print(f"[train:{label}] CV ({cv_metrics['n_folds']} folds) in {cv_elapsed:.1f}s: "
          f"MCC={cv_metrics['mcc_mean']:.3f}±{cv_metrics['mcc_std']:.3f}, "
          f"PR-AUC={cv_metrics['pr_auc_mean']:.3f}, Brier={cv_metrics['brier_mean']:.3f}")

    final_clf = _scalar_clf_factory()
    final_clf.fit(X, y)
    trained_at = int(time.time())
    model_path = out_dir / "arm_scalar_latest.joblib"
    joblib.dump({
        "label": label, "arm": "scalar",
        "clf_class": type(final_clf).__name__,
        "clf": final_clf,
        "feature_names": SCALAR_FEATURE_NAMES,
        "n_train": n_total, "n_positives": n_pos,
        "trained_at": trained_at,
    }, model_path)
    print(f"[train:{label}] persisted → {model_path}")

    # Write the recall ≥ 0.95 suggested threshold from CV held-out probs.
    suggested = _recall_threshold(cv_metrics, target_recall=0.95)
    if suggested is not None:
        _write_suggested_threshold(db_path, label, suggested, trained_at)

    metrics = {
        "label": label, "n_total": n_total, "n_positives": n_pos,
        "arm_scalar": cv_metrics,
        "trained_at": trained_at,
        "cv_elapsed_s": round(cv_elapsed, 1),
        "suggested_threshold": suggested,
    }
    (out_dir / "metrics.json").write_text(json.dumps(metrics, indent=2))
    return metrics


def _recall_threshold(cv_metrics: dict, target_recall: float) -> Optional[float]:
    """Lowest threshold such that mean recall >= target_recall.
    Requires cv_metrics to include 'p_holdout' (concatenated CV-fold probs)
    and 'y_holdout'. Returns None if cv_evaluate didn't surface them."""
    p = cv_metrics.get("p_holdout")
    y = cv_metrics.get("y_holdout")
    if p is None or y is None:
        return None
    p = np.asarray(p)
    y = np.asarray(y)
    if not y.any():
        return None
    # Try thresholds along sorted positive-prob descents.
    sorted_p = np.sort(np.unique(p))[::-1]
    for t in sorted_p:
        recall = ((p >= t) & (y == 1)).sum() / max(int(y.sum()), 1)
        if recall >= target_recall:
            return float(t)
    return float(sorted_p[-1])


def _write_suggested_threshold(
    db_path: Path, label: str, value: float, now_s: int,
) -> None:
    conn = open_conn(db_path)
    try:
        # Update only suggested_threshold + updated_at. Per spec, `threshold`
        # is human-edited and not touched here.
        conn.execute(
            "UPDATE label_thresholds SET suggested_threshold = ?, updated_at = ? "
            "WHERE label = ?",
            (value, now_s, label),
        )
        conn.commit()
    finally:
        conn.close()
```

Note: `_scalar_clf_factory` stays the same — keep the existing definition.

The `_recall_threshold` helper requires `cv_evaluate` to surface concatenated held-out probabilities. The current `evaluation.py:cv_evaluate` does NOT return them. Edit `scripts/detect_subjects/ml_labeler/evaluation.py` to add them:

```python
def cv_evaluate(
    clf_factory: Callable, X: np.ndarray, y: np.ndarray,
    n_splits: int = 5, n_repeats: int = 5, random_state: int = 42,
) -> dict:
    """5x5 stratified CV. Returns metric means/stds AND concatenated held-out
    probabilities + labels (consumed by train._recall_threshold)."""
    rskf = RepeatedStratifiedKFold(
        n_splits=n_splits, n_repeats=n_repeats, random_state=random_state,
    )
    mccs, prs, briers = [], [], []
    p_holdout: list[float] = []
    y_holdout: list[int] = []
    for train_idx, test_idx in rskf.split(X, y):
        X_tr, X_te = X[train_idx], X[test_idx]
        y_tr, y_te = y[train_idx], y[test_idx]
        clf = clf_factory()
        clf.fit(X_tr, y_tr)
        prob_pos = clf.predict_proba(X_te)[:, 1]
        pred = (prob_pos >= 0.5).astype(np.int8)
        mccs.append(matthews_corrcoef(y_te, pred))
        if len(np.unique(y_te)) == 2:
            prs.append(average_precision_score(y_te, prob_pos))
        briers.append(brier_score_loss(y_te, prob_pos))
        p_holdout.extend(prob_pos.tolist())
        y_holdout.extend(y_te.tolist())
    return {
        "mcc_mean": float(np.mean(mccs)),
        "mcc_std": float(np.std(mccs)),
        "pr_auc_mean": float(np.mean(prs)) if prs else float("nan"),
        "brier_mean": float(np.mean(briers)),
        "n_folds": n_splits * n_repeats,
        "p_holdout": p_holdout,
        "y_holdout": y_holdout,
    }
```

Also extend `tests/python/test_ml_labeler_evaluation.py` (or add new assertions to its existing test) verifying `p_holdout` and `y_holdout` are returned, with `len(p_holdout) == n_splits * n_repeats * len(X) / n_splits` (i.e., every sample appears in `n_repeats` held-out folds).

- [ ] **Step 4: Run all relevant tests**

```bash
.venv/bin/python -m pytest tests/python/test_ml_labeler_train.py tests/python/test_ml_labeler_evaluation.py -v
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/detect_subjects/ml_labeler/train.py scripts/detect_subjects/ml_labeler/evaluation.py tests/python/test_ml_labeler_train.py
git commit --only --no-gpg-sign -- scripts/detect_subjects/ml_labeler/train.py scripts/detect_subjects/ml_labeler/evaluation.py tests/python/test_ml_labeler_train.py -m "feat(ml_labeler): train.py reads SQLite image_labels + writes suggested_threshold"
```

---

## Task 9: Wire predict.py — sync to SQLite + recompute_for_label

**Files:**
- Modify: `scripts/detect_subjects/ml_labeler/predict.py:39-76` — extend `predict_labels_batched`
- Modify: `tests/python/test_ml_labeler_predict.py` — verify SQLite side-effects

**Background:**
After `predict.py` writes `predicted_<label>_p` to parquet, the new sync step pushes those values into `predictions` and triggers `recompute_for_label` so `gate_decisions` reflects the freshly-updated probabilities. The model_version string is `<label>@<bundle_trained_at>`.

- [ ] **Step 1: Update `test_ml_labeler_predict.py` to cover the SQLite side-effects**

Find the existing test in `tests/python/test_ml_labeler_predict.py`. Add a new test that verifies:

```python
def test_predict_writes_to_predictions_and_triggers_gate(tmp_path):
    """End-to-end: train → predict → predictions rows exist + gate_decisions written."""
    import sqlite3
    from scripts.detect_subjects.ml_labeler.train import train_label
    from scripts.detect_subjects.ml_labeler.predict import predict_labels_batched

    # Reuse fake parquet + DB helper from train test.
    from tests.python.test_ml_labeler_train import _fake_parquet_and_db
    parquet_path, db_path = _fake_parquet_and_db(tmp_path)
    # We also need the predictions + gate_decisions + label_thresholds tables.
    conn = sqlite3.connect(db_path)
    conn.executescript("""
      CREATE TABLE predictions (
        image_id TEXT NOT NULL REFERENCES images(image_id) ON DELETE CASCADE,
        label TEXT NOT NULL, p REAL NOT NULL,
        unreliable INTEGER NOT NULL DEFAULT 0 CHECK (unreliable IN (0, 1)),
        model_version TEXT NOT NULL, predicted_at INTEGER NOT NULL,
        PRIMARY KEY (image_id, label)
      );
      CREATE TABLE gate_decisions (
        image_id TEXT PRIMARY KEY REFERENCES images(image_id) ON DELETE CASCADE,
        decision TEXT NOT NULL CHECK (decision IN ('keep','reject')),
        reason TEXT NOT NULL,
        reason_source TEXT NOT NULL CHECK (reason_source IN ('hand','report','rule','ml','default')),
        computed_at INTEGER NOT NULL,
        model_version TEXT, threshold_v INTEGER
      );
      CREATE TABLE label_thresholds (
        label TEXT PRIMARY KEY, tier INTEGER NOT NULL CHECK (tier IN (1, 2)),
        threshold REAL NOT NULL, suggested_threshold REAL,
        threshold_v INTEGER NOT NULL, notes TEXT, updated_at INTEGER NOT NULL
      );
      INSERT INTO label_thresholds (label, tier, threshold, threshold_v, updated_at)
        VALUES ('mask_blur_unusable', 1, 0.5, 1, 1);
    """)
    conn.commit()
    conn.close()

    out_dir = tmp_path / "models" / "mask_blur_unusable"
    train_label(label="mask_blur_unusable", parquet_path=parquet_path,
                db_path=db_path, out_dir=out_dir, random_state=42)
    predict_labels_batched(
        labels=["mask_blur_unusable"], parquet_path=parquet_path,
        models_dir=tmp_path / "models", db_path=db_path,
    )

    conn = sqlite3.connect(db_path)
    n_preds = conn.execute("SELECT COUNT(*) FROM predictions").fetchone()[0]
    n_gates = conn.execute("SELECT COUNT(*) FROM gate_decisions").fetchone()[0]
    conn.close()
    assert n_preds == 80
    assert n_gates >= 1  # at least some images got a gate decision via the label path
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
.venv/bin/python -m pytest tests/python/test_ml_labeler_predict.py::test_predict_writes_to_predictions_and_triggers_gate -v
```

Expected: FAIL — `predict_labels_batched` doesn't accept `db_path` or `models_dir` yet.

- [ ] **Step 3: Modify `predict.py` to sync + recompute**

Replace `scripts/detect_subjects/ml_labeler/predict.py` with:

```python
"""Batch inference: load joblib classifier(s), predict probabilities for every
sam3__sam3 row in the parquet, write predicted_<label>_p / _unreliable cols,
sync to SQLite `predictions`, and trigger gate recompute for the label.

V1: scalar-arm only.

CONCURRENCY: This function reads, modifies, and rewrites the entire parquet
file. Do not run concurrently with classify.py (which also rewrites the
parquet on each batch flush).
"""
from __future__ import annotations
import time
from pathlib import Path
from typing import Optional

import joblib
import numpy as np
import polars as pl

from scripts.detect_subjects.ml_labeler.features import (
    SCALAR_FEATURE_NAMES, scalar_feature_vector,
)
from scripts.detect_subjects.predictions_sync import (
    sync_predictions_from_parquet, model_version_for,
)
from scripts.detect_subjects.recompute_gate import recompute_for_label
from scripts.detect_subjects.sqlite_db import open_conn, DEFAULT_DB_PATH


def _load_bundle(label: str, models_dir: Optional[Path]) -> dict:
    if models_dir is None:
        from scripts.detect_subjects.ml_labeler import MODELS_DIR
        models_dir = MODELS_DIR
    model_path = models_dir / label / "arm_scalar_latest.joblib"
    bundle = joblib.load(model_path)
    if bundle.get("feature_names") != SCALAR_FEATURE_NAMES:
        raise ValueError(
            f"Feature-name drift between bundle and current features.py:\n"
            f"  bundle:  {bundle.get('feature_names')}\n"
            f"  current: {SCALAR_FEATURE_NAMES}\n"
            f"Retrain {label!r} after a features.py change."
        )
    return bundle


def predict_labels_batched(
    labels: list[str],
    parquet_path: Path = Path("data/cache/framing_detections.parquet"),
    unreliable_threshold: int = 30,
    db_path: Path = DEFAULT_DB_PATH,
    models_dir: Optional[Path] = None,
) -> dict[str, int]:
    """One parquet read + N inferences + one parquet write + sync to SQLite +
    gate recompute. Returns {label: n_rows_updated}."""
    bundles = {lbl: _load_bundle(lbl, models_dir) for lbl in labels}

    df = pl.read_parquet(parquet_path)
    sam3_rows = df.filter(pl.col("variant") == "sam3__sam3")
    X = np.stack([scalar_feature_vector(row) for row in sam3_rows.iter_rows(named=True)])
    sam3_ids = sam3_rows["image_id"].to_list()

    new_cols: list[pl.Expr] = []
    counts: dict[str, int] = {}
    model_versions: dict[str, str] = {}
    for lbl in labels:
        bundle = bundles[lbl]
        probs = bundle["clf"].predict_proba(X)[:, 1].astype(np.float32)
        prob_map = dict(zip(sam3_ids, probs))
        unreliable = bundle["n_positives"] < unreliable_threshold

        p_col = f"predicted_{lbl}_p"
        u_col = f"predicted_{lbl}_unreliable"
        new_p = df["image_id"].map_elements(
            lambda i: float(prob_map.get(i, float("nan"))), return_dtype=pl.Float64
        ).cast(pl.Float32)
        new_u = df["image_id"].map_elements(
            lambda i: bool(unreliable) if i in prob_map else None, return_dtype=pl.Boolean
        )
        new_cols += [new_p.alias(p_col), new_u.alias(u_col)]
        counts[lbl] = len(prob_map)
        model_versions[lbl] = model_version_for(lbl, bundle)

    df = df.with_columns(new_cols)
    df.write_parquet(parquet_path)
    for lbl, n in counts.items():
        print(f"[predict:{lbl}] updated {n} rows with prob+unreliable cols")

    # Sync to SQLite predictions + trigger gate recompute per label.
    now_s = int(time.time())
    sync_predictions_from_parquet(
        parquet_path, labels, model_versions=model_versions,
        now_s=now_s, db_path=db_path,
    )
    conn = open_conn(db_path)
    try:
        for lbl in labels:
            n = recompute_for_label(lbl, conn, now_s=now_s)
            print(f"[predict:{lbl}] gate recompute touched {n} rows")
    finally:
        conn.close()

    return counts


def predict_label_into_parquet(
    label: str,
    parquet_path: Path = Path("data/cache/framing_detections.parquet"),
    model_path: Optional[Path] = None,
    unreliable_threshold: int = 30,
) -> int:
    """Single-label predict — convenience wrapper. Prefer predict_labels_batched
    when updating multiple labels at once."""
    counts = predict_labels_batched(
        [label], parquet_path=parquet_path,
        unreliable_threshold=unreliable_threshold,
    )
    return counts[label]


if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1:
        predict_label_into_parquet(sys.argv[1])
    else:
        from scripts.detect_subjects.ml_labeler import TIER1_LABELS
        predict_labels_batched(TIER1_LABELS)
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
.venv/bin/python -m pytest tests/python/test_ml_labeler_predict.py -v
```

Expected: all PASS (including the new SQLite side-effect test).

- [ ] **Step 5: Commit**

```bash
git add scripts/detect_subjects/ml_labeler/predict.py tests/python/test_ml_labeler_predict.py
git commit --only --no-gpg-sign -- scripts/detect_subjects/ml_labeler/predict.py tests/python/test_ml_labeler_predict.py -m "feat(ml_labeler): predict.py syncs predictions to SQLite + recomputes gate"
```

---

## Task 10: Wire classify.py — sync detections at end of run

**Files:**
- Modify: `scripts/detect_subjects/classify.py:377-381` — append a sync call after the final flush
- Test: existing `tests/python/test_classify_integration.py` — extend to check SQLite side-effects

**Background:**
At the end of `run_v1_on_sample`, after the final `_flush_records`, call `sync_detections_from_parquet` so the SQLite `detections` table mirrors the parquet. This runs once per `classify.py` invocation, not per image — a 39k-image table sync takes a few seconds.

The existing `tests/python/test_classify_integration.py` uses `_stub` detector/segmenter to produce a synthetic detection row for `stub-integration-0001`. We extend it with a new test that creates a tmp SQLite DB, monkeypatches `sqlite_db.DEFAULT_DB_PATH` to point there, and verifies the detections table got the sync.

- [ ] **Step 1: Add the new test to `test_classify_integration.py`**

Append to `tests/python/test_classify_integration.py`:

```python
import sqlite3

IMAGES_SCHEMA = """
CREATE TABLE images (
  image_id TEXT PRIMARY KEY,
  collection_id TEXT NOT NULL, source TEXT NOT NULL, source_id TEXT NOT NULL,
  source_page_url TEXT NOT NULL, image_url TEXT NOT NULL,
  filename TEXT NOT NULL, thumbnail_filename TEXT NOT NULL,
  medium_filename TEXT NOT NULL, file_sha256 TEXT NOT NULL,
  license TEXT NOT NULL, subject_state TEXT NOT NULL,
  hidden INTEGER NOT NULL DEFAULT 0,
  added_at INTEGER NOT NULL DEFAULT (unixepoch())
);
"""
DETECTIONS_SCHEMA = """
CREATE TABLE detections (
  image_id TEXT PRIMARY KEY REFERENCES images(image_id) ON DELETE CASCADE,
  variant TEXT NOT NULL,
  suggested_labels TEXT NOT NULL,
  gate_rule_only TEXT NOT NULL CHECK (gate_rule_only IN ('keep','reject')),
  has_bbox INTEGER NOT NULL CHECK (has_bbox IN (0, 1)),
  bbox_x REAL, bbox_y REAL, bbox_w REAL, bbox_h REAL,
  mask_area_ratio REAL, lab_delta_e REAL, boundary_sharpness REAL,
  mask_iou_score REAL,
  crop_x REAL, crop_y REAL, crop_w REAL, crop_h REAL,
  post_crop_subject_area REAL,
  processed_at INTEGER NOT NULL, schema_version INTEGER NOT NULL
);
"""


def test_run_v1_syncs_detections_to_sqlite(tmp_path, monkeypatch):
    """run_v1_on_sample, after writing parquet, also syncs detections to SQLite."""
    images_dir = tmp_path / "images"
    images_dir.mkdir()
    img = Image.new("RGB", (320, 240), color=(100, 150, 80))
    img.save(str(images_dir / f"{STUB_IMAGE_ID}.jpg"), "JPEG")

    db_path = tmp_path / "test.db"
    conn = sqlite3.connect(db_path)
    conn.executescript(IMAGES_SCHEMA)
    conn.executescript(DETECTIONS_SCHEMA)
    conn.execute(
        "INSERT INTO images (image_id, collection_id, source, source_id, "
        "source_page_url, image_url, filename, thumbnail_filename, "
        "medium_filename, file_sha256, license, subject_state) "
        "VALUES (?, 'c', 'inaturalist', 's', 'u', 'u', 'f', 't', 'm', "
        "'sha', 'lic', 'wild')",
        (STUB_IMAGE_ID,),
    )
    conn.commit()
    conn.close()

    parquet_path = tmp_path / "test_output.parquet"
    sample_rows = [{
        "image_id": STUB_IMAGE_ID,
        "source": STUB_SOURCE,
        "subject_state": "wild",
        "filename": f"images/{STUB_IMAGE_ID}.jpg",
    }]

    # open_conn reads DEFAULT_DB_PATH at call time, so monkeypatching the
    # sqlite_db module attribute redirects every consumer (sync_detections,
    # recompute_gate, etc.) to the tmp DB.
    monkeypatch.setattr(
        "scripts.detect_subjects.sqlite_db.DEFAULT_DB_PATH", db_path,
    )

    with patch("scripts.detect_subjects.classify.DATA_DIR", tmp_path), \
         patch("scripts.detect_subjects.classify.cfg.DETECTOR_VARIANT", "_stub"), \
         patch("scripts.detect_subjects.classify.cfg.SEGMENTER_VARIANT", "_stub"), \
         patch("scripts.detect_subjects.classify.CROPS_DIR", tmp_path / "crops"):
        from scripts.detect_subjects.classify import run_v1_on_sample
        summary = run_v1_on_sample(
            sample_rows=sample_rows, parquet_path=parquet_path, device="cpu",
        )

    assert summary["processed"] == 1
    assert summary["sqlite_detections_upserted"] == 1

    conn = sqlite3.connect(db_path)
    rows = list(conn.execute(
        "SELECT image_id, variant, has_bbox FROM detections"
    ))
    conn.close()
    assert len(rows) == 1
    assert rows[0][0] == STUB_IMAGE_ID
    assert "__" in rows[0][1]   # variant is detector__segmenter
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
.venv/bin/python -m pytest tests/python/test_classify_integration.py::test_run_v1_syncs_detections_to_sqlite -v
```

Expected: FAIL — `summary` has no `sqlite_detections_upserted` key because classify.py doesn't sync yet.

- [ ] **Step 3: Modify `classify.py` to sync after the loop**

In `scripts/detect_subjects/classify.py`, find the tail of `run_v1_on_sample` (around line 377):

```python
    if pending_records:
        _flush_records(pending_records, parquet_path)
    summary["elapsed_s"] = time.perf_counter() - t_start
    return summary
```

Replace with:

```python
    if pending_records:
        _flush_records(pending_records, parquet_path)
    summary["elapsed_s"] = time.perf_counter() - t_start

    # Sync the parquet's per-row detections into SQLite for the production
    # gate. Latest-variant-wins; idempotent if no parquet rows changed.
    try:
        from scripts.detect_subjects.detections_sync import sync_detections_from_parquet
        sync_result = sync_detections_from_parquet(parquet_path)
        summary["sqlite_detections_upserted"] = sync_result["upserted"]
    except Exception as e:
        # Don't fail the whole classify run on a sync hiccup — the parquet
        # is still good and a manual rerun of sync_detections will recover.
        print(f"[v1] WARN detections sync failed: {type(e).__name__}: {e}")
        summary["sqlite_detections_upserted"] = -1

    return summary
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
.venv/bin/python -m pytest tests/python/test_classify_integration.py -v
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/detect_subjects/classify.py tests/python/test_classify_integration.py
git commit --only --no-gpg-sign -- scripts/detect_subjects/classify.py tests/python/test_classify_integration.py -m "feat(classify): sync detections to SQLite at end of run"
```

---

## Task 11: Wire label_server.py — read/write SQLite + recompute per image

**Files:**
- Modify: `scripts/detect_subjects/label_server.py` — replace `_read_labels` / `_atomic_write_labels` to use SQLite; stop the autosnapshot thread; call `recompute_for_image` on every upsert

**Background:**
Today `label_server.py` reads/writes `data/cache/labels.json` and runs an autosnapshot thread. Post-migration, image_labels in SQLite is the source of truth. The server still serves the legacy HTML validator (Plan 4 ports it to React), so we keep the GET/POST shape identical from the UI's perspective — it still receives/posts a JSON dict `{image_id: record}`.

**Critical UI compatibility constraint:** the validator's JS removes a key from its local `LABELS` dict when the user un-marks every label on a card (template `_persist`, lines 591-603). It then POSTs the smaller dict. Today the file-based handler overwrites `labels.json` so the row vanishes. The SQLite handler MUST do the same: rows whose image_id is not in the POST payload get deleted. Without this, "un-marking" a card silently fails — the orphaned row stays in `image_labels` and the gate keeps treating it as a hand label.

**Atomicity:** the legacy `_atomic_write_labels` was all-or-nothing (`os.replace` of a temp file). The SQLite handler preserves this with a single `BEGIN ... COMMIT` around the delete-missing + upsert-all + recompute-all sequence. A mid-save crash either leaves the previous state intact or the new state in full.

Changes:
- `GET /api/labels` → reads ALL rows from `image_labels`, returns the dict
- `POST /api/labels` → atomic transaction: delete rows not in payload + upsert payload rows + recompute_for_image for every touched id
- Drop the autosnapshot thread (SQLite + WAL is the durability story now)
- Drop the labels.json `{}` stomp guard (replaced by an explicit "is this really intentional?" check — see Step 3)
- Keep the bind-to-127.0.0.1 + /api/retrain/<label> endpoints unchanged

There's no separate test file for label_server.py today; we'll write one as part of this task.

- [ ] **Step 1: Write the failing test**

Create `tests/python/test_label_server.py`:

```python
"""HTTP roundtrip tests for the SQLite-backed label server."""
from __future__ import annotations
import json
import sqlite3
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

import pytest


SCHEMA = """
CREATE TABLE images (
  image_id TEXT PRIMARY KEY,
  collection_id TEXT NOT NULL, source TEXT NOT NULL, source_id TEXT NOT NULL,
  source_page_url TEXT NOT NULL, image_url TEXT NOT NULL,
  filename TEXT NOT NULL, thumbnail_filename TEXT NOT NULL,
  medium_filename TEXT NOT NULL, file_sha256 TEXT NOT NULL,
  license TEXT NOT NULL, subject_state TEXT NOT NULL,
  hidden INTEGER NOT NULL DEFAULT 0,
  added_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  image_id TEXT NOT NULL REFERENCES images(image_id) ON DELETE CASCADE,
  category TEXT NOT NULL, message TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  resolved_at INTEGER, resolved_action TEXT
);
CREATE TABLE image_labels (
  image_id TEXT PRIMARY KEY REFERENCES images(image_id) ON DELETE CASCADE,
  col1 TEXT, col2_count TEXT, col2_flags TEXT, col3 TEXT, col4 TEXT,
  unsure INTEGER NOT NULL DEFAULT 0 CHECK (unsure IN (0, 1)),
  reviewed_at INTEGER,
  user_edited INTEGER NOT NULL DEFAULT 0 CHECK (user_edited IN (0, 1)),
  variant_tag TEXT
);
CREATE TABLE detections (
  image_id TEXT PRIMARY KEY REFERENCES images(image_id) ON DELETE CASCADE,
  variant TEXT NOT NULL, suggested_labels TEXT NOT NULL,
  gate_rule_only TEXT NOT NULL CHECK (gate_rule_only IN ('keep','reject')),
  has_bbox INTEGER NOT NULL CHECK (has_bbox IN (0, 1)),
  bbox_x REAL, bbox_y REAL, bbox_w REAL, bbox_h REAL,
  mask_area_ratio REAL, lab_delta_e REAL, boundary_sharpness REAL,
  mask_iou_score REAL,
  crop_x REAL, crop_y REAL, crop_w REAL, crop_h REAL,
  post_crop_subject_area REAL,
  processed_at INTEGER NOT NULL, schema_version INTEGER NOT NULL
);
CREATE TABLE predictions (
  image_id TEXT NOT NULL REFERENCES images(image_id) ON DELETE CASCADE,
  label TEXT NOT NULL, p REAL NOT NULL,
  unreliable INTEGER NOT NULL DEFAULT 0 CHECK (unreliable IN (0, 1)),
  model_version TEXT NOT NULL, predicted_at INTEGER NOT NULL,
  PRIMARY KEY (image_id, label)
);
CREATE TABLE gate_decisions (
  image_id TEXT PRIMARY KEY REFERENCES images(image_id) ON DELETE CASCADE,
  decision TEXT NOT NULL CHECK (decision IN ('keep','reject')),
  reason TEXT NOT NULL,
  reason_source TEXT NOT NULL CHECK (reason_source IN ('hand','report','rule','ml','default')),
  computed_at INTEGER NOT NULL, model_version TEXT, threshold_v INTEGER
);
CREATE TABLE label_thresholds (
  label TEXT PRIMARY KEY, tier INTEGER NOT NULL CHECK (tier IN (1, 2)),
  threshold REAL NOT NULL, suggested_threshold REAL,
  threshold_v INTEGER NOT NULL, notes TEXT, updated_at INTEGER NOT NULL
);
"""


@pytest.fixture
def tmp_db(tmp_path):
    db = tmp_path / "test.db"
    conn = sqlite3.connect(db)
    conn.executescript(SCHEMA)
    conn.execute(
        "INSERT INTO images (image_id, collection_id, source, source_id, "
        "source_page_url, image_url, filename, thumbnail_filename, "
        "medium_filename, file_sha256, license, subject_state) "
        "VALUES ('img-1', 'c', 'inaturalist', 's', 'u', 'u', 'f', 't', "
        "'m', 'sha', 'lic', 'wild')"
    )
    conn.commit()
    conn.close()
    return db


@pytest.fixture
def server_url(tmp_db, monkeypatch):
    """Start the label server in a thread on a free port; tear down."""
    import socket
    from scripts.detect_subjects import label_server
    monkeypatch.setattr(
        "scripts.detect_subjects.sqlite_db.DEFAULT_DB_PATH", tmp_db,
    )
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    httpd_holder = {}

    def _run():
        from http.server import ThreadingHTTPServer
        httpd = ThreadingHTTPServer(("127.0.0.1", port), label_server.LabelServerHandler)
        httpd_holder["s"] = httpd
        httpd.serve_forever()
    th = threading.Thread(target=_run, daemon=True)
    th.start()
    # Wait for port to come up.
    for _ in range(50):
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{port}/api/labels", timeout=0.2)
            break
        except Exception:
            time.sleep(0.05)
    yield f"http://127.0.0.1:{port}"
    httpd_holder["s"].shutdown()


def test_get_returns_empty_dict_when_no_labels(server_url):
    resp = urllib.request.urlopen(f"{server_url}/api/labels")
    assert resp.status == 200
    assert json.loads(resp.read()) == {}


def test_post_upserts_label_and_recomputes_gate(server_url, tmp_db):
    record = {
        "img-1": {
            "col1": "bbox_correct-subject_not-clipped",
            "col2_count": "bbox-content_single",
            "col2_flags": [], "col3": ["mask_blur_unusable"], "col4": [],
            "unsure": False, "reviewed_at": 1779000000000, "user_edited": True,
            "variant_tag": "sam3__sam3",
        },
    }
    req = urllib.request.Request(
        f"{server_url}/api/labels", data=json.dumps(record).encode(),
        headers={"Content-Type": "application/json"}, method="POST",
    )
    resp = urllib.request.urlopen(req)
    assert resp.status == 200
    payload = json.loads(resp.read())
    assert payload["ok"] is True

    # GET should now return the record
    resp = urllib.request.urlopen(f"{server_url}/api/labels")
    got = json.loads(resp.read())
    assert got["img-1"]["col3"] == ["mask_blur_unusable"]

    # gate_decisions should have a hand-reject row for img-1
    conn = sqlite3.connect(tmp_db)
    row = conn.execute(
        "SELECT decision, reason_source FROM gate_decisions WHERE image_id='img-1'"
    ).fetchone()
    conn.close()
    assert row == ("reject", "hand")


def test_post_empty_dict_into_empty_table_is_noop(server_url, tmp_db):
    """A bare {} POST against an empty image_labels is OK (no rows to wipe)."""
    req = urllib.request.Request(
        f"{server_url}/api/labels", data=b"{}",
        headers={"Content-Type": "application/json"}, method="POST",
    )
    resp = urllib.request.urlopen(req)
    assert resp.status == 200
    conn = sqlite3.connect(tmp_db)
    n = conn.execute("SELECT COUNT(*) FROM image_labels").fetchone()[0]
    conn.close()
    assert n == 0


def test_post_empty_dict_against_existing_rows_is_rejected(server_url, tmp_db):
    """Stomp guard: an empty POST when image_labels has rows is treated as a
    UI bug and rejected with 400, preserving the data."""
    # Pre-seed a row.
    conn = sqlite3.connect(tmp_db)
    conn.execute(
        "INSERT INTO image_labels (image_id, col1, col2_count, col2_flags, "
        "col3, col4, unsure, reviewed_at, user_edited, variant_tag) "
        "VALUES ('img-1', 'bbox_correct-subject_not-clipped', 'bbox-content_single', "
        "'[]', '[]', '[]', 0, 100, 1, 'sam3__sam3')"
    )
    conn.commit()
    conn.close()
    req = urllib.request.Request(
        f"{server_url}/api/labels", data=b"{}",
        headers={"Content-Type": "application/json"}, method="POST",
    )
    try:
        urllib.request.urlopen(req)
        raised = False
    except urllib.error.HTTPError as e:
        raised = (e.code == 400)
    assert raised
    conn = sqlite3.connect(tmp_db)
    n = conn.execute("SELECT COUNT(*) FROM image_labels").fetchone()[0]
    conn.close()
    assert n == 1  # row preserved


def test_post_deletes_rows_not_in_payload(server_url, tmp_db):
    """If a key is absent from the POST body, its row is removed — matches
    the legacy labels.json overwrite behavior the UI relies on for 'un-mark'."""
    # Pre-seed two rows.
    conn = sqlite3.connect(tmp_db)
    for iid in ("img-1", "img-2"):
        conn.execute(
            "INSERT INTO images (image_id, collection_id, source, source_id, "
            "source_page_url, image_url, filename, thumbnail_filename, "
            "medium_filename, file_sha256, license, subject_state) "
            "VALUES (?, 'c', 'inaturalist', 's', 'u', 'u', 'f', 't', 'm', "
            "'sha', 'lic', 'wild') ON CONFLICT(image_id) DO NOTHING",
            (iid,),
        )
        conn.execute(
            "INSERT INTO image_labels (image_id, col1, col2_count, col2_flags, "
            "col3, col4, unsure, reviewed_at, user_edited, variant_tag) "
            "VALUES (?, 'bbox_correct-subject_not-clipped', 'bbox-content_single', "
            "'[]', '[]', '[]', 0, 100, 1, 'sam3__sam3') "
            "ON CONFLICT(image_id) DO NOTHING",
            (iid,),
        )
    conn.commit()
    conn.close()
    # POST a body that only contains img-1 — img-2 must be deleted.
    payload = {
        "img-1": {
            "col1": "bbox_correct-subject_not-clipped",
            "col2_count": "bbox-content_single",
            "col2_flags": [], "col3": [], "col4": [],
            "unsure": False, "reviewed_at": 200, "user_edited": True,
            "variant_tag": "sam3__sam3",
        },
    }
    req = urllib.request.Request(
        f"{server_url}/api/labels", data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"}, method="POST",
    )
    resp = urllib.request.urlopen(req)
    body = json.loads(resp.read())
    assert resp.status == 200
    assert body["deleted"] == 1
    assert body["upserted"] == 1
    conn = sqlite3.connect(tmp_db)
    rows = list(conn.execute("SELECT image_id FROM image_labels ORDER BY image_id"))
    conn.close()
    assert rows == [("img-1",)]
```

- [ ] **Step 2: Run test to verify it fails**

```bash
.venv/bin/python -m pytest tests/python/test_label_server.py -v
```

Expected: 5 FAIL — server still reads labels.json, no SQLite plumbing yet.

- [ ] **Step 3: Rewrite the labels endpoints**

Replace `_read_labels`, `_atomic_write_labels`, and `LabelServerHandler.do_POST` in `scripts/detect_subjects/label_server.py`:

```python
"""Static-file server + label-persistence sidecar for the framing validator.

After the SQLite migration (T4) and labels.json deletion (T12), this server
talks to the image_labels table directly. GET returns the whole table as
the same shape the legacy validator HTML expects; POST upserts each entry
and triggers a single-image gate recompute per touched image_id.

Endpoints:
  GET  /any/static/path        → serve from project root
  GET  /api/labels             → return {image_id: record} from image_labels
  POST /api/labels             → body is JSON dict; upsert + recompute_for_image
  POST /api/retrain/<label>    → run train + predict for label (TIER1 only)

Run:
  .venv/bin/python -m scripts.detect_subjects.label_server [PORT]
"""
from __future__ import annotations
import json
import os
import sys
import time
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from scripts.detect_subjects.sqlite_db import open_conn, DEFAULT_DB_PATH
from scripts.detect_subjects.image_labels_io import (
    upsert_label, fetch_all_reviewed_labels, delete_labels_not_in,
)
from scripts.detect_subjects.recompute_gate import recompute_for_image

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_PORT = int(os.environ.get("VALIDATOR_PORT", "8765"))


def _read_all_labels() -> dict:
    """Return {image_id: record} for ALL image_labels rows (reviewed or not)."""
    conn = open_conn()
    try:
        rows = conn.execute(
            "SELECT image_id, col1, col2_count, col2_flags, col3, col4, "
            "unsure, reviewed_at, user_edited, variant_tag FROM image_labels"
        ).fetchall()
    finally:
        conn.close()
    out: dict[str, dict] = {}
    for (iid, col1, col2_count, flags_j, col3_j, col4_j,
         unsure, reviewed_at, user_edited, variant_tag) in rows:
        out[iid] = {
            "col1": col1, "col2_count": col2_count,
            "col2_flags": json.loads(flags_j) if flags_j else [],
            "col3": json.loads(col3_j) if col3_j else [],
            "col4": json.loads(col4_j) if col4_j else [],
            "unsure": bool(unsure),
            "reviewed_at": reviewed_at,
            "user_edited": bool(user_edited),
            "variant_tag": variant_tag,
        }
    return out


class _StompGuardError(ValueError):
    """Raised when an empty POST would clear non-empty image_labels."""


def _write_labels_and_recompute(payload: dict) -> dict:
    """Atomic replace of image_labels with `payload`:
      - Delete rows whose image_id is NOT in payload (so UI's 'un-mark a card'
        actually removes the row, matching the legacy file-overwrite semantic)
      - Upsert every payload row
      - Recompute_for_image for every image_id that exists in the new state
        OR was just deleted (so the gate reflects both adds and removes)
    All in one BEGIN/COMMIT — a crash mid-save leaves the previous state intact.

    Returns {upserted, deleted, recomputed}.

    Safety: a payload of {} when image_labels has rows is treated as a likely
    bug, not a deliberate wipe — it raises _StompGuardError. The UI never
    needs to clear every label this way (it deletes one key at a time). The
    operator can drop the table directly if they really want a wipe.
    """
    now_s = int(time.time())
    conn = open_conn()
    try:
        existing_ids = {
            r[0] for r in conn.execute("SELECT image_id FROM image_labels")
        }
        if not payload and existing_ids:
            raise _StompGuardError(
                f"refusing to clear {len(existing_ids)} image_labels rows "
                "via empty POST payload (likely UI bug; use sqlite3 directly "
                "for intentional wipes)"
            )
        keep_ids = set(payload.keys())
        deleted_ids = existing_ids - keep_ids
        conn.execute("BEGIN")
        try:
            deleted = delete_labels_not_in(conn, keep_ids)
            for image_id, record in payload.items():
                upsert_label(conn, image_id, record)
            for image_id in keep_ids:
                recompute_for_image(image_id, conn, now_s=now_s)
            for image_id in deleted_ids:
                recompute_for_image(image_id, conn, now_s=now_s)
            conn.commit()
        except Exception:
            conn.rollback()
            raise
    finally:
        conn.close()
    return {
        "upserted": len(payload),
        "deleted": deleted,
        "recomputed": len(keep_ids) + len(deleted_ids),
    }


class LabelServerHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(PROJECT_ROOT), **kwargs)

    def log_message(self, format, *args):
        if self.path.startswith("/api/") or "404" in (args[1] if len(args) > 1 else ""):
            super().log_message(format, *args)

    def _send_json(self, status: int, body: dict | list) -> None:
        encoded = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(encoded)

    def do_GET(self):
        if self.path == "/api/labels":
            self._send_json(HTTPStatus.OK, _read_all_labels())
            return
        super().do_GET()

    def do_POST(self):
        if self.path.startswith("/api/retrain/"):
            self._handle_retrain()
            return
        if self.path != "/api/labels":
            self.send_error(HTTPStatus.NOT_FOUND, "no such endpoint")
            return
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            self.send_error(HTTPStatus.BAD_REQUEST, "empty body")
            return
        raw = self.rfile.read(length)
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError as e:
            self.send_error(HTTPStatus.BAD_REQUEST, f"bad json: {e}")
            return
        if not isinstance(payload, dict):
            self.send_error(HTTPStatus.BAD_REQUEST, "expected a dict")
            return
        try:
            stats = _write_labels_and_recompute(payload)
        except _StompGuardError as e:
            self._send_json(HTTPStatus.BAD_REQUEST, {"error": str(e)})
            return
        except Exception as e:
            self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": str(e)})
            return
        self._send_json(HTTPStatus.OK, {"ok": True, **stats})

    def _handle_retrain(self):
        label = self.path.split("/api/retrain/", 1)[1]
        from scripts.detect_subjects.ml_labeler import TIER1_LABELS
        if label not in TIER1_LABELS:
            self._send_json(HTTPStatus.BAD_REQUEST, {
                "error": f"unknown label {label!r}; allowed: {TIER1_LABELS}",
            })
            return
        import subprocess
        try:
            proc = subprocess.run(
                [".venv/bin/python", "-m", "scripts.detect_subjects.ml_labeler.train", label],
                cwd=str(PROJECT_ROOT), capture_output=True, text=True, timeout=600,
            )
            if proc.returncode != 0:
                self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {
                    "error": "train failed", "stderr": proc.stderr[-2000:],
                })
                return
            proc2 = subprocess.run(
                [".venv/bin/python", "-m", "scripts.detect_subjects.ml_labeler.predict", label],
                cwd=str(PROJECT_ROOT), capture_output=True, text=True, timeout=300,
            )
            if proc2.returncode != 0:
                self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {
                    "error": "predict failed", "stderr": proc2.stderr[-2000:],
                })
                return
            subprocess.run(
                [".venv/bin/python", "-m", "scripts.detect_subjects.build_html", "sam3__sam3"],
                cwd=str(PROJECT_ROOT), capture_output=True, text=True, timeout=60,
            )
            self._send_json(HTTPStatus.OK, {"ok": True, "label": label,
                                            "stdout": proc.stdout[-500:]})
        except subprocess.TimeoutExpired:
            self._send_json(HTTPStatus.GATEWAY_TIMEOUT, {"error": "training timeout"})


def serve(port: int = DEFAULT_PORT) -> None:
    addr = ("127.0.0.1", port)
    httpd = ThreadingHTTPServer(addr, LabelServerHandler)
    print(f"[label-server] serving on http://localhost:{port}")
    print(f"[label-server] static root: {PROJECT_ROOT}")
    print(f"[label-server] DB:          {DEFAULT_DB_PATH}")
    print(f"[label-server] validator:   http://localhost:{port}/tools/validator/grounding_dino__insectsam.html")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n[label-server] shutting down")
        httpd.shutdown()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_PORT
    serve(port)
```

Key behavior changes:
- No autosnapshot thread, no `{}` stomp guard, no labels.json read/write.
- POST processes each (image_id, record): upsert + recompute_for_image. Empty payload returns 200 with `n=0`.
- GET returns the entire image_labels table (all rows, reviewed or not) so the validator UI sees its in-progress state.

- [ ] **Step 4: Run test to verify it passes**

```bash
.venv/bin/python -m pytest tests/python/test_label_server.py -v
```

Expected: 5 PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/detect_subjects/label_server.py tests/python/test_label_server.py
git commit --only --no-gpg-sign -- scripts/detect_subjects/label_server.py tests/python/test_label_server.py -m "feat(label_server): atomic SQLite POST (upsert + delete-missing + recompute) replacing labels.json"
```

---

## Task 12: Operate — migrate live DB, backfill, delete one-shot script

**Files touched:**
- Run: `npx drizzle-kit migrate`
- Run: `python -m scripts.migrate_labels_to_sqlite`
- Run: `python -m scripts.detect_subjects.recompute_gate --all`
- Delete: `scripts/migrate_labels_to_sqlite.py` + its test

**Background:**
This is the ops task that lands the changes on the actual DB and verifies user-visible correctness. Each step is destructive-ish; verify between each.

- [ ] **Step 1: Backup the live DB**

```bash
cp data/db/line-of-bugs.db data/db/line-of-bugs.db.bak-pre-0013-$(date +%s)
ls -lh data/db/line-of-bugs.db*
```

Expected: backup file exists with same size as the live DB.

- [ ] **Step 2: Verify migration against a copy (one more time)**

```bash
cp data/db/line-of-bugs.db /tmp/migrate-verify.db
DATABASE_URL=/tmp/migrate-verify.db npx drizzle-kit migrate
sqlite3 /tmp/migrate-verify.db "
  SELECT name FROM sqlite_master
  WHERE type='table' AND name IN
    ('image_labels','detections','predictions','gate_decisions','label_thresholds')
  ORDER BY name;
"
```

Expected: 5 table names.

- [ ] **Step 3: Run migration on live DB**

```bash
npx drizzle-kit migrate
sqlite3 data/db/line-of-bugs.db "
  SELECT name FROM sqlite_master
  WHERE type='table' AND name IN
    ('image_labels','detections','predictions','gate_decisions','label_thresholds')
  ORDER BY name;
"
sqlite3 data/db/line-of-bugs.db \
  "SELECT label, tier, threshold, threshold_v FROM label_thresholds;"
```

Expected: 5 table names + `mask_blur_unusable|1|0.5|1`.

- [ ] **Step 4: Run the one-shot label migrator**

```bash
.venv/bin/python -m scripts.migrate_labels_to_sqlite
sqlite3 data/db/line-of-bugs.db "SELECT COUNT(*) FROM image_labels;"
ls data/cache/labels.json.bak-pre-sqlite-migration-*
```

Expected:
- Output reports `~320 migrated, K orphans skipped` (orphan count > 0 is OK).
- COUNT matches the migrated number.
- Backup file exists in `data/cache/`.

- [ ] **Step 5: Sync detections from existing parquet**

```bash
.venv/bin/python -m scripts.detect_subjects.detections_sync
sqlite3 data/db/line-of-bugs.db "SELECT variant, COUNT(*) FROM detections GROUP BY variant;"
```

Expected: `sam3__sam3|N` (N being the count of sam3 rows in the parquet).

- [ ] **Step 6: Sync predictions from existing parquet**

```bash
.venv/bin/python -m scripts.detect_subjects.ml_labeler.predict mask_blur_unusable
sqlite3 data/db/line-of-bugs.db \
  "SELECT label, COUNT(*), MIN(p), MAX(p) FROM predictions GROUP BY label;"
```

Expected: `mask_blur_unusable|N|<min_p>|<max_p>` with N matching sam3 row count.

- [ ] **Step 7: Run full gate recompute**

```bash
time .venv/bin/python -m scripts.detect_subjects.recompute_gate --all
sqlite3 data/db/line-of-bugs.db "
  SELECT reason_source, decision, COUNT(*)
  FROM gate_decisions GROUP BY reason_source, decision
  ORDER BY reason_source, decision;
"
```

Expected runtime: 30-90s for the ~39,659 images. The design spec's "~5s" estimate underweighted the per-row 4-SELECT + 1-UPSERT pattern; realistic single-thread SQLite throughput puts a full rebuild in the half-minute to minute range. If it runs in under 5s, something is wrong (maybe images table is empty? check `SELECT COUNT(*) FROM images;` first).

Expected sample output (numbers will vary):
```
default|keep|38500
hand|keep|150
hand|reject|108
ml|reject|400
report|reject|30
rule|reject|470
```

Quick sanity check: sum of all rows should equal `SELECT COUNT(*) FROM images;` (since `recompute_all` writes one decision per image).

- [ ] **Step 8: Manual spot-check on three image_ids**

Pick three image_ids:
- One you hand-labeled as reject
- One the rule labels as `bbox-content_no-bug`
- One you've never touched

For each:

```bash
sqlite3 data/db/line-of-bugs.db "
  SELECT decision, reason, reason_source FROM gate_decisions
  WHERE image_id = '<image-id>';
"
```

Verify each matches the expected outcome from the trust hierarchy.

- [ ] **Step 9: Delete the one-shot migration script + its test**

```bash
git rm scripts/migrate_labels_to_sqlite.py tests/python/test_migrate_labels_to_sqlite.py
```

Per CLAUDE.md "delete one-shot scripts after they run". The labels.json backup remains in `data/cache/` as a historical artifact.

- [ ] **Step 10: Delete labels.json from the working tree and from git**

The file `data/cache/labels.json` is TRACKED (see initial `git status` showing `M data/cache/labels.json`). Removing it on disk without `git rm` would leave git in a "deleted but not staged" state. Two stages:

```bash
# Stage 1: copy to a clearly-retired path so the data isn't lost.
ls -lh data/cache/labels.json data/cache/labels.json.bak-pre-sqlite-migration-*
cp data/cache/labels.json data/cache/labels.json.RETIRED-$(date +%s)
ls data/cache/labels.json.RETIRED-*

# Stage 2: actually remove from git + working tree.
git rm data/cache/labels.json
git status --short data/cache/
```

Expected:
- The RETIRED copy exists in `data/cache/` (untracked artifact).
- `git status` shows `D  data/cache/labels.json` (staged delete) and `??  data/cache/labels.json.RETIRED-*` (untracked, fine to ignore).

Also restart the label server so it picks up the SQLite-only code path:

```bash
pkill -f "scripts.detect_subjects.label_server" || true
nohup .venv/bin/python -m scripts.detect_subjects.label_server > /tmp/label_server.log 2>&1 &
sleep 1
curl -s http://localhost:8765/api/labels | python3 -c "import sys, json; d = json.load(sys.stdin); print(f'{len(d)} labels via SQLite')"
```

Expected: positive count matching the migrated row count.

- [ ] **Step 11: Final commit (one-shot script deletion + labels.json removal)**

```bash
git commit --only --no-gpg-sign -- \
  scripts/migrate_labels_to_sqlite.py \
  tests/python/test_migrate_labels_to_sqlite.py \
  data/cache/labels.json \
  -m "chore: retire labels.json + one-shot migrator (data migrated to image_labels)"
```

- [ ] **Step 12: Verify the full pytest suite passes**

```bash
.venv/bin/python -m pytest tests/python/ -v --ignore=tests/python/_phase2_baseline --ignore=tests/python/_phase2a_baseline
```

Expected: all PASS. No imports of `scripts.migrate_labels_to_sqlite` should remain.

---

## Spec coverage self-review

Each spec requirement → task:

| Spec section | Implemented in |
|---|---|
| 5 new tables | Task 1 |
| `image_labels` schema + JSON columns | Task 1 schema + Task 3 IO |
| `detections` table + gate_rule_only | Task 1 + Task 5 |
| `predictions` table + model_version | Task 1 + Task 6 |
| `gate_decisions` table | Task 1 + Task 7 |
| `label_thresholds` table + seed | Task 1 + Task 8 (suggested_threshold writes) |
| Trust hierarchy | Task 7 |
| Refresh model: hand save → 1 row recompute | Task 11 |
| Refresh model: retrain → all rows for label | Task 9 |
| Refresh model: --all rebuild | Task 7 CLI + Task 12 step 7 |
| Default keep for un-detected | Task 7 (Tier 5) + Task 12 step 7 |
| `sync_detections_from_parquet` contract | Task 5 |
| `sync_predictions_from_parquet` contract | Task 6 |
| labels.json → image_labels migration | Task 4 + Task 12 step 4 |
| train.py reads SQLite | Task 8 |
| classify.py syncs detections | Task 10 |
| predict.py syncs predictions + recomputes | Task 9 |
| label_server.py talks to SQLite | Task 11 |
| Versioning: model_version, threshold_v | Tasks 6, 7, 8 |
| Failure mode: stale row → manual recover | Task 10 (try/except + warn) |
| Drizzle FK PRAGMA enforcement | Task 2 (`open_conn` sets foreign_keys ON) |
| Backfill timing — first --all | Task 12 step 7 |
| One-shot script deletion | Task 12 step 9 |

No spec section is unmapped.

---

## Plan complete and saved to `docs/superpowers/plans/2026-05-17-content-filtering-data-layer.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, two-stage review (spec compliance, then code quality) between tasks, fast iteration in this session.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints for review.

Which approach?
