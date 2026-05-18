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
