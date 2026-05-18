"""Verify training script persists a fitted classifier with metrics."""
import json
from pathlib import Path
import numpy as np
import polars as pl


def _fake_parquet_and_labels(tmpdir: Path):
    """Build a tiny synthetic parquet + labels.json with blur_unusable positives."""
    rng = np.random.default_rng(0)
    n = 80
    image_ids = [f"img-{i:03d}" for i in range(n)]
    # Make subject_sharpness predictive: positives have low sharpness
    sharpness = rng.uniform(100, 500, n)
    # First 40 are positives (blur_unusable) with lower sharpness
    sharpness[:40] -= 200
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
    })
    parquet_path = tmpdir / "test.parquet"
    df.write_parquet(parquet_path)
    labels = {}
    for i, iid in enumerate(image_ids):
        labels[iid] = {
            "col1": "bbox_correct-subject_not-clipped",
            "col2_count": "bbox-content_single",
            "col2_flags": [], "col4": [],
            "col3": ["mask_blur_unusable"] if i < 40 else [],
            "reviewed_at": 1, "user_edited": True,
            "variant_tag": "sam3__sam3", "unsure": False,
        }
    labels_path = tmpdir / "labels.json"
    labels_path.write_text(json.dumps(labels))
    return parquet_path, labels_path


def test_train_blur_unusable_persists_model_and_metrics(tmp_path):
    from scripts.detect_subjects.ml_labeler.train import train_label
    parquet_path, labels_path = _fake_parquet_and_labels(tmp_path)
    out_dir = tmp_path / "models" / "mask_blur_unusable"
    metrics = train_label(
        label="mask_blur_unusable",
        parquet_path=parquet_path, labels_path=labels_path,
        out_dir=out_dir, random_state=42,
    )
    assert (out_dir / "arm_scalar_latest.joblib").exists()
    assert (out_dir / "metrics.json").exists()
    assert metrics["arm_scalar"]["mcc_mean"] > 0.3  # easy synthetic task
    assert metrics["n_positives"] == 40
    assert metrics["n_total"] == 80
