# Round 5: drop the CSV intermediate — design

**Date:** 2026-05-15
**Status:** design — not yet implemented
**Goal:** Fetchers write image metadata directly to `data/db/line-of-bugs.db`, eliminating `data/manifest/*.csv` as a layer in the pipeline.

---

## Current pipeline (legacy)

```
┌────────────────┐    ┌─────────────────────┐    ┌────────────────────┐
│ Python fetchers│ →  │ data/manifest/*.csv │ →  │ db/seed.ts         │ → SQLite
│ (4 scripts)    │    │ (per-source append) │    │ (CSV → INSERT)     │
└────────────────┘    └─────────────────────┘    └────────────────────┘
```

Each fetcher uses `scripts/common.py:ManifestWriter` to:
- read the existing CSV at startup (to dedup by `image_id`)
- append new rows as it works
- never mutate older rows (backfill is a separate pass)

Then `db/seed.ts` reads every CSV and UPSERTs into the `images` table.

## Why drop the CSV layer

- **JSON-in-CSV is painful.** `raw_metadata` blobs are 5–200KB JSON per row. Required workarounds:
  - `csv.field_size_limit(sys.maxsize)` in every reader.
  - Worry about embedded `\n` / `,` / `"` quoting (Python csv handles it, but every consumer must opt in).
- **Two places to keep in sync.** Adding a column means editing both `scripts/common.py:MANIFEST_FIELDS` and `db/schema.ts`, and writing a one-shot CSV-rewrite script for existing rows. Round 4 needed `/tmp/migrate_manifests_round4.py` for the `subject_type → subject_state` rename. Round 1 needed a similar migration.
- **Disk waste.** After R4 backfill, the iNat CSV alone is ~2-3 GB (mostly `raw_metadata`). The SQLite DB stores the same data more compactly with proper page-aligned blobs.
- **Drift risk.** Manifest can have rows the DB doesn't (if seed hasn't been run), or vice versa. Today the only reconciler is `db:seed`, which must be invoked manually.
- **Inspection no longer needs CSV.** `sqlite3 data/db/line-of-bugs.db "SELECT … LIMIT 10"` is one keystroke. The original "easy to grep" argument doesn't hold for the JSON-bloat era.

## Proposed pipeline

```
┌────────────────┐    ┌────────────────────┐
│ Python fetchers│ →  │ data/db/line-of-bugs.db │ ← Next.js app reads
│ (4 scripts)    │    │ (UPSERT direct)    │
└────────────────┘    └────────────────────┘
```

One source of truth. Concurrent reads from Next.js are fine — SQLite already uses WAL mode (`db/index.ts:39`).

## Implementation

### 1. `scripts/db.py` (new) — Python-side schema mirror + writer

```python
"""Python image of the image_id table — kept in lockstep with db/schema.ts.

Drizzle is the SOT for column types and constraints; this module just
provides typed UPSERT for the Python fetchers. If you add a column in
schema.ts, mirror it here in COLUMNS + INSERT_SQL and run the migration
(drizzle migrate) before any fetcher runs.
"""
import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent.parent / "data" / "db" / "line-of-bugs.db"

COLUMNS = [
    "image_id", "collection_id", "source", "source_id",
    "source_page_url", "image_url",
    "filename", "thumbnail_filename", "medium_filename",
    "file_size_bytes", "file_sha256", "width", "height",
    "license", "license_url",
    "photographer_attribution", "photographer", "institution",
    "taxon_order", "taxon_species", "common_name",
    "subject_state", "view_label",
    "life_stage", "sex", "host_organism", "specimen_condition",
    "description", "captured_date",
    "raw_metadata",
]

# Mutable columns on conflict — every column except image_id (PK), added_at
# (auto), and hidden (managed by moderation flow, NOT by fetchers).
UPDATE_COLUMNS = [c for c in COLUMNS if c != "image_id"]

INSERT_SQL = f"""
INSERT INTO images ({", ".join(COLUMNS)})
VALUES ({", ".join("?" for _ in COLUMNS)})
ON CONFLICT(image_id) DO UPDATE SET
{", ".join(f"{c}=excluded.{c}" for c in UPDATE_COLUMNS)}
"""


class DbWriter:
    """Drop-in replacement for ManifestWriter. Same interface
    (.has, .write, .count, .close), backed by SQLite."""

    def __init__(self, source: str):
        self.source = source
        self.conn = sqlite3.connect(DB_PATH, isolation_level=None)  # autocommit
        self.conn.execute("PRAGMA journal_mode = WAL")
        self.conn.execute("PRAGMA synchronous = NORMAL")
        self.conn.execute("PRAGMA busy_timeout = 5000")
        self.conn.execute("PRAGMA foreign_keys = ON")
        # Preload seen image_ids for this source so .has() is O(1)
        self.seen: set[str] = set(
            r[0] for r in self.conn.execute(
                "SELECT image_id FROM images WHERE source = ?", (source,)
            )
        )

    def has(self, image_id: str) -> bool:
        return image_id in self.seen

    def write(self, row: dict) -> bool:
        if row["image_id"] in self.seen:
            return False
        # Build positional tuple in COLUMNS order; missing keys → None.
        # raw_metadata is already a JSON string by the time it arrives.
        values = tuple(row.get(c) or None for c in COLUMNS)
        self.conn.execute(INSERT_SQL, values)
        self.seen.add(row["image_id"])
        return True

    def count(self) -> int:
        return len(self.seen)

    def close(self):
        self.conn.close()
```

