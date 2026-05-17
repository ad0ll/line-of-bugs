"""Segmenter factory: name → Segmenter-implementing instance."""
from __future__ import annotations
from typing import Any

from scripts.detect_subjects.segmenters.insectsam import InsectSAMSegmenter
from scripts.detect_subjects.segmenters.sam3 import Sam3Segmenter
from tests.python._stubs import StubSegmenter

_REGISTRY: dict[str, type] = {
    "insectsam": InsectSAMSegmenter,
    "sam3": Sam3Segmenter,
    "_stub": StubSegmenter,
}


def make_segmenter(name: str, **kwargs: Any):
    if name not in _REGISTRY:
        raise ValueError(
            f"unknown segmenter {name!r}; registered: {sorted(_REGISTRY)}"
        )
    return _REGISTRY[name](**kwargs)


def registered_segmenters() -> list[str]:
    return sorted(_REGISTRY)
