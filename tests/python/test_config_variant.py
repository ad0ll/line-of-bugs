"""Tests for the variant-tag helper in config.py."""
from __future__ import annotations

from scripts.detect_subjects.config import (
    DETECTOR_VARIANT, SEGMENTER_VARIANT, variant_tag,
)


def test_variant_tag_concatenates_detector_and_segmenter():
    assert variant_tag() == f"{DETECTOR_VARIANT}__{SEGMENTER_VARIANT}"


def test_default_variants_are_current_models():
    """Production default (post Phase 2): both detector and segmenter are sam3."""
    assert DETECTOR_VARIANT == "sam3"
    assert SEGMENTER_VARIANT == "sam3"


def test_default_variants_are_registered():
    """Whatever DETECTOR_VARIANT/SEGMENTER_VARIANT name, it must resolve via the factory."""
    from scripts.detect_subjects.detectors import registered_detectors
    from scripts.detect_subjects.segmenters import registered_segmenters
    assert DETECTOR_VARIANT in registered_detectors()
    assert SEGMENTER_VARIANT in registered_segmenters()


def test_classify_uses_variant_tag_not_v1_name_literal():
    """classify.py's DetectionRow + completion-tracking use cfg.variant_tag()."""
    import inspect
    import scripts.detect_subjects.classify as classify_mod
    source = inspect.getsource(classify_mod)
    # V1_NAME constant must remain for backward-compat documentation
    assert "V1_NAME" in source, "V1_NAME constant must remain for backward-compat documentation"
    # DetectionRow constructor must call variant_tag(), not the V1_NAME literal
    assert "variant=cfg.variant_tag()" in source, \
        "DetectionRow constructor must use cfg.variant_tag(), not V1_NAME"
    # Completion-tracking lookup must also use variant_tag()
    assert "(r[\"image_id\"], cfg.variant_tag())" in source, \
        "completion tracking must use cfg.variant_tag()"
