"""Tests for suggest_labels (new 4-column vocabulary) and classify_framing (legacy compat)."""
from __future__ import annotations

from scripts.detect_subjects.rule_labeler import suggest_labels, classify_framing, primary_label


def _row(**overrides):
    base = dict(
        confidence=0.80,
        bbox_area_ratio=0.30,
        bbox_long_edge_px=1200.0,
        n_distinct_detections=1,
        n_in_primary_bbox=1,
        mask_area_ratio=0.25,
        lab_delta_e=25.0,
        bbox_touches_edge=False,
    )
    base.update(overrides)
    return base


def test_no_bug_when_no_detection():
    out = suggest_labels(**_row(confidence=None, bbox_area_ratio=None,
                                n_distinct_detections=0, n_in_primary_bbox=0))
    assert "bbox-content_no-bug" in out


def test_no_bug_when_low_confidence():
    out = suggest_labels(**_row(confidence=0.04))
    assert "bbox-content_no-bug" in out


def test_bug_too_small_when_long_edge_below_512px():
    out = suggest_labels(**_row(bbox_long_edge_px=400.0))
    assert "bbox-content_subject-too-small" in out


def test_bug_too_small_when_area_below_threshold():
    out = suggest_labels(**_row(bbox_area_ratio=0.01))
    assert "bbox-content_subject-too-small" in out


def test_multibug_in_bbox_unusable_when_two_in_primary():
    out = suggest_labels(**_row(n_in_primary_bbox=2))
    assert "bbox-content_bbox-multibug_unusable" in out


def test_multibug_in_bbox_unusable_when_three_in_primary():
    out = suggest_labels(**_row(n_in_primary_bbox=3))
    assert "bbox-content_bbox-multibug_unusable" in out


def test_image_multibug_informational_when_two_distinct():
    out = suggest_labels(**_row(n_distinct_detections=2, n_in_primary_bbox=1))
    assert "bbox-content_image-multi-bug" in out
    assert "bbox-content_bbox-multibug_unusable" not in out


def test_single_bug_no_content_problem():
    out = suggest_labels(**_row())
    assert "bbox-content_single" in out
    assert "bbox-content_no-bug" not in out
    assert "bbox-content_bbox-multibug_unusable" not in out


def test_poor_contrast_when_low_delta_e():
    out = suggest_labels(**_row(lab_delta_e=5.0))
    assert "mask_poor-contrast" in out


def test_poor_contrast_only_when_mask_present():
    out = suggest_labels(**_row(mask_area_ratio=None, lab_delta_e=5.0))
    assert "mask_poor-contrast" not in out


OLD_VOCAB = {
    "no-bug", "bug-too-small", "multi-bug", "poor-contrast",
    "subject-clipped", "cropped-good", "original-good",
}


def test_no_old_vocab_strings_in_output():
    rows = [
        _row(),
        _row(confidence=None, bbox_area_ratio=None, n_distinct_detections=0, n_in_primary_bbox=0),
        _row(bbox_long_edge_px=400.0),
        _row(n_in_primary_bbox=2),
        _row(n_distinct_detections=2, n_in_primary_bbox=1),
        _row(lab_delta_e=5.0),
        _row(bbox_area_ratio=0.01),
    ]
    for row in rows:
        out = suggest_labels(**row)
        leaked = set(out) & OLD_VOCAB
        assert not leaked, f"Old vocab leaked for row {row}: {leaked}"


def test_classify_framing_legacy_no_bug():
    assert classify_framing(**_row(confidence=None, bbox_area_ratio=None,
                                    n_distinct_detections=0)) == "no_bug"


def test_classify_framing_legacy_bug_too_small():
    assert classify_framing(**_row(bbox_area_ratio=0.01)) == "bug_too_small"


def test_classify_framing_legacy_wide():
    assert classify_framing(**_row(bbox_area_ratio=0.10, bbox_long_edge_px=800)) == "wide"


def test_classify_framing_legacy_tight():
    assert classify_framing(**_row(bbox_area_ratio=0.65)) == "tight"


def test_classify_framing_legacy_good():
    assert classify_framing(**_row(bbox_area_ratio=0.30)) == "good"
