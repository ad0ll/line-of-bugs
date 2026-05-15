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
