"""Smoke tests for the detectors package factory."""
from __future__ import annotations
from unittest.mock import patch

import pytest

from scripts.detect_subjects import detectors
from scripts.detect_subjects.detectors import (
    make_detector, registered_detectors,
)


def test_registered_detectors_includes_grounding_dino():
    assert "grounding_dino" in registered_detectors()


def test_unknown_detector_raises():
    with pytest.raises(ValueError, match="unknown detector"):
        make_detector("nonexistent_detector")


class _StubDetector:
    """Records construction kwargs without loading any model."""
    def __init__(self, **kwargs):
        self.kwargs = kwargs
    def detect(self, image, image_id=None):  # satisfies Detector Protocol
        return None


def test_make_detector_resolves_name_and_passes_kwargs():
    """Factory must dispatch on name AND forward **kwargs to the constructor."""
    with patch.dict(detectors._REGISTRY, {"_stub": _StubDetector}, clear=False):
        instance = make_detector("_stub", device="mps", dtype="float32")
    assert isinstance(instance, _StubDetector)
    assert instance.kwargs == {"device": "mps", "dtype": "float32"}
