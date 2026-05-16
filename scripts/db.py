"""SQLite-direct writer for the four insect-image downloaders.

Replaces the legacy CSV-based ManifestWriter with an UPSERT into the
`images` table. Public interface:

    .has(image_id)              → bool
    .write(row, refresh=False)  → bool (True on write, False on skip)
    .batch()                    → context manager wrapping N writes in
                                  one BEGIN/COMMIT round-trip
    .count()                    → int (size of this writer's seen set)
    .close()

The COLUMNS list is the Python image of the Drizzle `images` schema
in `db/schema.ts`. When the TS schema grows a column, mirror it here
AND in _NULLABLE if the new column is nullable, then run drizzle
migrate before any fetcher runs.

Transaction model: we use sqlite3's default deferred isolation. Writes
outside an explicit `with writer.batch():` block still commit one row
per write() (single-row auto-transaction); inside a batch, every
write() shares the same BEGIN…COMMIT so a 200-row page goes down in
one fsync instead of 200. With WAL + synchronous=NORMAL the speedup
on a fresh DB measures around 10× for a typical iNat page.

PRAGMA matches `db/index.ts` so the app + fetcher can hold connections
concurrently without SQLITE_BUSY.
"""
from __future__ import annotations
import sqlite3
from contextlib import contextmanager
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB_PATH = ROOT / "data" / "db" / "line-of-bugs.db"

# Order matters — INSERT_SQL relies on positional binding.
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
    "taxon_subgroup",
]

# Updated on conflict — everything except the primary key. hidden +
# added_at are intentionally excluded: hidden is managed by the
# moderation flow (admin actions) and added_at is a one-time fact.
UPDATE_COLUMNS = [c for c in COLUMNS if c != "image_id"]

INSERT_SQL = (
    f"INSERT INTO images ({', '.join(COLUMNS)}) "
    f"VALUES ({', '.join('?' for _ in COLUMNS)}) "
    f"ON CONFLICT(image_id) DO UPDATE SET "
    + ", ".join(f"{c}=excluded.{c}" for c in UPDATE_COLUMNS)
)

# Optional columns — empty-string input from fetchers gets coerced to
# SQL NULL so SELECTs return None instead of "". Required NOT NULL
# columns (image_id, collection_id, source, source_id, *_url, filename
# variants, file_sha256, license, subject_state) stay literal.
_NULLABLE = {
    "file_size_bytes", "width", "height", "license_url",
    "photographer_attribution", "photographer", "institution",
    "taxon_order", "taxon_species", "common_name", "view_label",
    "life_stage", "sex", "host_organism", "specimen_condition",
    "description", "captured_date", "raw_metadata",
    "taxon_subgroup",
}


class DbWriter:
    def __init__(self, source: str):
        self.source = source
        # Default isolation_level ("" / "DEFERRED") lets sqlite3 manage
        # transactions implicitly. We previously used None (autocommit)
        # which forced a per-row fsync; the batch() context manager
        # below lets fetchers amortise that across a whole page.
        self.conn = sqlite3.connect(DB_PATH)
        self.conn.execute("PRAGMA journal_mode = WAL")
        self.conn.execute("PRAGMA synchronous = NORMAL")
        self.conn.execute("PRAGMA busy_timeout = 5000")
        self.conn.execute("PRAGMA foreign_keys = ON")
        self.seen: set[str] = {
            r[0]
            for r in self.conn.execute(
                "SELECT image_id FROM images WHERE source = ?", (source,)
            )
        }
        # Drop the implicit transaction that the seen-set SELECT may
        # have opened so we start in a clean autocommit-ish state.
        self.conn.commit()
        # Tracks whether we're inside an explicit batch() block. write()
        # only auto-commits when this is False.
        self._in_batch = False

    def has(self, image_id: str) -> bool:
        return image_id in self.seen

    def write(self, row: dict, refresh: bool = False) -> bool:
        """Insert a new image_id, or refresh an existing row if `refresh=True`.

        Default behaviour skips rows whose image_id is already in `self.seen`
        — fetchers normally short-circuit duplicates via `.has()` before
        ever calling `write()`. When `refresh=True`, the existing row gets
        UPSERTed (every non-PK column overwritten by the new values) so
        upstream corrections — relicensed photos, updated common names,
        better attribution strings — propagate. Returns True if a row was
        written (insert OR refresh), False if skipped.

        Outside a `batch()` context, each successful write commits
        immediately. Inside a batch, writes share one transaction so
        a 200-row page costs one fsync rather than 200.
        """
        image_id = row.get("image_id")
        if not image_id:
            return False
        if image_id in self.seen and not refresh:
            return False
        values = []
        for c in COLUMNS:
            v = row.get(c)
            if v == "" and c in _NULLABLE:
                v = None
            values.append(v)
        self.conn.execute(INSERT_SQL, tuple(values))
        self.seen.add(image_id)
        if not self._in_batch:
            # No explicit batch() block is active — sqlite3 auto-opened
            # a DEFERRED transaction for the INSERT; commit it so a
            # crash before the next write() doesn't lose this row.
            self.conn.commit()
        return True

    @contextmanager
    def batch(self):
        """Wrap a block of write() calls in one BEGIN…COMMIT. On any
        exception the partial batch is rolled back.

            with mw.batch():
                for row in page:
                    mw.write(row)
        """
        # Explicit BEGIN keeps the boundary obvious in logs and in
        # `EXPLAIN`-style traces.
        self.conn.execute("BEGIN")
        self._in_batch = True
        try:
            yield self
        except Exception:
            self.conn.rollback()
            raise
        else:
            self.conn.commit()
        finally:
            self._in_batch = False

    def count(self) -> int:
        return len(self.seen)

    def close(self):
        if self.conn.in_transaction:
            self.conn.commit()
        self.conn.close()
