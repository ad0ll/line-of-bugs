# R5: drop CSV intermediate — implementation plan

> **Goal:** Replace `data/manifest/*.csv` + `db/seed.ts` with a Python `DbWriter` that UPSERTs directly into `data/db/line-of-bugs.db`. Eliminates the field-size workaround, the two-place column maintenance burden, and the one-shot CSV migration scripts every schema rev.

**Architecture:** Mirror `ManifestWriter`'s public API (`has()` / `write()` / `count()` / `close()`) in a new `DbWriter` backed by Python's stdlib `sqlite3`. Per-source filter on init pre-loads seen `image_id`s. WAL + busy_timeout already enabled by `db/index.ts`, so concurrent Next.js reads stay safe. Tests use a tmp SQLite file (no fixture pollution).

**Tech:** Python stdlib `sqlite3`, pytest (already configured at `tests/python/`).

**Design spec:** `docs/superpowers/specs/2026-05-15-r5-sqlite-direct-design.md` — read this for rationale + UPSERT semantics + rollback plan.

---

## Files touched

- **Create:** `scripts/db.py` (DbWriter class + COLUMNS list)
- **Create:** `tests/python/test_db_writer.py` (unit tests for DbWriter)
- **Modify:** `scripts/common.py` (remove ManifestWriter, MANIFEST_FIELDS, manifest_count_by, read_existing_rows, csv.field_size_limit)
- **Modify:** `scripts/fetch_smithsonian.py` (1 import + 1 call)
- **Modify:** `scripts/fetch_inaturalist.py` (1 import + 1 call + 1 manifest_count_by call removed)
- **Modify:** `scripts/fetch_bugwood.py` (1 import + 1 call + 1 manifest_count_by replacement)
- **Modify:** `scripts/fetch_usda_ars.py` (1 import + 1 call)
- **Modify:** `scripts/backfill_metadata.py` (SELECT + UPDATE instead of CSV read/write)
- **Delete or stub:** `db/seed.ts` (no longer needed)
- **Archive:** `data/manifest/` (move to `data/manifest.archive/` for safety, then delete after smoke-test passes)
- **Remove:** `npm run db:seed` from package.json scripts (if file deleted) OR keep as no-op shim

---

## Task 1: DbWriter scaffold + tests (TDD)

**Files:**
- Create: `scripts/db.py`
- Create: `tests/python/test_db_writer.py`

- [ ] **Step 1: Write the failing test.**

