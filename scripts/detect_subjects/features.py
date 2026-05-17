"""Pure feature computation helpers.

All functions in this module are pure — they take primitive inputs (numbers,
tuples, numpy arrays) and return primitive outputs (numbers, dicts). They do
not depend on PyTorch, model objects, or I/O.

Extracted from the inline computations in pipeline.py during the Phase 1 refactor
so they can be tested in isolation and reused across pipeline variants.
"""
from __future__ import annotations
from typing import Optional

import cv2
import numpy as np

from scripts.detect_subjects.config import BBOX_EDGE_TOLERANCE_NORMALIZED
from scripts.detect_subjects.metrics import (
    bbox_area_ratio_normalized,
    boundary_sharpness,
    lab_delta_e_mask_vs_background,
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


def compute_mask_features(
    mask: Optional[np.ndarray], rgb: Optional[np.ndarray],
) -> dict:
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


def compute_subject_sharpness(
    rgb: Optional[np.ndarray],
    bbox_xywh_normalized: Optional[tuple[float, float, float, float]],
    img_w: int, img_h: int,
    mask: Optional[np.ndarray] = None,
) -> Optional[float]:
    """Laplacian variance over the subject. Higher = sharper.

    When `mask` is provided (preferred): variance is computed ONLY over pixels
    where mask==True. This is empirically better at separating user-labeled
    blur_unusable from blur_ok (Youden-J 0.43 vs 0.37 for bbox-only) because
    blurred-DOF backgrounds inside the bbox no longer pollute the score.
    See experiments/blur_mask_features.py for the calibration. SCHEMA_VERSION
    bumped to 2 to mark this meaning change.

    When `mask` is None: falls back to bbox-region Laplacian variance (the
    old definition). Returned for callers that don't have a mask.

    Returns None if no bbox, bbox is too small (< 5px), or mask is empty.
    """
    if bbox_xywh_normalized is None or rgb is None:
        return None
    x, y, w, h = bbox_xywh_normalized
    x1 = int(x * img_w); y1 = int(y * img_h)
    x2 = int((x + w) * img_w); y2 = int((y + h) * img_h)
    if x2 - x1 < 5 or y2 - y1 < 5:
        return None
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    lap = cv2.Laplacian(gray, cv2.CV_64F)
    if mask is not None and mask.any():
        bbox_mask = mask[y1:y2, x1:x2] if mask.shape == gray.shape else None
        if bbox_mask is not None and bbox_mask.any():
            return float(lap[y1:y2, x1:x2][bbox_mask].var())
        if mask.any():
            return float(lap[mask].var())
    return float(lap[y1:y2, x1:x2].var())


def compute_top10pct_lap_masked(
    rgb: Optional[np.ndarray],
    mask: Optional[np.ndarray],
) -> Optional[float]:
    """Mean of the top-decile per-pixel |Laplacian| values within the mask.

    Captures "eyes/edges sharp even if body smooth" — handles uniform-textured
    insects (beetles, hornets) better than plain variance. Per the blur
    experiment, slightly stronger than variance (Youden-J 0.46 vs 0.43)
    though within noise at n=78.
    """
    if rgb is None or mask is None or not mask.any():
        return None
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    lap = np.abs(cv2.Laplacian(gray, cv2.CV_64F))
    vals = lap[mask]
    if vals.size < 10:
        return None
    k = max(1, vals.size // 10)
    return float(np.partition(vals, -k)[-k:].mean())


def compute_edge_density_mask_vs_bg(
    rgb: Optional[np.ndarray],
    mask: Optional[np.ndarray],
    bbox_xywh_normalized: Optional[tuple[float, float, float, float]],
    img_w: int, img_h: int,
) -> Optional[float]:
    """Canny edge density inside the mask divided by edge density of the
    bbox-background (pixels in bbox but outside mask). Values > 1 mean the
    subject is sharper than its surroundings — useful for distinguishing
    intentional shallow DOF (sharp subject, blurred bg) from genuine subject
    blur. None if either region is empty or too small.
    """
    if rgb is None or mask is None or bbox_xywh_normalized is None:
        return None
    x, y, w, h = bbox_xywh_normalized
    x1 = int(x * img_w); y1 = int(y * img_h)
    x2 = int((x + w) * img_w); y2 = int((y + h) * img_h)
    if x2 - x1 < 5 or y2 - y1 < 5:
        return None
    if mask.shape != rgb.shape[:2]:
        return None
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    edges = cv2.Canny(gray, 50, 150)
    bbox_crop = edges[y1:y2, x1:x2]
    bbox_mask = mask[y1:y2, x1:x2]
    inside = int(bbox_mask.sum())
    outside = int(bbox_crop.size - inside)
    if inside < 50 or outside < 50:
        return None
    inside_density = float(bbox_crop[bbox_mask].sum()) / inside
    outside_density = float(bbox_crop[~bbox_mask].sum()) / outside
    if outside_density == 0:
        return None
    return inside_density / outside_density
