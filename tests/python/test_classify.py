"""Tests for framing_quality classification rules.

Categories returned by classify_framing():
  no_bug, bug_too_small, multi_bug, poor_contrast, wide, tight, good
"""
from __future__ import annotations

from scripts.detect_subjects.classify import classify_framing


def _row(**overrides):
    base = dict(
        confidence=0.80,
        bbox_area_ratio=0.30,
        bbox_min_edge_px=1200.0,  # well above the 512 floor
        n_distinct_detections=1,
        mask_area_ratio=0.25,
        lab_delta_e=25.0,
    )
    base.update(overrides)
    return base


def test_no_bug_when_no_detection():
    assert classify_framing(**_row(confidence=None, bbox_area_ratio=None,
                                    n_distinct_detections=0)) == "no_bug"


def test_no_bug_when_low_confidence():
    assert classify_framing(**_row(confidence=0.10)) == "no_bug"


def test_bug_too_small_when_tiny_area():
    assert classify_framing(**_row(bbox_area_ratio=0.01)) == "bug_too_small"


def test_bug_too_small_when_short_edge_below_512px():
    assert classify_framing(**_row(bbox_min_edge_px=400.0)) == "bug_too_small"


def test_multi_bug_when_two_detections():
    assert classify_framing(**_row(n_distinct_detections=2)) == "multi_bug"


def test_multi_bug_takes_priority_over_wide():
    assert classify_framing(**_row(n_distinct_detections=3,
                                    bbox_area_ratio=0.05,
                                    bbox_min_edge_px=600.0)) == "multi_bug"


def test_poor_contrast_when_low_delta_e():
    assert classify_framing(**_row(lab_delta_e=5.0)) == "poor_contrast"


def test_poor_contrast_only_when_mask_present():
    assert classify_framing(**_row(mask_area_ratio=None,
                                    lab_delta_e=5.0)) == "good"


def test_wide_when_small_bbox():
    assert classify_framing(**_row(bbox_area_ratio=0.10,
                                    bbox_min_edge_px=600.0)) == "wide"


def test_tight_when_large_bbox():
    assert classify_framing(**_row(bbox_area_ratio=0.65)) == "tight"


def test_good_when_normal():
    assert classify_framing(**_row(bbox_area_ratio=0.30)) == "good"


def test_bug_too_small_takes_priority_over_multi_bug():
    # If the bug is tiny we don't care that there are multiple — reject as too-small.
    assert classify_framing(**_row(bbox_area_ratio=0.01,
                                    n_distinct_detections=3)) == "bug_too_small"
