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