### 2. Wire all 4 fetchers

Pure mechanical change in `scripts/fetch_*.py`:

```diff
-from common import ManifestWriter, …
+from common import …
+from db import DbWriter

 def main():
-    mw = ManifestWriter("inaturalist")
+    mw = DbWriter("inaturalist")
```

Everything else (the `.has()` / `.write()` / `.count()` calls) is unchanged.

### 3. Backfill script (`scripts/backfill_metadata.py`)

Same pattern — read DB rows for a source, re-query the API, UPDATE in place. The current implementation reads CSV / writes CSV; convert to SELECT / UPDATE.

```python
for r in db.execute("SELECT image_id, collection_id, source_id … FROM images WHERE source = 'inaturalist' AND raw_metadata IS NULL"):
    …
    db.execute("UPDATE images SET life_stage=?, sex=?, raw_metadata=? WHERE image_id=?",
               (life_stage, sex, raw_md, r["image_id"]))
```

### 4. Delete

- `data/manifest/` (after a final reseed)
- `db/seed.ts` — keep as a no-op shim that exits 0 (in case any docs/scripts still mention `npm run db:seed`), or delete and update the docs.
- `scripts/common.py:MANIFEST_FIELDS` + `ManifestWriter` + `manifest_count_by` + `read_existing_rows`
- `csv.field_size_limit(sys.maxsize)` workaround
- Any one-shot CSV migration scripts in `/tmp/` or `scripts/migrate_*`

### 5. Migration concerns

- **WAL concurrency.** Fetcher writes while Next.js reads. SQLite handles this fine but we should smoke-test: run a fetcher + hit /gallery + verify no errors. Single writer at a time means parallel fetchers (rare in practice) would need a lock — keep them sequential.
- **`fileSha256` audit index** stays useful even without a CSV — a content-level duplicate across sources is still findable via `SELECT ... GROUP BY file_sha256 HAVING COUNT(*) > 1`.
- **No CSV → no easy `git bisect` of the dataset.** We never did this anyway; the dataset is gitignored.

## Testing plan

1. Smoke: with a fresh DB, run `fetch_smithsonian.py` (smallest, ~351 rows) end-to-end. Verify rows in DB match what the previous CSV→seed pipeline produced.
2. Concurrency: run `fetch_inaturalist.py` while `npm run dev` is serving the gallery; tail dev log for SQLITE_BUSY errors (should be zero with WAL + busy_timeout).
3. Backfill: run `backfill_metadata.py inaturalist` and verify `life_stage` / `sex` / `raw_metadata` populate for existing rows.
4. Idempotency: re-run any fetcher and verify it writes 0 new rows (seen-set dedup works).

## Rollback

If something breaks mid-migration:
1. Keep the CSVs around (don't `rm -rf data/manifest/` until step 4 of the migration plan is verified).
2. The DbWriter is additive — the old ManifestWriter still works on its own files. Can switch back per-fetcher.
3. After confidence: archive `data/manifest/` to off-machine backup, delete locally.

## Estimated effort

4-6 hours, mostly mechanical. The biggest care item is making sure Python's `INSERT … ON CONFLICT` matches the Drizzle `onConflictDoUpdate` semantics exactly (column lists, partial updates, NULL handling).
