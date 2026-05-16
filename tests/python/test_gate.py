"""Tests for the drawability gate."""
from __future__ import annotations

from scripts.detect_subjects.gate import (
    decide_drawability, GateDecision,
)


def _empty_label_record():
    return {
        "bbox": "bbox_correct-subject_not-clipped",
        "bbox_content_count": "bbox-content_single",
        "bbox_too_small": False,
        "mask_labels": [],         # selected mask_* labels
        "ml_labels": [],           # selected ml_* labels
    }


def test_default_labels_keep():
    """All four columns at their 'good' default → keep."""
    decision = decide_drawability(_empty_label_record())
    assert decision == GateDecision.KEEP


def test_bbox_wrong_rejects():
    rec = _empty_label_record()
    rec["bbox"] = "bbox_wrong-subject"
    assert decide_drawability(rec) == GateDecision.REJECT


def test_bbox_clipped_rejects():
    rec = _empty_label_record()
    rec["bbox"] = "bbox_correct-subject_clipped"
    assert decide_drawability(rec) == GateDecision.REJECT


def test_no_bug_rejects():
    rec = _empty_label_record()
    rec["bbox_content_count"] = "bbox-content_no-bug"
    assert decide_drawability(rec) == GateDecision.REJECT


def test_multibug_unusable_rejects():
    rec = _empty_label_record()
    rec["bbox_content_count"] = "bbox-content_bbox-multibug_unusable"
    assert decide_drawability(rec) == GateDecision.REJECT


def test_multibug_usable_also_rejects():
    """Soft-reject still rejects today; preserves analytics signal."""
    rec = _empty_label_record()
    rec["bbox_content_count"] = "bbox-content_bbox-multibug_usable"
    assert decide_drawability(rec) == GateDecision.REJECT


def test_too_small_rejects():
    rec = _empty_label_record()
    rec["bbox_too_small"] = True
    assert decide_drawability(rec) == GateDecision.REJECT


def test_mask_rejection_rejects():
    rec = _empty_label_record()
    rec["mask_labels"] = ["mask_blur_unusable"]
    assert decide_drawability(rec) == GateDecision.REJECT


def test_mask_blur_usable_also_rejects():
    rec = _empty_label_record()
    rec["mask_labels"] = ["mask_blur_usable"]
    assert decide_drawability(rec) == GateDecision.REJECT


def test_ml_label_other_bad_rejects():
    rec = _empty_label_record()
    rec["ml_labels"] = ["ml_other-bad"]
    assert decide_drawability(rec) == GateDecision.REJECT


def test_image_multi_bug_is_informational_only():
    """bbox-content_image-multi-bug is NOT a gate signal."""
    rec = _empty_label_record()
    rec["bbox_content_image_multi_bug"] = True  # informational flag
    assert decide_drawability(rec) == GateDecision.KEEP
