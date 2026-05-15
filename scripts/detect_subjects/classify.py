"""Map detection metrics to a framing_quality category."""
from __future__ import annotations
from typing import Optional

from scripts.detect_subjects.config import (
    CLASSIFY_HIDDEN_CONF,
    CLASSIFY_HIDDEN_AREA,
    CLASSIFY_WIDE_AREA,
    CLASSIFY_TIGHT_AREA,
    CLASSIFY_CAMOUFLAGED_DELTA,
)


def classify_framing(
    confidence: Optional[float],
    bbox_area_ratio: Optional[float],
    n_distinct_detections: int,
    mask_area_ratio: Optional[float],
    lab_delta_e: Optional[float],
) -> str:
    """Returns one of: 'good' | 'tight' | 'wide' | 'hidden' | 'multi_bug' | 'camouflaged'."""
    if confidence is None or bbox_area_ratio is None:
        return "hidden"
    if confidence < CLASSIFY_HIDDEN_CONF or bbox_area_ratio < CLASSIFY_HIDDEN_AREA:
        return "hidden"
    if n_distinct_detections >= 2:
        return "multi_bug"
    if mask_area_ratio is not None and lab_delta_e is not None \
            and lab_delta_e < CLASSIFY_CAMOUFLAGED_DELTA:
        return "camouflaged"
    if bbox_area_ratio < CLASSIFY_WIDE_AREA:
        return "wide"
    if bbox_area_ratio > CLASSIFY_TIGHT_AREA:
        return "tight"
    return "good"
