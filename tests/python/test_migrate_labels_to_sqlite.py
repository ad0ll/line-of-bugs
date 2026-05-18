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