```python
# tests/python/test_db_writer.py
"""Unit tests for scripts.db.DbWriter — direct-SQLite replacement
for the legacy ManifestWriter CSV writer."""
import sqlite3
import tempfile
from pathlib import Path

import pytest

from scripts.db import DbWriter, COLUMNS


@pytest.fixture
def tmp_db():
    """Empty in-tmpfile DB with the schema the prod DB has."""
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
        path = Path(f.name)
    conn = sqlite3.connect(path)
    conn.executescript("""
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
            file_size_bytes INTEGER,
            file_sha256 TEXT NOT NULL,
            width INTEGER,
            height INTEGER,
            license TEXT NOT NULL,
            license_url TEXT,
            photographer_attribution TEXT,
            photographer TEXT,
            institution TEXT,
            taxon_order TEXT,
            taxon_species TEXT,
            common_name TEXT,
            subject_state TEXT NOT NULL,
            view_label TEXT,
            life_stage TEXT,
            sex TEXT,
            host_organism TEXT,
            specimen_condition TEXT,
            description TEXT,
            captured_date TEXT,
            raw_metadata TEXT,
            hidden INTEGER DEFAULT 0 NOT NULL,
            added_at INTEGER DEFAULT (unixepoch()) NOT NULL
        );
    """)
    conn.commit()
    conn.close()
    yield path
    path.unlink(missing_ok=True)


SAMPLE = {
    "image_id": "inat-1", "collection_id": "inat-obs-1", "source": "inaturalist",
    "source_id": "1", "source_page_url": "https://x", "image_url": "https://x.jpg",
    "filename": "f.jpg", "thumbnail_filename": "t.jpg", "medium_filename": "m.jpg",
    "file_size_bytes": 1, "file_sha256": "deadbeef", "width": 100, "height": 100,
    "license": "cc0-1.0", "subject_state": "wild",
}


def test_initial_seen_set_is_empty(tmp_db, monkeypatch):
    monkeypatch.setattr("scripts.db.DB_PATH", tmp_db)
    w = DbWriter("inaturalist")
    assert w.count() == 0
    assert not w.has("inat-anything")
    w.close()


def test_write_inserts_row_and_marks_seen(tmp_db, monkeypatch):
    monkeypatch.setattr("scripts.db.DB_PATH", tmp_db)
    w = DbWriter("inaturalist")
    assert w.write(dict(SAMPLE)) is True
    assert w.has("inat-1")
    assert w.count() == 1
    conn = sqlite3.connect(tmp_db)
    rows = list(conn.execute("SELECT image_id, subject_state FROM images"))
    assert rows == [("inat-1", "wild")]
    conn.close()
    w.close()


def test_write_duplicate_returns_false(tmp_db, monkeypatch):
    monkeypatch.setattr("scripts.db.DB_PATH", tmp_db)
    w = DbWriter("inaturalist")
    assert w.write(dict(SAMPLE)) is True
    assert w.write(dict(SAMPLE)) is False
    assert w.count() == 1
    w.close()


def test_per_source_seen_set_isolation(tmp_db, monkeypatch):
    """has() only knows about rows from this writer's source — a bugwood
    row pre-existing in the table is invisible to an iNat writer."""
    monkeypatch.setattr("scripts.db.DB_PATH", tmp_db)
    conn = sqlite3.connect(tmp_db)
    conn.execute(
        f"INSERT INTO images ({','.join(COLUMNS)}) VALUES ({','.join('?' for _ in COLUMNS)})",
        tuple({**SAMPLE, "image_id": "bugwood-99", "source": "bugwood"}.get(c) for c in COLUMNS),
    )
    conn.commit()
    conn.close()
    w_inat = DbWriter("inaturalist")
    assert not w_inat.has("bugwood-99")
    assert w_inat.count() == 0
    w_inat.close()
    w_bug = DbWriter("bugwood")
    assert w_bug.has("bugwood-99")
    assert w_bug.count() == 1
    w_bug.close()


def test_write_with_nullable_columns_omitted(tmp_db, monkeypatch):
    """photographer / institution / etc. are nullable. Omitting them
    in the dict should produce NULL in the DB, not the string 'None'."""
    monkeypatch.setattr("scripts.db.DB_PATH", tmp_db)
    minimal = dict(SAMPLE)
    for k in ("photographer", "institution", "taxon_order", "raw_metadata"):
        minimal.pop(k, None)
    w = DbWriter("inaturalist")
    assert w.write(minimal) is True
    conn = sqlite3.connect(tmp_db)
    row = conn.execute(
        "SELECT photographer, institution, taxon_order, raw_metadata FROM images"
    ).fetchone()
    assert row == (None, None, None, None)
    conn.close()
    w.close()
```

- [ ] **Step 2: Run test to verify all fail (module not found).**

Run: `.venv/bin/pytest tests/python/test_db_writer.py -v`
Expected: `ModuleNotFoundError: No module named 'scripts.db'`.

- [ ] **Step 3: Create `scripts/db.py`.**

