"""Compute the set of labels that describe a detection.

Returns a LIST of labels — an image can have multiple (e.g., multi-bug + bug-too-small).
classify_framing() derives a single "primary" label for backward-compat / stats:
priority order is no-bug > bug-too-small > multi-bug > poor-contrast > subject-clipped
> cropped-good > original-good.

Label vocab (hyphenated — matches the user-facing flag buttons):
  no-bug, bug-too-small, multi-bug, poor-contrast, subject-clipped
  original-good, cropped-good

Note: subject-blurred is NOT auto-suggested. Laplacian variance is unreliable
on uniform-textured bugs; users flag manually via the validator UI.
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

# Priority order for deriving a single primary label from a multi-label set.
_PRIORITY = [
    "no-bug",
    "bug-too-small",
    "multi-bug",
    "poor-contrast",
    "subject-clipped",
    "cropped-good",
    "original-good",
]


def suggest_labels(
    confidence: Optional[float],
    bbox_area_ratio: Optional[float],
    bbox_long_edge_px: Optional[float],
    n_distinct_detections: int,
    mask_area_ratio: Optional[float],
    lab_delta_e: Optional[float],
    bbox_touches_edge: Optional[bool],
) -> list[str]:
    """Return the list of label names that describe this image."""
    # No detection or low confidence — nothing else makes sense without a bbox.
    if confidence is None or bbox_area_ratio is None or confidence < CLASSIFY_HIDDEN_CONF:
        return ["no-bug"]

    out: list[str] = []
    if bbox_area_ratio < CLASSIFY_HIDDEN_AREA:
        out.append("bug-too-small")
    elif bbox_long_edge_px is not None and bbox_long_edge_px < CLASSIFY_BUG_TOO_SMALL_EDGE_PX:
        out.append("bug-too-small")
    if n_distinct_detections >= 2:
        out.append("multi-bug")
    if (mask_area_ratio is not None and lab_delta_e is not None
            and lab_delta_e < CLASSIFY_CAMOUFLAGED_DELTA):
        out.append("poor-contrast")
    if bbox_touches_edge:
        out.append("subject-clipped")

    # No problems → positive label based on whether the bbox would benefit from a crop.
    if not out:
        if bbox_area_ratio < CLASSIFY_WIDE_AREA:
            out.append("cropped-good")
        else:
            out.append("original-good")
    return out


def primary_label(labels: list[str]) -> str:
    """Pick the highest-priority label for badge / stats use."""
    for p in _PRIORITY:
        if p in labels:
            return p
    return labels[0] if labels else "no-bug"


# Backward-compat wrapper. Returns the underscored variant of the primary label
# (matching the legacy framing_quality vocab: good, tight, wide, no_bug,
# bug_too_small, multi_bug, poor_contrast). Note: subject-clipped maps to
# bug_too_small for compat since the legacy schema has no clipped category;
# cropped-good maps to wide; original-good maps to good.
_PRIMARY_TO_FRAMING = {
    "no-bug":          "no_bug",
    "bug-too-small":   "bug_too_small",
    "multi-bug":       "multi_bug",
    "poor-contrast":   "poor_contrast",
    "subject-clipped": "bug_too_small",  # closest legacy bucket
    "cropped-good":    "wide",
    "original-good":   "good",
}


def classify_framing(
    confidence: Optional[float],
    bbox_area_ratio: Optional[float],
    bbox_long_edge_px: Optional[float],
    n_distinct_detections: int,
    mask_area_ratio: Optional[float],
    lab_delta_e: Optional[float],
    bbox_touches_edge: Optional[bool] = None,
) -> str:
    """Single-label primary classification for backward compat / stats."""
    labels = suggest_labels(
        confidence=confidence,
        bbox_area_ratio=bbox_area_ratio,
        bbox_long_edge_px=bbox_long_edge_px,
        n_distinct_detections=n_distinct_detections,
        mask_area_ratio=mask_area_ratio,
        lab_delta_e=lab_delta_e,
        bbox_touches_edge=bbox_touches_edge,
    )
    prim = primary_label(labels)
    if prim == "original-good" and bbox_area_ratio is not None and bbox_area_ratio > 0.50:
        return "tight"  # finer-grained legacy bucket
    return _PRIMARY_TO_FRAMING.get(prim, "good")
