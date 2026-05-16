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


import cv2
import numpy as np

from scripts.detect_subjects.metrics import (
    lab_delta_e_mask_vs_background,
    boundary_sharpness,
)


def compute_mask_features(mask, rgb) -> dict:
    """Compute mask-derived scalar features.

    Returns a dict with keys (None when mask is None/empty):
      mask_area_ratio    — fraction of image pixels inside mask
      lab_delta_e        — mean LAB color difference between mask interior and exterior
      boundary_sharpness — mean Sobel gradient magnitude along mask boundary
    """
    if mask is None:
        return {"mask_area_ratio": None, "lab_delta_e": None,
                "boundary_sharpness": None}
    if not mask.any():
        return {"mask_area_ratio": 0.0, "lab_delta_e": None,
                "boundary_sharpness": None}
    return {
        "mask_area_ratio": float(mask.sum()) / float(mask.size),
        "lab_delta_e": lab_delta_e_mask_vs_background(rgb, mask),
        "boundary_sharpness": boundary_sharpness(rgb, mask),
    }


def compute_subject_sharpness(rgb, bbox_xywh_normalized, img_w: int, img_h: int):
    """Laplacian variance over the bbox region. Higher = sharper.

    Returns None if no bbox or bbox is too small (< 4px in either dimension).
    Note: known unreliable on uniform-textured subjects (e.g., smooth bug bodies).
    Stored as a feature for ML labelers to use, not for hard rules.
    """
    if bbox_xywh_normalized is None or rgb is None:
        return None
    x, y, w, h = bbox_xywh_normalized
    x1 = int(x * img_w); y1 = int(y * img_h)
    x2 = int((x + w) * img_w); y2 = int((y + h) * img_h)
    if x2 - x1 < 5 or y2 - y1 < 5:
        return None
    crop = rgb[y1:y2, x1:x2]
    gray = cv2.cvtColor(crop, cv2.COLOR_RGB2GRAY)
    return float(cv2.Laplacian(gray, cv2.CV_64F).var())