```python
"""SQLite-direct writer for the four insect-image downloaders.

Replaces ManifestWriter (CSV append) with UPSERT into images. Same
public interface so fetchers don't change shape:
  .has(image_id)  → bool
  .write(row)     → bool (True on insert; False on dup)
  .count()        → int (size of this writer's source seen set)
  .close()

Schema mirror is hand-maintained in COLUMNS; when db/schema.ts changes,
update this list and run drizzle migrate before any fetcher runs.
"""
from __future__ import annotations
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB_PATH = ROOT / "data" / "db" / "line-of-bugs.db"

COLUMNS = [
    "image_id",
    "collection_id",
    "source", "source_id",
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
UPDATE_COLUMNS = [c for c in COLUMNS if c != "image_id"]
INSERT_SQL = (
    f"INSERT INTO images ({', '.join(COLUMNS)}) "
    f"VALUES ({', '.join('?' for _ in COLUMNS)}) "
    f"ON CONFLICT(image_id) DO UPDATE SET "
    + ", ".join(f"{c}=excluded.{c}" for c in UPDATE_COLUMNS)
)


class DbWriter:
    def __init__(self, source: str):
        self.source = source
        self.conn = sqlite3.connect(DB_PATH, isolation_level=None)  # autocommit
        self.conn.execute("PRAGMA journal_mode = WAL")
        self.conn.execute("PRAGMA synchronous = NORMAL")
        self.conn.execute("PRAGMA busy_timeout = 5000")
        self.conn.execute("PRAGMA foreign_keys = ON")
        self.seen: set[str] = {
            r[0] for r in self.conn.execute(
                "SELECT image_id FROM images WHERE source = ?", (source,),
            )
        }

    def has(self, image_id: str) -> bool:
        return image_id in self.seen

    def write(self, row: dict) -> bool:
        if row.get("image_id") in self.seen:
            return False
        # Empty strings → NULL for nullable cols, but keep "" for required-NOT-NULL
        # text cols. Drizzle defines NOT NULL on: image_id, collection_id, source,
        # source_id, source_page_url, image_url, filename, thumbnail_filename,
        # medium_filename, file_sha256, license, subject_state. Everything else
        # should map "" → None so SELECTs return NULL instead of empty strings.
        values = []
        for c in COLUMNS:
            v = row.get(c)
            if v == "" and c in _NULLABLE:
                v = None
            values.append(v)
        self.conn.execute(INSERT_SQL, tuple(values))
        self.seen.add(row["image_id"])
        return True

    def count(self) -> int:
        return len(self.seen)

    def close(self):
        self.conn.close()


_NULLABLE = {
    "file_size_bytes", "width", "height", "license_url",
    "photographer_attribution", "photographer", "institution",
    "taxon_order", "taxon_species", "common_name", "view_label",
    "life_stage", "sex", "host_organism", "specimen_condition",
    "description", "captured_date", "raw_metadata",
}
```

- [ ] **Step 4: Run tests to verify they pass.**

Run: `.venv/bin/pytest tests/python/test_db_writer.py -v`
Expected: 5/5 pass.

- [ ] **Step 5: Commit.**

```bash
git add scripts/db.py tests/python/test_db_writer.py
git -c commit.gpgsign=false commit -m "r5: DbWriter — sqlite-direct replacement for ManifestWriter (TDD)"
```

---

## Task 2: Wire fetch_smithsonian.py (smoke test bed — smallest dataset)

**Files:**
- Modify: `scripts/fetch_smithsonian.py`

- [ ] **Step 1: Replace import.**

```diff
 from common import (
-    session, ManifestWriter, IMG_DIR, THUMB_DIR, MEDIUM_DIR,
+    session, IMG_DIR, THUMB_DIR, MEDIUM_DIR,
     parallel_download, ConsecutiveFailureGuard,
     setup_logging, build_filename, slugify,
 )
+from db import DbWriter
```

- [ ] **Step 2: Replace the writer construction.**

In `main()`:
```diff
-    mw = ManifestWriter("smithsonian")
+    mw = DbWriter("smithsonian")
```

The rest of the file uses `mw.has(...)` / `mw.write({...})` / `mw.count()` / `mw.close()` — all unchanged.

- [ ] **Step 3: Smoke run (idempotent — should fetch 0 new since all 351 already in DB).**

```bash
.venv/bin/python scripts/fetch_smithsonian.py 2>&1 | tail -10
```

Expected: log shows "resuming with 351 already" and "added_this_run=0".

- [ ] **Step 4: Verify DB row count unchanged.**

```bash
sqlite3 data/db/line-of-bugs.db "SELECT COUNT(*) FROM images WHERE source='smithsonian'"
```
Expected: 351.

- [ ] **Step 5: Commit.**

```bash
git add scripts/fetch_smithsonian.py
git -c commit.gpgsign=false commit -m "r5: fetch_smithsonian uses DbWriter"
```

---

## Task 3: Wire fetch_inaturalist.py

**Files:** Modify: `scripts/fetch_inaturalist.py`

- [ ] **Step 1: Replace import + writer construction.**

```diff
 from common import (
-    session, ManifestWriter, IMG_DIR, THUMB_DIR, MEDIUM_DIR, MIN_LONG_EDGE_DEFAULT,
-    parallel_download, ConsecutiveFailureGuard, read_existing_rows,
+    session, IMG_DIR, THUMB_DIR, MEDIUM_DIR, MIN_LONG_EDGE_DEFAULT,
+    parallel_download, ConsecutiveFailureGuard,
     setup_logging, build_filename, slugify,
 )
+from db import DbWriter
```

