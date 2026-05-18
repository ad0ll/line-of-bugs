# Content filtering + SQLite data layer — design spec

**Date:** 2026-05-17
**Status:** brainstormed, pending implementation plan
**Downstream specs (separate brainstorms):**
- Frontend filter integration (plan 2)
- Monorepo restructure + Bun workspaces (plan 3)
- Validator UI port to React under `apps/admin/` (plan 4)

## Motivation

The ML pipeline produces signal about which images are drawable: rule_labeler output, ML predictions, hand labels, plus user reports. None of this currently affects what users see — the production gallery and session pool query `images` directly with only `hidden = 0` and an unresolved-report filter.

This spec defines the data layer that turns those signals into a single per-image keep/reject decision the production app reads. It also relocates label storage out of `data/cache/labels.json` (fragile, two near-misses today) into SQLite, and defines the sync contract between the parquet-based ML pipeline and the SQLite source of truth.

## Scope

**In scope:**
- New SQLite tables: `image_labels`, `detections`, `predictions`, `gate_decisions`, `label_thresholds`
- One-shot migration: `data/cache/labels.json` → `image_labels`
- Sync step from `framing_detections.parquet` → `detections` + `predictions`
- `recompute_gate.py`: computes `gate_decisions` from the trust hierarchy
- Wiring `train.py` to read labels from SQLite (replaces labels.json read)
- Wiring `classify.py` to upsert into `detections` after parquet flush
- Wiring `predict.py` to upsert into `predictions` after parquet write
- Backfill `gate_decisions` for all 39,659 images
- Per CLAUDE.md: schema changes via Drizzle migrations under `drizzle/`

**Explicitly NOT in scope (separate plans):**
- Frontend gallery / session pool query changes (plan 2)
- Monorepo restructure (plan 3)
- React admin app + validator port (plan 4)
- DINOv3 image arm, Cleanlab audit, multi-label tier-1 expansion (Phase 3 Plans 2-4 from the ML labeler thin-slice spec)
- Generating cropped image variants on disk (frontend decides per-route via crop coords)

## End-to-end data flow

```
1. INGEST (existing)
   fetchers → images table

2. DETECT (existing, occasional reruns)
   classify.py: SAM 3 + InsectSAM + features + rule_labeler
     reads:  images table, data/images/
     writes: parquet (full row), SQLite detections (sync after batch flush)

3. LABEL (continuous, by user)
   Admin app → label backend → SQLite image_labels
   (post-migration: labels.json removed; backend writes SQLite directly)

4. TRAIN
   train.py:
     reads:  SQLite image_labels (replacing labels.json read) + parquet features
     writes: models/<label>/clf.joblib + metrics.json
             SQLite label_thresholds (auto-suggested threshold at recall ≥ 0.95
             written to suggested_threshold; threshold column only changed by humans)

5. PREDICT
   predict.py:
     reads:  parquet (features) + joblib bundle
     writes: parquet (predicted_<label>_p, predicted_<label>_unreliable)
             SQLite predictions (image_id, label, p, unreliable, model_version)

6. GATE DECIDE
   recompute_gate.py: trust hierarchy (hand > report > rule > ml > default)
     reads:  image_labels, reports, detections, predictions, label_thresholds
     writes: SQLite gate_decisions (one row per image)
   Triggers: label save (per-row), retrain pipeline (all rows for that label),
             report state change (per-row), manual "rebuild all" (entire table)

7. SERVE
   buildFilterClauses (existing query helper):
     adds: AND NOT EXISTS (SELECT 1 FROM gate_decisions g
                            WHERE g.image_id = i.image_id AND g.decision = 'reject')
   Used by: gallery query, session pool query, future admin views.
```

## Trust hierarchy

When multiple signals exist for an image, the gate decision uses strict priority order. First match wins, decision is computed once, written to `gate_decisions`.

