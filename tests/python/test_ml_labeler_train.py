"""Verify training script persists a fitted classifier with metrics."""
import json
import sqlite3
from pathlib import Path
import numpy as np
import polars as pl


IMAGES_SCHEMA = """
CREATE TABLE images (
  image_id TEXT PRIMARY KEY,
  collection_id TEXT NOT NULL, source TEXT NOT NULL, source_id TEXT NOT NULL,
  source_page_url TEXT NOT NULL, image_url TEXT NOT NULL,
  filename TEXT NOT NULL, thumbnail_filename TEXT NOT NULL,
  medium_filename TEXT NOT NULL, file_sha256 TEXT NOT NULL,
  license TEXT NOT NULL, subject_state TEXT NOT NULL,
  hidden INTEGER NOT NULL DEFAULT 0,
  view_label TEXT,
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

# T8 also writes suggested_threshold into label_thresholds; the test DB must
# include this table so the UPDATE in _write_suggested_threshold doesn't fail.
LABEL_THRESHOLDS_SCHEMA = """
CREATE TABLE label_thresholds (
  label TEXT PRIMARY KEY,
  tier INTEGER NOT NULL CHECK (tier IN (1, 2)),
  threshold REAL NOT NULL,
  suggested_threshold REAL,
  threshold_v INTEGER NOT NULL,
  notes TEXT,
  updated_at INTEGER NOT NULL
);
"""


def _fake_parquet_and_db(tmpdir: Path):
    """Build a tiny synthetic parquet + SQLite DB with blur_unusable positives."""
    rng = np.random.default_rng(0)
    n = 80
    image_ids = [f"img-{i:03d}" for i in range(n)]
    sharpness = rng.uniform(100, 500, n)
    sharpness[:40] -= 200  # first 40 are positives, lower sharpness
    df = pl.DataFrame({
        "image_id": image_ids,
        "variant": ["sam3__sam3"] * n,
        "bbox_x": [0.4] * n, "bbox_y": [0.4] * n,
        "bbox_w": [0.2] * n, "bbox_h": [0.2] * n,
        "bbox_area_ratio": [0.04] * n,
        "offcenter": [0.1] * n,
        "bbox_min_edge_px": [200.0] * n,
        "bbox_long_edge_px": [300.0] * n,
        "mask_area_ratio": [0.03] * n,
        "lab_delta_e": [15.0] * n,
        "boundary_sharpness": [5.0] * n,
        "subject_sharpness": sharpness.tolist(),
        "top10pct_lap_mask": [50.0] * n,
        "edge_density_mask_vs_bg": [1.5] * n,
        "confidence": [0.9] * n,
        "n_distinct_detections": [1] * n,
        "framing_quality": ["good"] * n,
    })
    parquet_path = tmpdir / "test.parquet"
    df.write_parquet(parquet_path)

    db_path = tmpdir / "test.db"
    conn = sqlite3.connect(db_path)
    conn.executescript(IMAGES_SCHEMA)
    conn.executescript(IMAGE_LABELS_SCHEMA)
    conn.executescript(LABEL_THRESHOLDS_SCHEMA)
    # Seed the threshold row so train.py's UPDATE finds something to write to.
    conn.execute(
        "INSERT INTO label_thresholds (label, tier, threshold, threshold_v, updated_at) "
        "VALUES ('mask_blur_unusable', 1, 0.5, 1, 1)"
    )
    for iid in image_ids:
        conn.execute(
            "INSERT INTO images (image_id, collection_id, source, source_id, "
            "source_page_url, image_url, filename, thumbnail_filename, "
            "medium_filename, file_sha256, license, subject_state) "
            "VALUES (?, 'c', 'inaturalist', 's', 'u', 'u', 'f', 't', 'm', "
            "'sha', 'lic', 'wild')",
            (iid,),
        )
    for i, iid in enumerate(image_ids):
        col3 = json.dumps(["mask_blur_unusable"] if i < 40 else [])
        conn.execute(
            "INSERT INTO image_labels (image_id, col1, col2_count, col2_flags, "
            "col3, col4, unsure, reviewed_at, user_edited, variant_tag) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (iid, "bbox_correct-subject_not-clipped", "bbox-content_single",
             "[]", col3, "[]", 0, 1, 1, "sam3__sam3"),
        )
    conn.commit()
    conn.close()
    return parquet_path, db_path


def test_train_blur_unusable_persists_model_and_metrics(tmp_path):
    from scripts.detect_subjects.ml_labeler.train import train_label
    parquet_path, db_path = _fake_parquet_and_db(tmp_path)
    out_dir = tmp_path / "models" / "mask_blur_unusable"
    metrics = train_label(
        label="mask_blur_unusable",
        parquet_path=parquet_path, db_path=db_path,
        out_dir=out_dir, random_state=42,
    )
    assert (out_dir / "arm_scalar_latest.joblib").exists()
    assert (out_dir / "metrics.json").exists()
    assert metrics["arm_scalar"]["mcc_mean"] > 0.3
    assert metrics["n_positives"] == 40
    assert metrics["n_total"] == 80


def test_train_writes_suggested_threshold(tmp_path):
    """After train_label runs, label_thresholds.suggested_threshold is set."""
    from scripts.detect_subjects.ml_labeler.train import train_label
    parquet_path, db_path = _fake_parquet_and_db(tmp_path)
    out_dir = tmp_path / "models" / "mask_blur_unusable"
    train_label(
        label="mask_blur_unusable",
        parquet_path=parquet_path, db_path=db_path,
        out_dir=out_dir, random_state=42,
    )
    conn = sqlite3.connect(db_path)
    row = conn.execute(
        "SELECT suggested_threshold, threshold "
        "FROM label_thresholds WHERE label='mask_blur_unusable'"
    ).fetchone()
    conn.close()
    assert row[0] is not None and 0.0 <= row[0] <= 1.0
    # threshold (human-edited column) MUST remain at its seed value of 0.5.
    assert row[1] == 0.5


def test_train_writes_suggested_threshold_for_unseeded_label(tmp_path):
    """Training a label NOT in label_thresholds should INSERT a row with
    threshold=1.0 (safe off) and the computed suggested_threshold."""
    from scripts.detect_subjects.ml_labeler.train import train_label
    import sqlite3
    # Reuse the fixture but use a DIFFERENT label so no seed row exists
    parquet_path, db_path = _fake_parquet_and_db(tmp_path)
    # Drop the seed row that _fake_parquet_and_db inserts
    conn = sqlite3.connect(db_path)
    conn.execute("DELETE FROM label_thresholds")
    conn.commit()
    conn.close()
    out_dir = tmp_path / "models" / "mask_blur_unusable"
    train_label(
        label="mask_blur_unusable",
        parquet_path=parquet_path, db_path=db_path,
        out_dir=out_dir, random_state=42,
    )
    conn = sqlite3.connect(db_path)
    row = conn.execute(
        "SELECT tier, threshold, suggested_threshold, threshold_v "
        "FROM label_thresholds WHERE label='mask_blur_unusable'"
    ).fetchone()
    conn.close()
    assert row is not None, "row should have been inserted"
    assert row[0] == 1            # tier=1 (default)
    assert row[1] == 1.0          # threshold=1.0 (safe off)
    assert row[2] is not None and 0.0 <= row[2] <= 1.0
    assert row[3] == 1            # threshold_v=1
