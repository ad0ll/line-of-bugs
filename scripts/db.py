"""SQLite-direct writer for the four insect-image downloaders.

Replaces the legacy CSV-based ManifestWriter with an UPSERT into the
`images` table. Same public interface so fetchers don't change shape:

    .has(image_id)  → bool
    .write(row)     → bool (True on insert, False on duplicate)
    .count()        → int  (size of this writer's source seen set)
    .close()

The COLUMNS list is the Python image of the Drizzle `images` schema
in `db/schema.ts`. When the TS schema grows a column, mirror it here
AND in _NULLABLE if the new column is nullable, then run drizzle
migrate before any fetcher runs.

PRAGMA matches `db/index.ts` so the app + fetcher can hold connections
concurrently without SQLITE_BUSY.
"""
from __future__ import annotations
import sqlite3
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
        self.conn = sqlite3.connect(DB_PATH, isolation_level=None)
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
        return True

    def count(self) -> int:
        return len(self.seen)

    def close(self):
        self.conn.close()