```diff
 def main() -> int:
-    mw = ManifestWriter("inaturalist")
+    mw = DbWriter("inaturalist")
```

- [ ] **Step 2: Replace the `read_existing_rows` → existing_by_label seed.**

`main()` currently does:
```python
existing_by_label = Counter()
for row in read_existing_rows(mw.path):
    existing_by_label[row.get("taxon_order", "")] += 1
```

Replace with a direct DB query:
```python
existing_by_label = Counter()
for label, n in mw.conn.execute(
    "SELECT taxon_order, COUNT(*) FROM images WHERE source = 'inaturalist' "
    "GROUP BY taxon_order"
):
    existing_by_label[label] = n
```

- [ ] **Step 3: Smoke run with INAT_SCALE=0.01 (essentially a no-op).**

```bash
INAT_SCALE=0.01 .venv/bin/python scripts/fetch_inaturalist.py 2>&1 | tail -10
```

Expected: skips every order ("already have N ≥ target M — skipping").

- [ ] **Step 4: Commit.**

```bash
git -c commit.gpgsign=false commit -am "r5: fetch_inaturalist uses DbWriter"
```

---

## Task 4: Wire fetch_bugwood.py

**Files:** Modify: `scripts/fetch_bugwood.py`

- [ ] **Step 1: Replace import + writer.**

Same pattern as smithsonian/iNat.

- [ ] **Step 2: Replace `manifest_count_by` usage.**

`main()` currently:
```python
bucket_counts = manifest_count_by(mw.path, "license", "subject_state")
```

Replace with:
```python
bucket_counts = {}
for lic, state, n in mw.conn.execute(
    "SELECT license, subject_state, COUNT(*) FROM images "
    "WHERE source = 'bugwood' GROUP BY license, subject_state"
):
    bucket_counts[(lic, state)] = n
```

- [ ] **Step 3: Smoke run with all targets already met (no new fetches expected).**

```bash
.venv/bin/python scripts/fetch_bugwood.py 2>&1 | tail -15
```

Expected: each pass logs "already have N ≥ target M — skipping" since R4 already filled to targets.

- [ ] **Step 4: Commit.**

---

## Task 5: Wire fetch_usda_ars.py

**Files:** Modify: `scripts/fetch_usda_ars.py`

- [ ] **Step 1: Replace import + writer construction.**

USDA fetcher doesn't use manifest_count_by or read_existing_rows. Just the writer.

- [ ] **Step 2: Smoke run — expect it to fail fast on DNS (host still down).**

Verifies fail-fast still works with DbWriter init.

- [ ] **Step 3: Commit.**

---

## Task 6: Backfill script → SELECT/UPDATE directly on DB

**Files:** Modify: `scripts/backfill_metadata.py`

The backfill currently reads CSV → mutates dicts → rewrites CSV. New flow: SELECT rows with `raw_metadata IS NULL` directly from SQLite, re-query API, UPDATE in place.

- [ ] **Step 1: Replace CSV read with DB SELECT.**

```python
def load_rows_needing_backfill(source: str) -> list[dict]:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    rows = list(conn.execute(
        "SELECT image_id, collection_id, source_id, source_page_url, "
        "description, life_stage, sex, host_organism, specimen_condition, "
        "raw_metadata FROM images "
        "WHERE source = ? AND (raw_metadata IS NULL OR raw_metadata = '')",
        (source,),
    ))
    conn.close()
    return [dict(r) for r in rows]
```

- [ ] **Step 2: Replace `write_back(path, rows)` with `apply_updates(rows)`.**

```python
def apply_updates(rows: list[dict]) -> None:
    conn = sqlite3.connect(DB_PATH, isolation_level=None)
    conn.execute("PRAGMA journal_mode = WAL")
    conn.executemany(
        "UPDATE images SET "
        "life_stage = ?, sex = ?, host_organism = ?, "
        "specimen_condition = ?, description = ?, raw_metadata = ? "
        "WHERE image_id = ?",
        [(r.get("life_stage"), r.get("sex"), r.get("host_organism"),
          r.get("specimen_condition"), r.get("description"),
          r.get("raw_metadata"), r["image_id"]) for r in rows],
    )
    conn.close()
```

- [ ] **Step 3: Rewire `main()` to use load + apply per source.**

Remove all `from common import MANIFEST_DIR, MANIFEST_FIELDS`, the `write_back()` helper, the `csv` module import.

