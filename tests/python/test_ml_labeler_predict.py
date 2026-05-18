"""Verify batch predict writes probability columns to parquet."""
import json
from pathlib import Path
import numpy as np
import polars as pl

def _setup(tmp_path: Path):
    # Re-use the fake parquet + labels generator from test_ml_labeler_train.py
    from tests.python.test_ml_labeler_train import _fake_parquet_and_labels
    from scripts.detect_subjects.ml_labeler.train import train_label
    parquet_path, labels_path = _fake_parquet_and_labels(tmp_path)
    out_dir = tmp_path / "models" / "mask_blur_unusable"
    train_label("mask_blur_unusable", parquet_path, labels_path, out_dir, random_state=42)
    return parquet_path, out_dir

def test_predict_writes_columns(tmp_path):
    from scripts.detect_subjects.ml_labeler.predict import predict_label_into_parquet
    parquet_path, model_dir = _setup(tmp_path)
    n_updated = predict_label_into_parquet(
        label="mask_blur_unusable",
        parquet_path=parquet_path,
        model_path=model_dir / "arm_scalar_latest.joblib",
    )
    assert n_updated == 80
    df = pl.read_parquet(parquet_path)
    assert "predicted_mask_blur_unusable_p" in df.columns
    assert "predicted_mask_blur_unusable_unreliable" in df.columns
    probs = df["predicted_mask_blur_unusable_p"].to_numpy()
    assert (probs >= 0).all() and (probs <= 1).all()
    # First 40 are positives — mean prob should be higher than last 40
    assert probs[:40].mean() > probs[40:].mean()
