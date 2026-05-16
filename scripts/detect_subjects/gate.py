"""Drawability gate — combines all label sources into one keep/reject decision.

Per the strict gate definition (modular pipeline design spec, 2026-05-15):
  Reject if ANY of:
    - §1 not bbox_correct-subject_not-clipped
    - §2 count != bbox-content_single, OR bbox-content_subject-too-small set
    - §3 any selection other than mask_good (including soft-reject _usable variants)
    - §4 any selection other than ml_good

  Keep otherwise. bbox-content_image-multi-bug is informational and does NOT
  contribute to the gate decision.
"""
from __future__ import annotations
from enum import Enum


class GateDecision(Enum):
    KEEP = "keep"
    REJECT = "reject"


_BBOX_GOOD = "bbox_correct-subject_not-clipped"
_BBOX_CONTENT_SINGLE = "bbox-content_single"


def decide_drawability(label_record: dict) -> GateDecision:
    """Return KEEP if all four columns at their 'good' default, REJECT otherwise.

    Expected label_record shape:
      {
        "bbox": str,                       # §1 — one of bbox_*
        "bbox_content_count": str,         # §2 count — one of bbox-content_*
        "bbox_too_small": bool,            # §2 independent flag
        "bbox_content_image_multi_bug": bool,  # §2 informational (NOT a gate signal)
        "mask_labels": list[str],          # §3 selections (any non-empty = reject)
        "ml_labels": list[str],            # §4 selections (any non-empty = reject)
      }
    """
    if label_record.get("bbox") != _BBOX_GOOD:
        return GateDecision.REJECT
    if label_record.get("bbox_content_count") != _BBOX_CONTENT_SINGLE:
        return GateDecision.REJECT
    if label_record.get("bbox_too_small"):
        return GateDecision.REJECT
    if label_record.get("mask_labels"):
        return GateDecision.REJECT
    if label_record.get("ml_labels"):
        return GateDecision.REJECT
    # image_multi_bug is informational; NOT checked.
    return GateDecision.KEEP
