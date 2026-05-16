"""Tests for suggest_labels and primary_label / classify_framing."""
from __future__ import annotations

from scripts.detect_subjects.rule_labeler import suggest_labels, classify_framing, primary_label


def _row(**overrides):
    base = dict(
        confidence=0.80,
        bbox_area_ratio=0.30,
        bbox_long_edge_px=1200.0,
        n_distinct_detections=1,
        mask_area_ratio=0.25,
        lab_delta_e=25.0,
        bbox_touches_edge=False,
    )
    base.update(overrides)
    return base


# ─── single-label cases ───────────────────────────────────────────

def test_no_bug_when_no_detection():
    assert suggest_labels(**_row(confidence=None, bbox_area_ratio=None,
                                  n_distinct_detections=0)) == ["no-bug"]


def test_no_bug_when_low_confidence():
    assert suggest_labels(**_row(confidence=0.10)) == ["no-bug"]


def test_bug_too_small_when_long_edge_below_512px():
    assert "bug-too-small" in suggest_labels(**_row(bbox_long_edge_px=400.0))


def test_bug_too_small_when_area_below_2pct():
    assert "bug-too-small" in suggest_labels(**_row(bbox_area_ratio=0.01))


def test_multi_bug_when_two_detections():
    out = suggest_labels(**_row(n_distinct_detections=2))
    assert "multi-bug" in out


def test_poor_contrast_when_low_delta_e():
    assert "poor-contrast" in suggest_labels(**_row(lab_delta_e=5.0))


def test_poor_contrast_only_when_mask_present():
    out = suggest_labels(**_row(mask_area_ratio=None, lab_delta_e=5.0))
    assert "poor-contrast" not in out


def test_subject_clipped_when_bbox_touches_edge():
    assert "subject-clipped" in suggest_labels(**_row(bbox_touches_edge=True))


def test_original_good_when_well_framed_no_problems():
    assert suggest_labels(**_row(bbox_area_ratio=0.30)) == ["original-good"]


def test_cropped_good_when_small_no_problems():
    assert suggest_labels(**_row(bbox_area_ratio=0.10,
                                  bbox_long_edge_px=800)) == ["cropped-good"]


# ─── multi-label cases (the new behaviour) ────────────────────────

def test_multi_bug_AND_bug_too_small():
    out = suggest_labels(**_row(n_distinct_detections=3,
                                 bbox_area_ratio=0.01))
    assert "bug-too-small" in out
    assert "multi-bug" in out


def test_three_problems_simultaneously():
    out = suggest_labels(**_row(
        bbox_area_ratio=0.01,
        n_distinct_detections=2,
        lab_delta_e=5.0,
    ))
    assert set(out) >= {"bug-too-small", "multi-bug", "poor-contrast"}


def test_positive_label_NOT_added_when_problems_exist():
    out = suggest_labels(**_row(n_distinct_detections=2,
                                 bbox_area_ratio=0.10))
    assert "original-good" not in out
    assert "cropped-good" not in out


# ─── primary_label + classify_framing legacy ──────────────────────

def test_primary_label_priority_order():
    assert primary_label(["multi-bug", "bug-too-small"]) == "bug-too-small"
    assert primary_label(["original-good"]) == "original-good"
    assert primary_label(["no-bug"]) == "no-bug"
    assert primary_label(["multi-bug", "no-bug"]) == "no-bug"


def test_classify_framing_legacy_vocab():
    assert classify_framing(**_row(confidence=None,
                                    bbox_area_ratio=None,
                                    n_distinct_detections=0)) == "no_bug"
    assert classify_framing(**_row(bbox_area_ratio=0.01)) == "bug_too_small"
    assert classify_framing(**_row(n_distinct_detections=3)) == "multi_bug"
    assert classify_framing(**_row(bbox_area_ratio=0.10,
                                    bbox_long_edge_px=800)) == "wide"
    assert classify_framing(**_row(bbox_area_ratio=0.65)) == "tight"
    assert classify_framing(**_row(bbox_area_ratio=0.30)) == "good"
