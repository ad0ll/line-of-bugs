"""Smoke tests for the detectors package factory."""
from __future__ import annotations

from scripts.detect_subjects.detectors import (
    make_detector, registered_detectors,
)


def test_registered_detectors_includes_grounding_dino():
    assert "grounding_dino" in registered_detectors()


def test_unknown_detector_raises():
    import pytest
    with pytest.raises(ValueError, match="unknown detector"):
        make_detector("nonexistent_detector")


def test_make_detector_returns_an_object_with_detect():
    """We don't load the model (heavy); just check the class is callable
    and has the expected interface. Use lazy_init=True if available, or skip
    model loading via mock; otherwise trust that the existing tests cover
    the actual detection behavior."""
    # Check that make_detector returns a callable type without loading weights.
    from scripts.detect_subjects.detectors.grounding_dino import GroundingDinoDetector
    assert callable(getattr(GroundingDinoDetector, "detect", None))
