"""Map detection metrics to a framing_quality category.

Classes returned:
  no_bug         — no detection or low confidence (model couldn't find a bug)
  bug_too_small  — found a bug, but its absolute size in pixels makes it
                   unusable for gesture drawing (even after auto-crop)
  multi_bug      — 2+ distinct detections after NMS
  poor_contrast  — subject/background LAB ΔE below threshold (formerly 'camouflaged')
  wide           — bbox area < 20% of frame; candidate for auto-crop
  tight          — bbox area > 50%; already fills the frame
  good           — none of the above; well-framed as-is

NOT classified here (handled by user labels only):
  subject-blurred  — Laplacian variance is unreliable on uniform-textured bugs;
                     users flag this manually via the validator UI.
  subject-clipped  — derived from bbox_touches_edge; tagged as a property, not
                     a top-level class (image can be wide AND clipped).
"""
from __future__ import annotations
from typing import Optional

from scripts.detect_subjects.config import (
    CLASSIFY_HIDDEN_CONF,
    CLASSIFY_HIDDEN_AREA,
    CLASSIFY_WIDE_AREA,
    CLASSIFY_TIGHT_AREA,
    CLASSIFY_CAMOUFLAGED_DELTA,
    CLASSIFY_BUG_TOO_SMALL_EDGE_PX,
)


def classify_framing(
    confidence: Optional[float],
    bbox_area_ratio: Optional[float],
    bbox_min_edge_px: Optional[float],
    n_distinct_detections: int,
    mask_area_ratio: Optional[float],
    lab_delta_e: Optional[float],
) -> str:
    """Returns one of: good | tight | wide | no_bug | bug_too_small | multi_bug | poor_contrast."""
    # No detection at all OR detector wasn't confident enough.
    if confidence is None or bbox_area_ratio is None or confidence < CLASSIFY_HIDDEN_CONF:
        return "no_bug"
    # We found a bug, but it's tiny — by frame fraction or by absolute pixels.
    if bbox_area_ratio < CLASSIFY_HIDDEN_AREA:
        return "bug_too_small"
    if bbox_min_edge_px is not None and bbox_min_edge_px < CLASSIFY_BUG_TOO_SMALL_EDGE_PX:
        return "bug_too_small"
    # Multiple distinct detections.
    if n_distinct_detections >= 2:
        return "multi_bug"
    # Mask-based contrast check.
    if mask_area_ratio is not None and lab_delta_e is not None \
            and lab_delta_e < CLASSIFY_CAMOUFLAGED_DELTA:
        return "poor_contrast"
    # Framing by bbox area.
    if bbox_area_ratio < CLASSIFY_WIDE_AREA:
        return "wide"
    if bbox_area_ratio > CLASSIFY_TIGHT_AREA:
        return "tight"
    return "good"