| Priority | Source | Trigger condition | Decision logic |
|---|---|---|---|
| 1 | Hand label | Row exists in `image_labels` with `reviewed_at IS NOT NULL AND user_edited = 1` | `decide_drawability()` on the four columns. Reason: `hand:<reject_reason>` |
| 2 | User report | At least one unresolved report (`reports.resolved_at IS NULL`) | REJECT. Reason: `report:<category>` |
| 3 | Rule | `detections.suggested_labels` contains any of the "reject" labels: `bbox-content_no-bug`, `bbox-content_bbox-multibug_unusable`, `bbox-content_subject-too-small` | REJECT. Reason: `rule:<label>` |
| 4 | ML | Any tier-1 label in `predictions` where `unreliable=0` AND `p >= label_thresholds.threshold` | REJECT. Reason: `ml:<label>:<p>` |
| 5 | Default | No row matched above | KEEP. Reason: `defaults_pass` |

Reasons containing the actual triggering label make every decision human-readable for debugging.

Tier-2 labels (positives < 30 at train time, flagged `unreliable=1`) do not gate. They are stored in `predictions` for analytics and so the threshold becomes meaningful once they hit tier-1.

## Refresh model

Gate decisions are precomputed in `gate_decisions`. Triggers:

- **Hand-label save:** label backend computes the new decision for that one `image_id` after writing `image_labels`. Latency: single-row recompute, ~1ms.
- **Retrain pipeline:** `train.py → predict.py → recompute_gate.py` chain. After predictions for a label are updated, recompute all rows where that label's prediction changed (in practice: all sam3-variant rows). ~30s for the full sweep.
- **Report state change:** report-resolution backend computes the new decision for that `image_id`.
- **Rule_labeler config change:** Out-of-band — requires `classify.py` rerun (rare). After rerun, full `recompute_gate.py` rebuilds everything.
- **Manual rebuild:** CLI flag `recompute_gate.py --all` rebuilds the entire `gate_decisions` table from scratch.

Side effect: every change to a signal source is followed by a gate recompute. No daemon needed; recompute is fast enough to inline into the writing path.

## Default behavior for un-detected images

~38,000 images have no `detections` row (never processed by `classify.py`). `recompute_gate.py` still creates a `gate_decisions` row for every image in `images`. With no signal: `decision = 'keep'`, `reason = 'defaults_pass'`, `reason_source = 'default'`.

Rationale: "innocent until proven flagged." The existing `reports` mechanism still hides obviously-broken images via the unresolved-report join — that path is untouched.

## SQLite schema additions

All migrations land via Drizzle (per CLAUDE.md). Migration filenames go in `drizzle/` numbered sequentially after existing ones.

### `image_labels`

Migrated from `data/cache/labels.json`. After migration, labels.json is deleted; the new admin app backend writes here directly.

```sql
CREATE TABLE image_labels (
  image_id     TEXT PRIMARY KEY REFERENCES images(image_id) ON DELETE CASCADE,
  col1         TEXT,                                          -- e.g., bbox_correct-subject_not-clipped
  col2_count   TEXT,                                          -- e.g., bbox-content_single
  col2_flags   TEXT,                                          -- JSON array of strings
  col3         TEXT,                                          -- JSON array of mask labels
  col4         TEXT,                                          -- JSON array of ml labels
  unsure       INTEGER NOT NULL DEFAULT 0 CHECK (unsure IN (0, 1)),
  reviewed_at  INTEGER,                                       -- unix epoch ms (NULL = unreviewed)
  user_edited  INTEGER NOT NULL DEFAULT 0 CHECK (user_edited IN (0, 1)),
  variant_tag  TEXT                                            -- detector variant at label time
);
CREATE INDEX idx_image_labels_reviewed ON image_labels(reviewed_at) WHERE reviewed_at IS NOT NULL;
```

JSON columns (`col2_flags`, `col3`, `col4`) use TEXT with JSON content — same pattern as `species_metadata.sketchfab_hits_json`. We don't query inside these arrays at the SQL layer; Python code parses them.

### `detections`

Per-image sync target from `framing_detections.parquet`. Includes rule outputs, mask scalars, and recommended crop coords. Latest-variant-wins on upsert.

