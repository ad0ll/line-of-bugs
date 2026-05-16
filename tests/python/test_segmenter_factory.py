"""Smoke tests for the segmenters package factory."""
from __future__ import annotations
import pytest

from scripts.detect_subjects.segmenters import (
    make_segmenter, registered_segmenters,
)


def test_registered_segmenters_includes_insectsam():
    assert "insectsam" in registered_segmenters()


def test_unknown_segmenter_raises():
    with pytest.raises(ValueError, match="unknown segmenter"):
        make_segmenter("nonexistent_segmenter")


def test_make_segmenter_class_has_required_method():
    from scripts.detect_subjects.segmenters.insectsam import InsectSAMSegmenter
    assert callable(getattr(InsectSAMSegmenter, "segment_with_bbox", None))
