"""Compute the set of labels that describe a detection.

New label vocabulary (4-column, Phase 2a):
  Column 2 -- BBox Content (amber):
    bbox-content_no-bug                     (no detection or low confidence)
    bbox-content_single                     (one bug in bbox, no size/count problems)
    bbox-content_bbox-multibug_unusable     (>=2 bug centers inside primary bbox)
    bbox-content_subject-too-small          (bbox_long_edge_px < 512 or area tiny)
    bbox-content_image-multi-bug            (informational: >=2 distinct in image)
  Column 3 -- Mask Rule (sky-blue):
    mask_poor-contrast                      (lab_delta_e < threshold)

Column 1 (bbox_*) is human-set only.
Column 4 (ml_*) is human-set only in Phase 2a.

Mask blur labels are NOT auto-suggested. Laplacian variance is unreliable on
uniform-textured bugs; users flag manually via the validator UI.
"""
from __future__ import annotations
from typing import Optional

from scripts.detect_subjects.config import (
    CLASSIFY_HIDDEN_CONF,
    CLASSIFY_HIDDEN_AREA,
    CLASSIFY_WIDE_AREA,
    CLASSIFY_CAMOUFLAGED_DELTA,
    CLASSIFY_BUG_TOO_SMALL_EDGE_PX,
)


def count_bugs_in_primary_bbox(
    primary_bbox: tuple[float, float, float, float],
    all_high_conf_detections: list[tuple],
) -> int:
    """Count detections whose center falls inside primary_bbox (boundary inclusive).

    primary_bbox: (x, y, w, h) normalized coords.
    all_high_conf_detections: list of (x, y, w, h, conf, ...) tuples.

    Per parent spec §244-256: if count >= 2 → emit bbox-content_bbox-multibug_unusable.
    """
    px, py, pw, ph = primary_bbox
    count = 0
    for det in all_high_conf_detections:
        dx, dy, dw, dh = det[0], det[1], det[2], det[3]
        cx = dx + dw / 2.0
        cy = dy + dh / 2.0
        if px <= cx <= px + pw and py <= cy <= py + ph:
            count += 1
    return count


def suggest_labels(
    confidence: Optional[float],
    bbox_area_ratio: Optional[float],
    bbox_long_edge_px: Optional[float],
    n_distinct_detections: int,
    n_in_primary_bbox: int,
    mask_area_ratio: Optional[float],
    lab_delta_e: Optional[float],
    bbox_touches_edge: Optional[bool] = None,
) -> list[str]:
    """Return list of new-vocab Column 2 (bbox-content_*) and Column 3 (mask_*) labels."""
    if confidence is None or bbox_area_ratio is None or confidence < CLASSIFY_HIDDEN_CONF:
        return ["bbox-content_no-bug"]

    out: list[str] = []

    too_small = (
        bbox_area_ratio < CLASSIFY_HIDDEN_AREA
        or (bbox_long_edge_px is not None and bbox_long_edge_px < CLASSIFY_BUG_TOO_SMALL_EDGE_PX)
    )
    if too_small:
        out.append("bbox-content_subject-too-small")

    if n_in_primary_bbox >= 2:
        out.append("bbox-content_bbox-multibug_unusable")
    elif n_distinct_detections >= 2:
        out.append("bbox-content_image-multi-bug")

    has_content_rejection = any(
        lbl in out for lbl in (
            "bbox-content_no-bug",
            "bbox-content_bbox-multibug_unusable",
            "bbox-content_subject-too-small",
        )
    )
    if not has_content_rejection:
        out.append("bbox-content_single")

    if (mask_area_ratio is not None and lab_delta_e is not None
            and lab_delta_e < CLASSIFY_CAMOUFLAGED_DELTA):
        out.append("mask_poor-contrast")

    return out


def primary_label(labels: list[str]) -> str:
    """Pick the highest-priority label for badge / stats use."""
    priority = [
        "bbox-content_no-bug",
        "bbox-content_subject-too-small",
        "bbox-content_bbox-multibug_unusable",
        "mask_poor-contrast",
        "bbox-content_image-multi-bug",
        "bbox-content_single",
    ]
    for p in priority:
        if p in labels:
            return p
    return labels[0] if labels else "bbox-content_no-bug"


# Legacy framing_quality string — maps new primary label to old underscore enum.
# The framing_quality parquet column stays through Phase 2 (dropped in Phase 3).
_PRIMARY_TO_FRAMING = {
    "bbox-content_no-bug":                  "no_bug",
    "bbox-content_subject-too-small":        "bug_too_small",
    "bbox-content_bbox-multibug_unusable":   "multi_bug",
    "mask_poor-contrast":                    "poor_contrast",
    "bbox-content_image-multi-bug":          "good",
    "bbox-content_single":                   "good",
}


def classify_framing(
    confidence: Optional[float],
    bbox_area_ratio: Optional[float],
    bbox_long_edge_px: Optional[float],
    n_distinct_detections: int,
    mask_area_ratio: Optional[float],
    lab_delta_e: Optional[float],
    bbox_touches_edge: Optional[bool] = None,
    n_in_primary_bbox: int = 1,
) -> str:
    """Single-label primary classification for backward compat / stats.

    Returns legacy underscore strings (no_bug, bug_too_small, multi_bug,
    poor_contrast, wide, tight, good) stored in the framing_quality column.
    """
    labels = suggest_labels(
        confidence=confidence,
        bbox_area_ratio=bbox_area_ratio,
        bbox_long_edge_px=bbox_long_edge_px,
        n_distinct_detections=n_distinct_detections,
        n_in_primary_bbox=n_in_primary_bbox,
        mask_area_ratio=mask_area_ratio,
        lab_delta_e=lab_delta_e,
        bbox_touches_edge=bbox_touches_edge,
    )
    prim = primary_label(labels)
    if prim in ("bbox-content_single", "bbox-content_image-multi-bug"):
        if bbox_area_ratio is not None and bbox_area_ratio > 0.50:
            return "tight"
        if bbox_area_ratio is not None and bbox_area_ratio < CLASSIFY_WIDE_AREA:
            return "wide"
        return "good"
    return _PRIMARY_TO_FRAMING.get(prim, "good")
