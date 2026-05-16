"""Tests for the variant-tag helper in config.py."""
from __future__ import annotations

from scripts.detect_subjects.config import (
    DETECTOR_VARIANT, SEGMENTER_VARIANT, variant_tag,
)


def test_variant_tag_concatenates_detector_and_segmenter():
    assert variant_tag() == f"{DETECTOR_VARIANT}__{SEGMENTER_VARIANT}"


def test_default_variants_are_current_models():
    """At Phase 1 we still default to the existing combo."""
    assert DETECTOR_VARIANT == "grounding_dino"
    assert SEGMENTER_VARIANT == "insectsam"


def test_default_variants_are_registered():
    """Whatever DETECTOR_VARIANT/SEGMENTER_VARIANT name, it must resolve via the factory."""
    from scripts.detect_subjects.detectors import registered_detectors
    from scripts.detect_subjects.segmenters import registered_segmenters
    assert DETECTOR_VARIANT in registered_detectors()
    assert SEGMENTER_VARIANT in registered_segmenters()
