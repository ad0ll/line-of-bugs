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
    tmp_path.mkdir(parents=True, exist_ok=True)
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
        parquet, ["mask_blur_unusable"],
        model_versions={"mask_blur_unusable": "mask_blur_unusable@1779000000"},
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