```sql
CREATE TABLE detections (
  image_id          TEXT PRIMARY KEY REFERENCES images(image_id) ON DELETE CASCADE,
  variant           TEXT NOT NULL,                            -- e.g., 'sam3__sam3'
  suggested_labels  TEXT NOT NULL,                            -- JSON array of strings (rule output)
  gate_rule_only    TEXT NOT NULL CHECK (gate_rule_only IN ('keep','reject')),
  has_bbox          INTEGER NOT NULL CHECK (has_bbox IN (0, 1)),
  bbox_x            REAL, bbox_y REAL, bbox_w REAL, bbox_h REAL,
  mask_area_ratio   REAL,
  lab_delta_e       REAL,
  boundary_sharpness REAL,
  mask_iou_score    REAL,
  crop_x REAL, crop_y REAL, crop_w REAL, crop_h REAL,
  post_crop_subject_area REAL,
  processed_at      INTEGER NOT NULL,
  schema_version    INTEGER NOT NULL
);
CREATE INDEX idx_detections_variant ON detections(variant);
CREATE INDEX idx_detections_has_bbox ON detections(has_bbox);
```

`gate_rule_only` preserves the legacy phase-2a per-row gate decision for backward compat and as an analytics baseline. `gate_decisions.decision` (the full hierarchical decision) supersedes it for serving.

### `predictions`

Per-(image, label) ML probability. Sparse — only images with a model that produced a prediction appear.

```sql
CREATE TABLE predictions (
  image_id      TEXT NOT NULL REFERENCES images(image_id) ON DELETE CASCADE,
  label         TEXT NOT NULL,                                 -- e.g., mask_blur_unusable
  p             REAL NOT NULL,                                 -- 0..1
  unreliable    INTEGER NOT NULL DEFAULT 0 CHECK (unreliable IN (0, 1)),
  model_version TEXT NOT NULL,                                 -- e.g., 'mask_blur_unusable@1779080995'
  predicted_at  INTEGER NOT NULL,                              -- unix epoch s
  PRIMARY KEY (image_id, label)
);
CREATE INDEX idx_predictions_label_p ON predictions(label, p);
```

`model_version` format: `<label>@<unix_epoch_s>` — encodes which retrain produced the row. Lets us roll back if a bad model lands.

### `gate_decisions`

Per-image final keep/reject. Dense — every image has a row after the first full `recompute_gate.py --all` backfill.

```sql
CREATE TABLE gate_decisions (
  image_id      TEXT PRIMARY KEY REFERENCES images(image_id) ON DELETE CASCADE,
  decision      TEXT NOT NULL CHECK (decision IN ('keep', 'reject')),
  reason        TEXT NOT NULL,                                 -- e.g., 'ml:mask_blur_unusable:0.87'
  reason_source TEXT NOT NULL CHECK (reason_source IN ('hand','report','rule','ml','default')),
  computed_at   INTEGER NOT NULL,                              -- unix epoch s
  model_version TEXT,                                          -- when reason_source='ml'
  threshold_v   INTEGER                                        -- monotonic version from label_thresholds
);
CREATE INDEX idx_gate_decisions_decision ON gate_decisions(decision);
CREATE INDEX idx_gate_decisions_reason_source ON gate_decisions(reason_source);
```

The `decision` index is critical: production query is `WHERE decision='reject'`, which the index turns into a fast lookup of the ~hundreds-to-thousands of rejects rather than a full scan of 39k rows.

### `label_thresholds`

Per-label config. Updated by `train.py` (the `suggested_threshold` column only); `threshold` is human-edited.

```sql
CREATE TABLE label_thresholds (
  label                TEXT PRIMARY KEY,
  tier                 INTEGER NOT NULL CHECK (tier IN (1, 2)),
  threshold            REAL NOT NULL,                            -- gate fires when p >= threshold
  suggested_threshold  REAL,                                     -- auto-written: recall ≥ 0.95 from CV
  threshold_v          INTEGER NOT NULL,                         -- monotonic, bumped when threshold changes
  notes                TEXT,                                     -- human free-form
  updated_at           INTEGER NOT NULL
);
```

Initial population: one row per label in the vocab; `threshold = suggested_threshold` on first insert; `threshold_v = 1`.

## Sync contracts

### parquet → SQLite (detections)

After `classify.py` flushes a batch of parquet rows, a sync step upserts the corresponding `detections` rows:

