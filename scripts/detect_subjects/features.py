"""Pure feature computation helpers.

All functions in this module are pure — they take primitive inputs (numbers,
tuples, numpy arrays) and return primitive outputs (numbers, dicts). They do
not depend on PyTorch, model objects, or I/O.

Extracted from the inline computations in pipeline.py during the Phase 1 refactor
so they can be tested in isolation and reused across pipeline variants.
"""
from __future__ import annotations
from typing import Optional

from scripts.detect_subjects.config import BBOX_EDGE_TOLERANCE_NORMALIZED
from scripts.detect_subjects.metrics import (
    bbox_area_ratio_normalized,
    offcenter_normalized,
)


def compute_geometric_features(
    bbox_xywh_normalized: Optional[tuple[float, float, float, float]],
    img_w: int, img_h: int,
) -> dict:
    """Compute bbox-derived scalar features.

    Returns a dict with keys (all None when bbox is None):
      bbox_area_ratio   — bbox area / image area (0..1)
      offcenter         — distance from bbox center to image center (normalized)
      bbox_min_edge_px  — min(bbox_w_px, bbox_h_px), absolute pixels
      bbox_long_edge_px — max(bbox_w_px, bbox_h_px), absolute pixels
      bbox_touches_edge — True if any bbox edge is within BBOX_EDGE_TOLERANCE_NORMALIZED of the image edge
    """
    if bbox_xywh_normalized is None:
        return {
            "bbox_area_ratio": None,
            "offcenter": None,
            "bbox_min_edge_px": None,
            "bbox_long_edge_px": None,
            "bbox_touches_edge": None,
        }
    bx, by, bw, bh = bbox_xywh_normalized
    return {
        "bbox_area_ratio": bbox_area_ratio_normalized(bw, bh),
        "offcenter": offcenter_normalized(bx, by, bw, bh),
        "bbox_min_edge_px": float(min(bw * img_w, bh * img_h)),
        "bbox_long_edge_px": float(max(bw * img_w, bh * img_h)),
        "bbox_touches_edge": bool(
            bx < BBOX_EDGE_TOLERANCE_NORMALIZED
            or by < BBOX_EDGE_TOLERANCE_NORMALIZED
            or (bx + bw) > (1.0 - BBOX_EDGE_TOLERANCE_NORMALIZED)
            or (by + bh) > (1.0 - BBOX_EDGE_TOLERANCE_NORMALIZED)
        ),
    }
