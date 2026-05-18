"""Verify batch predict writes probability columns to parquet."""
import json
from pathlib import Path
import numpy as np
import polars as pl

def _setup(tmp_path: Path):
    # Re-use the fake parquet + DB generator from test_ml_labeler_train.py
    from tests.python.test_ml_labeler_train import _fake_parquet_and_db
    from scripts.detect_subjects.ml_labeler.train import train_label
    parquet_path, db_path = _fake_parquet_and_db(tmp_path)
    out_dir = tmp_path / "models" / "mask_blur_unusable"
    train_label(label="mask_blur_unusable", parquet_path=parquet_path,
                db_path=db_path, out_dir=out_dir, random_state=42)
    return parquet_path, db_path, out_dir

def test_predict_writes_columns(tmp_path):
    from scripts.detect_subjects.ml_labeler.predict import predict_label_into_parquet
    parquet_path, db_path, model_dir = _setup(tmp_path)
    # Need predictions + gate_decisions tables for the SQLite sync side-effect.
    import sqlite3
    conn = sqlite3.connect(db_path)
    conn.executescript("""
      CREATE TABLE predictions (
        image_id TEXT NOT NULL REFERENCES images(image_id) ON DELETE CASCADE,
        label TEXT NOT NULL, p REAL NOT NULL,
        unreliable INTEGER NOT NULL DEFAULT 0 CHECK (unreliable IN (0, 1)),
        model_version TEXT NOT NULL, predicted_at INTEGER NOT NULL,
        PRIMARY KEY (image_id, label)
      );
      CREATE TABLE gate_decisions (
        image_id TEXT PRIMARY KEY REFERENCES images(image_id) ON DELETE CASCADE,
        decision TEXT NOT NULL CHECK (decision IN ('keep','reject')),
        reason TEXT NOT NULL,
        reason_source TEXT NOT NULL CHECK (reason_source IN ('hand','report','rule','ml','default')),
        computed_at INTEGER NOT NULL,
        model_version TEXT, threshold_v INTEGER
      );
    """)
    conn.commit()
    conn.close()

    n_updated = predict_label_into_parquet(
        label="mask_blur_unusable",
        parquet_path=parquet_path,
        model_path=model_dir / "arm_scalar_latest.joblib",
        db_path=db_path,
        models_dir=tmp_path / "models",
    )
    assert n_updated == 80
    df = pl.read_parquet(parquet_path)
    assert "predicted_mask_blur_unusable_p" in df.columns
    assert "predicted_mask_blur_unusable_unreliable" in df.columns
    probs = df["predicted_mask_blur_unusable_p"].to_numpy()
    assert (probs >= 0).all() and (probs <= 1).all()
    # First 40 are positives — mean prob should be higher than last 40
    assert probs[:40].mean() > probs[40:].mean()


def test_predict_writes_to_predictions_and_triggers_gate(tmp_path):
    """End-to-end: train → predict → predictions rows exist + gate_decisions written."""
    import sqlite3
    from scripts.detect_subjects.ml_labeler.train import train_label
    from scripts.detect_subjects.ml_labeler.predict import predict_labels_batched

    # Reuse fake parquet + DB helper from train test.
    from tests.python.test_ml_labeler_train import _fake_parquet_and_db
    parquet_path, db_path = _fake_parquet_and_db(tmp_path)
    # We also need the predictions + gate_decisions tables. label_thresholds
    # was already seeded by _fake_parquet_and_db in T8.
    conn = sqlite3.connect(db_path)
    conn.executescript("""
      CREATE TABLE predictions (
        image_id TEXT NOT NULL REFERENCES images(image_id) ON DELETE CASCADE,
        label TEXT NOT NULL, p REAL NOT NULL,
        unreliable INTEGER NOT NULL DEFAULT 0 CHECK (unreliable IN (0, 1)),
        model_version TEXT NOT NULL, predicted_at INTEGER NOT NULL,
        PRIMARY KEY (image_id, label)
      );
      CREATE TABLE gate_decisions (
        image_id TEXT PRIMARY KEY REFERENCES images(image_id) ON DELETE CASCADE,
        decision TEXT NOT NULL CHECK (decision IN ('keep','reject')),
        reason TEXT NOT NULL,
        reason_source TEXT NOT NULL CHECK (reason_source IN ('hand','report','rule','ml','default')),
        computed_at INTEGER NOT NULL,
        model_version TEXT, threshold_v INTEGER
      );
      CREATE TABLE reports (
        report_id INTEGER PRIMARY KEY AUTOINCREMENT,
        image_id TEXT NOT NULL REFERENCES images(image_id) ON DELETE CASCADE,
        category TEXT NOT NULL,
        reported_at INTEGER NOT NULL,
        resolved_at INTEGER
      );
      CREATE TABLE detections (
        image_id TEXT PRIMARY KEY REFERENCES images(image_id) ON DELETE CASCADE,
        variant TEXT NOT NULL,
        suggested_labels TEXT,
        gate TEXT,
        has_bbox INTEGER NOT NULL DEFAULT 0,
        bbox_x REAL, bbox_y REAL, bbox_w REAL, bbox_h REAL,
        mask_area_ratio REAL, lab_delta_e REAL
      );
    """)
    conn.commit()
    conn.close()

    out_dir = tmp_path / "models" / "mask_blur_unusable"
    train_label(label="mask_blur_unusable", parquet_path=parquet_path,
                db_path=db_path, out_dir=out_dir, random_state=42)
    # Clear hand labels so the gate's ML tier can actually fire (hand pre-empts
    # ML in recompute_for_image). Training is already done; predict only needs
    # the parquet features + model.
    conn = sqlite3.connect(db_path)
    conn.execute("DELETE FROM image_labels")
    conn.commit()
    conn.close()
    predict_labels_batched(
        labels=["mask_blur_unusable"], parquet_path=parquet_path,
        models_dir=tmp_path / "models", db_path=db_path,
    )

    conn = sqlite3.connect(db_path)
    n_preds = conn.execute("SELECT COUNT(*) FROM predictions").fetchone()[0]
    n_gates = conn.execute("SELECT COUNT(*) FROM gate_decisions").fetchone()[0]
    n_ml_rejects = conn.execute(
        "SELECT COUNT(*) FROM gate_decisions WHERE reason_source='ml' AND decision='reject'"
    ).fetchone()[0]
    conn.close()
    assert n_preds == 80
    assert n_gates >= 1
    assert n_ml_rejects > 0, "ML tier should have fired for at least some images"