```python
def sync_detections_from_parquet(parquet_path, sqlite_path, variant_filter=None):
    """Upsert detections table from parquet rows. Latest-variant-wins per image_id.
    Idempotent — safe to re-run."""
```

Triggered: at the end of `classify.py`'s main loop (after the final `_flush_records`). Idempotent so reruns don't duplicate.

### parquet → SQLite (predictions)

After `predict.py` writes the predicted_<label>_p columns to parquet, it upserts `predictions` rows:

```python
def sync_predictions_from_parquet(parquet_path, sqlite_path, labels):
    """For each label in labels, upsert one row per image with current predicted_p."""
```

Triggered: at the end of `predict_labels_batched`. The model version string is captured from the joblib bundle's `trained_at` field.

### labels.json → image_labels (one-shot migration)

Script `scripts/migrate_labels_to_sqlite.py`:

1. Read `data/cache/labels.json`
2. For each record, upsert into `image_labels`
3. Validate: every image_id maps to an existing `images` row (skip orphans with a warning)
4. Write a one-shot backup at `data/cache/labels.json.bak-pre-sqlite-migration-<ts>`
5. Print a summary count
6. The migrate script is deleted post-run (per CLAUDE.md "delete one-shot scripts after they run")

After migration:
- `label_server.py` is rewritten to POST/GET via SQLite (still serves the legacy HTML validator during the transition)
- Autosnapshot directory under `data/cache/label_snapshots/` is preserved as a historical artifact; new snapshots stop being generated

### train.py: labels.json → SQLite read

`_load_xy_for_label()` is rewritten to query `image_labels` from SQLite instead of parsing labels.json. The function signature stays the same so the rest of train.py is unchanged.

## Recompute_gate.py

New script: `scripts/detect_subjects/recompute_gate.py`.

```python
def recompute_for_image(image_id: str, conn: sqlite3.Connection) -> dict:
    """Compute gate_decisions row for one image. Returns the row dict."""

def recompute_for_label(label: str, conn: sqlite3.Connection) -> int:
    """Recompute all rows where this label's prediction is the trigger.
    In practice: all sam3-variant rows. Returns count touched."""

def recompute_all(conn: sqlite3.Connection) -> dict:
    """Full rebuild — touches every image in `images`. Returns {kept: N, rejected: M}."""
```

Each function uses the trust hierarchy: hand → report → rule → ml → default. Single point of truth for the gate logic.

Per the refresh model:
- Hand-label save calls `recompute_for_image(image_id)`
- Retrain pipeline calls `recompute_for_label(label)` after predict completes
- Report state changes call `recompute_for_image(image_id)` (from the existing reports backend)
- Manual `recompute_gate.py --all` invokes `recompute_all`

## Versioning

| Field | Format | Bumped when |
|---|---|---|
| `predictions.model_version` | `<label>@<unix_epoch_s>` | Every retrain |
| `gate_decisions.model_version` | Same as above for the ML signal that triggered, else NULL | At decision time |
| `gate_decisions.threshold_v` | Monotonic int matching `label_thresholds.threshold_v` | At decision time |
| `label_thresholds.threshold_v` | Monotonic int starting at 1 | When a human edits `threshold` |
| `detections.schema_version` | From `config.py SCHEMA_VERSION` | Bumped at config change |

A gate decision's full provenance: `(reason_source, reason, model_version, threshold_v, computed_at)`. Future debugging answers "why was this image hidden last Tuesday?"

## Failure modes

| Scenario | Behavior |
|---|---|
| Image has no `detections` row (never processed) | `gate_decisions.decision = 'keep'`, `reason = 'defaults_pass'`. Image is visible. |
| Image has no `predictions` rows (model never ran) | Hierarchy falls through ML; if hand+rule+report all clean, decision is keep. |
| `predictions` row has `unreliable = 1` | Ignored by gate logic (tier-2 labels never gate). Stored for analytics. |
| Parquet row exists but SQLite sync didn't run | Out-of-date `detections` row. Manual fix: rerun `sync_detections_from_parquet`. Detection of staleness: compare row counts in CI. |
| Hand label conflicts with ML prediction | Hand wins per hierarchy. ML stays in `predictions` for the active-learning loop. |
| Multiple unresolved reports for one image | Reason gets the first category alphabetically. Detail in reports table itself. |
| Migration fails partway | Atomic Drizzle transaction; labels.json backup taken before migration; can re-run. |
| Re-run with newer detector variant | `detections` row is upserted to new variant; old `predictions` rows stay with their original `model_version` (gate ignores stale model_versions where label_thresholds.threshold_v advanced — TBD how to detect; for now `recompute_gate.py --all` after a variant change). |