- [ ] **Step 4: Smoke run on Smithsonian (351 rows, all currently `raw_metadata` populated — should be 0 work).**

```bash
.venv/bin/python scripts/backfill_metadata.py smithsonian 2>&1 | tail -5
```

Expected: "0 rows to backfill".

- [ ] **Step 5: Commit.**

---

## Task 7: Concurrency smoke test

- [ ] **Step 1: Start dev server.**

```bash
nohup npm run dev > /tmp/r5-dev.log 2>&1 &
sleep 12
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/gallery
```

- [ ] **Step 2: Run a fetcher while serving traffic.**

```bash
.venv/bin/python scripts/fetch_smithsonian.py &
FETCH_PID=$!
for i in 1 2 3 4 5; do
  curl -s "http://localhost:3000/api/session/count?subject=both" >/dev/null
  echo "tick $i"
  sleep 1
done
wait $FETCH_PID
```

- [ ] **Step 3: Check `/tmp/r5-dev.log` for SQLITE_BUSY errors.**

Expected: no errors. WAL + busy_timeout=5000 handles this.

- [ ] **Step 4: Stop dev server.**

```bash
pkill -f "next dev"
```

---

## Task 8: Remove CSV layer from common.py

**Files:** Modify: `scripts/common.py`

- [ ] **Step 1: Remove `MANIFEST_FIELDS`, `MANIFEST_DIR`, `ManifestWriter`, `manifest_count_by`, `read_existing_rows`, `csv` import, `csv.field_size_limit`.**

- [ ] **Step 2: Run pytest on all Python tests.**

```bash
.venv/bin/pytest tests/python/ -q
```

Expected: all pass (DbWriter tests + any framing-detector tests untouched).

- [ ] **Step 3: Commit.**

---

## Task 9: Delete `db/seed.ts` + npm script

**Files:**
- Delete: `db/seed.ts`
- Modify: `package.json` (remove the `db:seed` script entry)

- [ ] **Step 1: Delete `db/seed.ts`.**

- [ ] **Step 2: Edit `package.json` to remove `"db:seed": "tsx db/seed.ts"`.**

- [ ] **Step 3: `npm run build` to confirm nothing imports seed.**

- [ ] **Step 4: Commit.**

---

## Task 10: Archive + delete `data/manifest/`

- [ ] **Step 1: Move (don't delete) for safety.**

```bash
mv data/manifest data/manifest.archive
```

- [ ] **Step 2: Run a fetcher (smithsonian — smallest) to confirm no manifest dependency remains.**

```bash
.venv/bin/python scripts/fetch_smithsonian.py 2>&1 | tail -5
```

Expected: no manifest-related errors. Run is a no-op (351 already in DB).

- [ ] **Step 3: Run the prod Next.js build to confirm app side is unaffected.**

```bash
npm run build 2>&1 | tail -10
```

- [ ] **Step 4: Delete the archive.**

```bash
rm -rf data/manifest.archive
```

- [ ] **Step 5: Add `data/manifest/` removal to `data/.gitignore` cleanup if relevant.**

- [ ] **Step 6: Commit.**

---

## Task 11: Final cleanup commit + update docs

- [ ] **Step 1: Run all tests.**

```bash
npm run test
.venv/bin/pytest tests/python/ -q
ADMIN_PASSWORD=dev-pass npm run test:e2e -- --reporter=line --grep-invert "admin"
```

All should pass.

- [ ] **Step 2: Send a Telegram announcement.**

```bash
~/.local/bin/telegram-notify send "line-of-bugs R5 done — CSV intermediate dropped. Fetchers write SQLite directly. ManifestWriter + db/seed.ts deleted. 4-6h estimate held."
```

- [ ] **Step 3: Mark task #43 complete.**

---

## Self-review checklist

- Every step has either a code block or a runnable command.
- No "TBD", no "similar to above", no "implement later".
- Tests defined in Task 1 cover the contract that every fetcher relies on (`has` / `write` / `count` / `close`).
- COLUMNS list in `scripts/db.py` exactly matches `MANIFEST_FIELDS` in current `scripts/common.py` (verify by diff).
- WAL + busy_timeout in DbWriter init match `db/index.ts` so app + fetcher coexist.
- Backfill rewrite preserves the small-batch / consecutive-failure-guard logic from the CSV version — only the storage layer changes.
- `db/seed.ts` deletion is reversible from `git show` if needed.
