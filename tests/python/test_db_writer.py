"""Unit tests for scripts.db.DbWriter — direct-SQLite replacement
for the legacy ManifestWriter CSV writer (R5).

Each test runs against a fresh tmp SQLite file with the production
images-table schema, so it never touches the real data/db file.
"""
import sqlite3
import tempfile
from pathlib import Path

import pytest

from scripts.db import DbWriter, COLUMNS


SCHEMA = """
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
    taxon_subgroup TEXT,
    hidden INTEGER DEFAULT 0 NOT NULL,
    added_at INTEGER DEFAULT (unixepoch()) NOT NULL
);
"""


@pytest.fixture
def tmp_db():
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
        path = Path(f.name)
    conn = sqlite3.connect(path)
    conn.executescript(SCHEMA)
    conn.commit()
    conn.close()
    yield path
    path.unlink(missing_ok=True)


SAMPLE = {
    "image_id": "inat-1",
    "collection_id": "inat-obs-1",
    "source": "inaturalist",
    "source_id": "1",
    "source_page_url": "https://x",
    "image_url": "https://x.jpg",
    "filename": "f.jpg",
    "thumbnail_filename": "t.jpg",
    "medium_filename": "m.jpg",
    "file_size_bytes": 1,
    "file_sha256": "deadbeef",
    "width": 100,
    "height": 100,
    "license": "cc0-1.0",
    "subject_state": "wild",
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
    conn.close()
    assert rows == [("inat-1", "wild")]
    w.close()


def test_write_duplicate_returns_false(tmp_db, monkeypatch):
    monkeypatch.setattr("scripts.db.DB_PATH", tmp_db)
    w = DbWriter("inaturalist")
    assert w.write(dict(SAMPLE)) is True
    assert w.write(dict(SAMPLE)) is False
    assert w.count() == 1
    w.close()


def test_per_source_seen_set_isolation(tmp_db, monkeypatch):
    """has() only knows about rows from this writer's source — a Bugwood
    row pre-existing in the table is invisible to an iNat writer."""
    monkeypatch.setattr("scripts.db.DB_PATH", tmp_db)
    conn = sqlite3.connect(tmp_db)
    other = {**SAMPLE, "image_id": "bugwood-99", "source": "bugwood"}
    conn.execute(
        f"INSERT INTO images ({','.join(COLUMNS)}) "
        f"VALUES ({','.join('?' for _ in COLUMNS)})",
        tuple(other.get(c) for c in COLUMNS),
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
    """Optional cols (photographer / institution / etc.) should land as
    SQL NULL when omitted from the dict, not as empty strings."""
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
    conn.close()
    assert row == (None, None, None, None)
    w.close()


def test_write_empty_string_to_nullable_becomes_null(tmp_db, monkeypatch):
    """Many fetchers pass '' for unknown optional fields — treat those
    as SQL NULL too. The required NOT NULL cols stay literal."""
    monkeypatch.setattr("scripts.db.DB_PATH", tmp_db)
    row = dict(SAMPLE)
    row["taxon_order"] = ""
    row["host_organism"] = ""
    w = DbWriter("inaturalist")
    assert w.write(row) is True
    conn = sqlite3.connect(tmp_db)
    got = conn.execute(
        "SELECT taxon_order, host_organism, subject_state FROM images"
    ).fetchone()
    conn.close()
    # nullable: '' → NULL.  not-null (subject_state): stays literal.
    assert got == (None, None, "wild")
    w.close()
