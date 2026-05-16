"""Detector factory: name → Detector-implementing instance.

Add new detectors by importing them here and adding a case to make_detector().
"""
from __future__ import annotations
from typing import Any

from scripts.detect_subjects.detectors.grounding_dino import GroundingDinoDetector

_REGISTRY: dict[str, type] = {
    "grounding_dino": GroundingDinoDetector,
}


def make_detector(name: str, **kwargs: Any):
    """Construct a detector by registry name."""
    if name not in _REGISTRY:
        raise ValueError(
            f"unknown detector {name!r}; registered: {sorted(_REGISTRY)}"
        )
    return _REGISTRY[name](**kwargs)


def registered_detectors() -> list[str]:
    return sorted(_REGISTRY)
