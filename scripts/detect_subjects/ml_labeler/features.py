"""Scalar feature extraction for the ML labeler.

V1: 12 hand-engineered scalars already present in framing_detections.parquet.
Future: image-arm features (DINOv3 embeddings) go through a parallel module.
"""
from __future__ import annotations
import numpy as np

# Order matters — TabPFN trained columns must match prediction columns.
# These are all schema columns in framing_detections.parquet.
SCALAR_FEATURE_NAMES: list[str] = [
    "bbox_area_ratio",
    "offcenter",
    "bbox_min_edge_px",
    "bbox_long_edge_px",
    "mask_area_ratio",
    "lab_delta_e",
    "boundary_sharpness",
    "subject_sharpness",
    "top10pct_lap_mask",
    "edge_density_mask_vs_bg",
    "confidence",
    "n_distinct_detections",
]


def scalar_feature_vector(row: dict) -> np.ndarray:
    """Extract the 12-dim scalar feature vector from a polars-row dict.

    Missing/None values become NaN. TabPFN handles NaN natively; for sklearn
    consumers, downstream caller is responsible for imputation.
    """
    vals = []
    for name in SCALAR_FEATURE_NAMES:
        v = row.get(name)
        vals.append(float("nan") if v is None else float(v))
    return np.asarray(vals, dtype=np.float32)
