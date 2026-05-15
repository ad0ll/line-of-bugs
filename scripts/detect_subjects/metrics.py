"""Geometric and mask-based metrics on detections."""
from __future__ import annotations
import math


def bbox_area_ratio_normalized(bbox_w: float, bbox_h: float) -> float:
    """Fraction of total image area covered by the bbox."""
    return float(bbox_w * bbox_h)


def offcenter_normalized(bbox_x: float, bbox_y: float,
                         bbox_w: float, bbox_h: float) -> float:
    """Distance from bbox center to image center, normalized by half-diagonal."""
    cx = bbox_x + bbox_w / 2.0
    cy = bbox_y + bbox_h / 2.0
    distance = math.sqrt((cx - 0.5) ** 2 + (cy - 0.5) ** 2)
    half_diagonal = math.sqrt(0.5)
    return float(distance / half_diagonal)


def iou_xywh_normalized(
    a: tuple[float, float, float, float],
    b: tuple[float, float, float, float],
) -> float:
    """IoU of two normalized boxes given as (x, y, w, h)."""
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    ax2, ay2 = ax + aw, ay + ah
    bx2, by2 = bx + bw, by + bh
    ix1, iy1 = max(ax, bx), max(ay, by)
    ix2, iy2 = min(ax2, bx2), min(ay2, by2)
    iw, ih = max(0.0, ix2 - ix1), max(0.0, iy2 - iy1)
    inter = iw * ih
    if inter == 0:
        return 0.0
    union = aw * ah + bw * bh - inter
    if union <= 0:
        return 0.0
    return float(min(1.0, inter / union))


# ─── Mask-based metrics (Task 10) ─────────────────────────────────
import numpy as np
from skimage.color import rgb2lab
from skimage.filters import sobel
from skimage.segmentation import find_boundaries


def lab_delta_e_mask_vs_background(rgb: np.ndarray, mask: np.ndarray) -> float:
    """Mean LAB ΔE between pixels inside the mask vs outside."""
    if rgb.dtype != np.uint8:
        rgb = rgb.astype(np.uint8)
    inside = mask
    outside = ~mask
    if not inside.any() or not outside.any():
        return 0.0
    lab = rgb2lab(rgb / 255.0)
    mean_in = lab[inside].mean(axis=0)
    mean_out = lab[outside].mean(axis=0)
    return float(np.linalg.norm(mean_in - mean_out))


def boundary_sharpness(rgb: np.ndarray, mask: np.ndarray) -> float:
    """Mean Sobel gradient magnitude along the mask boundary."""
    if not mask.any():
        return 0.0
    gray = (0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2])
    gray = gray.astype(np.float32) / 255.0
    grad = sobel(gray)
    boundary = find_boundaries(mask, mode="outer")
    if not boundary.any():
        return 0.0
    return float(grad[boundary].mean() * 100.0)