## Open questions / risks

1. **Stale predictions after variant change.** If we rerun `classify.py` with a new detector variant, the features change, but `predictions` rows still hold the OLD model_version. The gate keeps using them until predict.py re-runs. Mitigation: a `predict.py --invalidate-stale` mode that nulls predictions whose `model_version`'s trained-on-variant differs from the current `detections.variant`. Out of scope for plan 1; flag for plan 2 or a future cleanup task.

2. **No history table.** `gate_decisions` is overwritten on recompute — no audit log of decision changes over time. For "this image used to be hidden but now isn't, why?" we have only `computed_at`. Adding an audit table is cheap (`gate_decisions_history` with the same shape plus `superseded_at`) but adds write volume. Decision: skip for plan 1, revisit if the lack of history becomes a real debugging pain.

3. **Recompute_gate.py performance at scale.** Full rebuild over 39k images: each image does a small JSON parse + a few dict lookups + one INSERT. Estimate ~5s on this machine. Acceptable for occasional rebuilds; the hot path is single-row recompute which is O(1).

4. **Drizzle migration ordering with the existing schema.** The new tables reference `images.image_id` as FK. The existing `images` table is well-established; FK constraints on SQLite are enforced only when `PRAGMA foreign_keys = ON` — confirm Drizzle does this.

5. **Backfill timing.** First `recompute_gate.py --all` runs against an empty `predictions` table (Phase 3 has only blur_unusable predictions today, and only for sam3 rows). 99% of images will get `decision=keep, reason=defaults_pass` initially. As predictions accumulate, decisions firm up.

## Out of scope (referenced by downstream plans)

- **Frontend filter integration** (plan 2): `buildFilterClauses` adds the gate_decisions NOT EXISTS clause. Session pool helper too. No design needed here — just a query change.
- **Monorepo restructure** (plan 3): Bun workspaces, `apps/web/` + `apps/admin/` layout, shared `packages/`. Independent design.
- **Validator React port** (plan 4): The new admin app's first feature. Replaces `tools/validator/templates/index.html.j2` + `label_server.py`. Writes to `image_labels` directly. Out of this spec entirely.

## Plan order (cross-references)

1. **Backend data layer + ML pipeline wiring** (THIS spec) — schemas, sync, gate recompute, labels.json migration, train.py SQLite read
2. **Frontend filter integration** — gallery + session pool reads `gate_decisions`. Smallest plan, biggest user-visible win.
3. **Monorepo restructure** — Bun workspaces, `apps/web/`, `apps/admin/` skeleton.
4. **Validator port to React in admin app** — feature work.

Plans 1+2 ship user-facing value (bad photos hidden) without any admin work. Plans 3+4 are admin-side quality of life with no production-visible change.

## References

- CLAUDE.md ("SQLite is source of truth", "schema changes via Drizzle migrations", "delete one-shot scripts")
- `scripts/detect_subjects/gate.py` — existing `decide_drawability()` referenced in trust hierarchy tier 1
- `scripts/detect_subjects/rule_labeler.py` — `suggest_labels()` produces what becomes `detections.suggested_labels`
- `scripts/detect_subjects/classify.py` — adds the post-flush sync step
- `scripts/detect_subjects/ml_labeler/train.py` and `predict.py` — read from SQLite, write predictions to SQLite
- `lib/queries/filter-clauses.ts:78` — the existing visibility-filter helper that plan 2 extends
- `lib/queries/session.ts` — session pool builder, gets the same gate filter via the shared helper
- `docs/superpowers/specs/2026-05-17-ml-labeler-design.md` — Phase 3 ML labeler design (compatible — predictions land in `predictions` table per this spec)
- `docs/superpowers/plans/2026-05-17-ml-labeler-thin-slice.md` — Phase 3 implementation in progress
