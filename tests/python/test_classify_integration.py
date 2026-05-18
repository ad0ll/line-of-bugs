"""Integration test for classify.run_v1_on_sample using stub detector/segmenter.

Synthetic single-row input → no GPU, no model weights, no real images required.
Verifies the pipeline produces a valid parquet row with all Phase 2 schema
columns populated correctly.
"""
from __future__ import annotations
import sqlite3
from unittest.mock import patch

import pyarrow.parquet as pq
from PIL import Image


STUB_IMAGE_ID = "stub-integration-0001"
STUB_SOURCE = "inaturalist"

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
  gate_rule_only TEXT NOT NULL CHECK (gate_rule_only IN ('keep','reject')),
  has_bbox INTEGER NOT NULL CHECK (has_bbox IN (0, 1)),
  bbox_x REAL, bbox_y REAL, bbox_w REAL, bbox_h REAL,
  mask_area_ratio REAL, lab_delta_e REAL, boundary_sharpness REAL,
  mask_iou_score REAL,
  crop_x REAL, crop_y REAL, crop_w REAL, crop_h REAL,
  post_crop_subject_area REAL,
  processed_at INTEGER NOT NULL, schema_version INTEGER NOT NULL
);
"""


def test_run_v1_with_stubs_produces_valid_parquet_row(tmp_path):
    """run_v1_on_sample with _stub detector/segmenter writes one parquet row
    with correct Phase 2 schema shape."""
    images_dir = tmp_path / "images"
    images_dir.mkdir()
    img = Image.new("RGB", (320, 240), color=(100, 150, 80))
    img.save(str(images_dir / f"{STUB_IMAGE_ID}.jpg"), "JPEG")

    parquet_path = tmp_path / "test_output.parquet"

    sample_rows = [{
        "image_id": STUB_IMAGE_ID,
        "source": STUB_SOURCE,
        "subject_state": "wild",
        "filename": f"images/{STUB_IMAGE_ID}.jpg",
    }]

    with patch("scripts.detect_subjects.classify.DATA_DIR", tmp_path), \
         patch("scripts.detect_subjects.classify.cfg.DETECTOR_VARIANT", "_stub"), \
         patch("scripts.detect_subjects.classify.cfg.SEGMENTER_VARIANT", "_stub"), \
         patch("scripts.detect_subjects.classify.CROPS_DIR", tmp_path / "crops"):

        from scripts.detect_subjects.classify import run_v1_on_sample
        summary = run_v1_on_sample(
            sample_rows=sample_rows,
            parquet_path=parquet_path,
            device="cpu",
        )

    assert summary["processed"] == 1, f"expected 1 processed, got {summary}"
    assert summary["errors"] == 0, f"unexpected errors: {summary}"
    assert parquet_path.exists(), "parquet not written"

    table = pq.read_table(parquet_path)
    assert table.num_rows == 1

    col_names = set(table.schema.names)
    for col in ("text_label", "text_label_score", "gate_decision", "distinct_subjects"):
        assert col in col_names, f"missing Phase 2 column: {col}"

    row = table.to_pydict()
    assert row["text_label"][0] == "a beetle", f"unexpected text_label: {row['text_label'][0]}"
    assert isinstance(row["text_label_score"][0], float)
    # gate_decision wired in Phase 2a — must now be a "keep" or "reject" string
    assert row["gate_decision"][0] in ("keep", "reject")
    ds = row["distinct_subjects"][0]
    assert len(ds) == 1
    assert ds[0]["phrase"] == "a beetle"
    assert "__" in row["variant"][0], f"variant missing __ separator: {row['variant'][0]}"
    assert row["bbox_x"][0] is not None
    assert row["confidence"][0] is not None


def test_run_v1_syncs_detections_to_sqlite(tmp_path, monkeypatch):
    """run_v1_on_sample, after writing parquet, also syncs detections to SQLite."""
    images_dir = tmp_path / "images"
    images_dir.mkdir()
    img = Image.new("RGB", (320, 240), color=(100, 150, 80))
    img.save(str(images_dir / f"{STUB_IMAGE_ID}.jpg"), "JPEG")

    db_path = tmp_path / "test.db"
    conn = sqlite3.connect(db_path)
    conn.executescript(IMAGES_SCHEMA)
    conn.executescript(DETECTIONS_SCHEMA)
    conn.execute(
        "INSERT INTO images (image_id, collection_id, source, source_id, "
        "source_page_url, image_url, filename, thumbnail_filename, "
        "medium_filename, file_sha256, license, subject_state) "
        "VALUES (?, 'c', 'inaturalist', 's', 'u', 'u', 'f', 't', 'm', "
        "'sha', 'lic', 'wild')",
        (STUB_IMAGE_ID,),
    )
    conn.commit()
    conn.close()

    parquet_path = tmp_path / "test_output.parquet"
    sample_rows = [{
        "image_id": STUB_IMAGE_ID,
        "source": STUB_SOURCE,
        "subject_state": "wild",
        "filename": f"images/{STUB_IMAGE_ID}.jpg",
    }]

    # open_conn reads DEFAULT_DB_PATH at call time, so monkeypatching the
    # sqlite_db module attribute redirects sync_detections to the tmp DB.
    # detections_sync also reads its own bound DEFAULT_DB_PATH at function
    # entry, so patch that too in case it's already been imported.
    monkeypatch.setattr(
        "scripts.detect_subjects.sqlite_db.DEFAULT_DB_PATH", db_path,
    )
    import scripts.detect_subjects.detections_sync as _ds
    monkeypatch.setattr(_ds, "DEFAULT_DB_PATH", db_path)

    with patch("scripts.detect_subjects.classify.DATA_DIR", tmp_path), \
         patch("scripts.detect_subjects.classify.cfg.DETECTOR_VARIANT", "_stub"), \
         patch("scripts.detect_subjects.classify.cfg.SEGMENTER_VARIANT", "_stub"), \
         patch("scripts.detect_subjects.classify.CROPS_DIR", tmp_path / "crops"):
        from scripts.detect_subjects.classify import run_v1_on_sample
        summary = run_v1_on_sample(
            sample_rows=sample_rows, parquet_path=parquet_path, device="cpu",
        )

    assert summary["processed"] == 1
    assert summary["sqlite_detections_upserted"] == 1

    conn = sqlite3.connect(db_path)
    rows = list(conn.execute(
        "SELECT image_id, variant, has_bbox FROM detections"
    ))
    conn.close()
    assert len(rows) == 1
    assert rows[0][0] == STUB_IMAGE_ID
    assert "__" in rows[0][1]   # variant is detector__segmenter
