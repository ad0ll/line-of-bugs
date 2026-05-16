"""Phase 2-prep regression smoke test.

Compares preserved columns in the live parquet against the baseline snapshot
captured at the start of Phase 2-prep. Columns that pre-work must NOT change
are compared row-by-row (after sorting by image_id).

UNCHANGED columns (asserted):
    bbox_x, bbox_y, bbox_w, bbox_h, confidence, bbox_area_ratio, offcenter,
    mask_area_ratio, mask_iou_score, lab_delta_e, boundary_sharpness,
    subject_sharpness, bbox_min_edge_px, bbox_long_edge_px, bbox_touches_edge,
    crop_x, crop_y, crop_w, crop_h, post_crop_subject_area, framing_quality,
    suggested_labels, n_raw_detections, n_distinct_detections

EXPECTED to change (NOT asserted):
    variant         - re-tagged v1_dino_insectsam → grounding_dino__insectsam (T6)
    text_label, text_label_score, distinct_subjects, gate_decision - new fields (T1/T3/T4)
"""
from __future__ import annotations
from pathlib import Path

import polars as pl
import pytest

ROOT = Path(__file__).resolve().parents[2]
BASELINE_PATH = ROOT / "tests" / "python" / "_phase2_baseline" / "baseline.parquet"
LIVE_PARQUET = ROOT / "data" / "cache" / "framing_detections.parquet"

PRESERVED_COLS = [
    "bbox_x", "bbox_y", "bbox_w", "bbox_h", "confidence",
    "bbox_area_ratio", "offcenter",
    "mask_area_ratio", "mask_iou_score", "lab_delta_e",
    "boundary_sharpness", "subject_sharpness",
    "bbox_min_edge_px", "bbox_long_edge_px", "bbox_touches_edge",
    "crop_x", "crop_y", "crop_w", "crop_h", "post_crop_subject_area",
    "framing_quality", "suggested_labels",
    "n_raw_detections", "n_distinct_detections",
]


@pytest.mark.skipif(not BASELINE_PATH.exists(), reason="baseline parquet not found")
@pytest.mark.skipif(not LIVE_PARQUET.exists(), reason="live parquet not found")
def test_preserved_columns_unchanged():
    """Core detection geometry/feature columns must be bit-identical after pre-work."""
    baseline = (
        pl.read_parquet(BASELINE_PATH)
        .sort("image_id")
        .select(["image_id"] + PRESERVED_COLS)
    )
    live = (
        pl.read_parquet(LIVE_PARQUET)
        .sort("image_id")
        .select(["image_id"] + PRESERVED_COLS)
    )

    assert baseline.height == live.height, \
        f"Row count mismatch: baseline={baseline.height}, live={live.height}"

    baseline_ids = set(baseline["image_id"].to_list())
    live_ids = set(live["image_id"].to_list())
    assert baseline_ids == live_ids, \
        f"image_id sets differ: added={live_ids - baseline_ids}, removed={baseline_ids - live_ids}"

    failures: list[str] = []
    for col in PRESERVED_COLS:
        b_vals = baseline[col].to_list()
        l_vals = live[col].to_list()
        mismatches = []
        for i, (bv, lv) in enumerate(zip(b_vals, l_vals)):
            if bv != lv:
                if isinstance(bv, float) and isinstance(lv, float):
                    if abs(bv - lv) > 1e-5:
                        mismatches.append(
                            f"  row {i} image_id={baseline['image_id'][i]}: "
                            f"baseline={bv}, live={lv}"
                        )
                elif isinstance(bv, list) and isinstance(lv, list):
                    if bv != lv:
                        mismatches.append(
                            f"  row {i} image_id={baseline['image_id'][i]}: "
                            f"baseline={bv}, live={lv}"
                        )
                else:
                    mismatches.append(
                        f"  row {i} image_id={baseline['image_id'][i]}: "
                        f"baseline={bv!r}, live={lv!r}"
                    )
        if mismatches:
            failures.append(
                f"Column '{col}' has {len(mismatches)} mismatches:\n"
                + "\n".join(mismatches[:5])
                + (f"\n  ... and {len(mismatches)-5} more" if len(mismatches) > 5 else "")
            )

    assert not failures, "Preserved columns differ from baseline:\n\n" + "\n\n".join(failures)


@pytest.mark.skipif(not LIVE_PARQUET.exists(), reason="live parquet not found")
def test_phase2_columns_present_in_live_parquet():
    """Phase 2 additions must be present in the live parquet after pre-work."""
    live = pl.read_parquet(LIVE_PARQUET)
    for col in ("text_label", "text_label_score", "gate_decision", "distinct_subjects"):
        assert col in live.columns, f"Phase 2 column missing from live parquet: {col}"


@pytest.mark.skipif(not LIVE_PARQUET.exists(), reason="live parquet not found")
def test_variant_re_tagged_in_live_parquet():
    """All rows should now use grounding_dino__insectsam variant tag."""
    live = pl.read_parquet(LIVE_PARQUET)
    variants = live["variant"].unique().to_list()
    assert "v1_dino_insectsam" not in variants, f"Old variant tag still present: {variants}"
    assert "grounding_dino__insectsam" in variants, f"New variant tag not present: {variants}"
