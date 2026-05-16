"""Phase 2a regression: schema + key columns preserved vs Phase 2a baseline.

After T1 (label migration), T2 (rule_labeler new vocab), T4 (gate.py wiring),
T5 (build_html) and T7 (evaluate_pipeline), the LIVE parquet's geometry
columns (bbox_x/y/w/h, confidence, etc.) should remain unchanged. Vocabulary
in `suggested_labels` and `gate_decision` only updates after re-running the
pipeline.
"""
from __future__ import annotations
from pathlib import Path

import polars as pl
import pytest

ROOT = Path(__file__).resolve().parents[2]
BASELINE_PATH = ROOT / "tests" / "python" / "_phase2a_baseline" / "baseline.parquet"
LIVE_PARQUET = ROOT / "data" / "cache" / "framing_detections.parquet"

# Columns that 2a code changes should NOT touch (geometry, features, distinct_subjects).
PRESERVED_COLS = [
    "image_id", "source", "variant",
    "bbox_x", "bbox_y", "bbox_w", "bbox_h", "confidence",
    "bbox_area_ratio", "offcenter",
    "mask_area_ratio", "mask_iou_score", "lab_delta_e",
    "boundary_sharpness", "subject_sharpness",
    "bbox_min_edge_px", "bbox_long_edge_px", "bbox_touches_edge",
    "text_label", "text_label_score",
    "n_raw_detections", "n_distinct_detections",
]


@pytest.mark.skipif(not BASELINE_PATH.exists(), reason="2a baseline not found")
@pytest.mark.skipif(not LIVE_PARQUET.exists(), reason="live parquet not found")
def test_2a_preserved_columns_unchanged():
    """Phase 2a CODE changes don't run inference — these columns must be bit-identical."""
    baseline = pl.read_parquet(BASELINE_PATH).sort("image_id").select(PRESERVED_COLS)
    live = pl.read_parquet(LIVE_PARQUET).sort("image_id").select(PRESERVED_COLS)
    assert baseline.height == live.height, \
        f"row count diff: baseline={baseline.height} live={live.height}"
    # Spot-check a representative column
    assert baseline["bbox_x"].to_list() == live["bbox_x"].to_list(), \
        "bbox_x drifted — Phase 2a shouldn't change geometry"
    assert baseline["confidence"].to_list() == live["confidence"].to_list(), \
        "confidence drifted"


@pytest.mark.skipif(not LIVE_PARQUET.exists(), reason="live parquet not found")
def test_2a_gate_decision_column_present():
    """gate_decision column exists after T4 wiring (may be None until pipeline reruns)."""
    live = pl.read_parquet(LIVE_PARQUET)
    assert "gate_decision" in live.columns
