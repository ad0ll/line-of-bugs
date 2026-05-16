"""Smoke tests for the segmenters package factory."""
from __future__ import annotations
from unittest.mock import patch

import pytest

from scripts.detect_subjects import segmenters
from scripts.detect_subjects.segmenters import (
    make_segmenter, registered_segmenters,
)


def test_registered_segmenters_includes_insectsam():
    assert "insectsam" in registered_segmenters()


def test_unknown_segmenter_raises():
    with pytest.raises(ValueError, match="unknown segmenter"):
        make_segmenter("nonexistent_segmenter")


class _StubSegmenter:
    """Records construction kwargs without loading any model."""
    def __init__(self, **kwargs):
        self.kwargs = kwargs
    def segment_with_bbox(self, image_id, image, bbox_xywh_normalized):
        return None


def test_make_segmenter_resolves_name_and_passes_kwargs():
    """Factory must dispatch on name AND forward **kwargs to the constructor."""
    with patch.dict(segmenters._REGISTRY, {"_stub": _StubSegmenter}, clear=False):
        instance = make_segmenter("_stub", device="mps", dtype="float32")
    assert isinstance(instance, _StubSegmenter)
    assert instance.kwargs == {"device": "mps", "dtype": "float32"}
