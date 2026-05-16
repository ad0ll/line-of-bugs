"""Backward-compat shim. Real module: scripts.detect_subjects.detectors.grounding_dino.

Deprecated. Use `from scripts.detect_subjects.detectors import make_detector`
or import directly from `scripts.detect_subjects.detectors.grounding_dino`.

`DetectionResult` is now the unified `interfaces.DetectionResult`; this shim
re-exports it from there for backward compat.
"""
from scripts.detect_subjects.detectors.grounding_dino import (
    GroundingDinoDetector,
    DINO_CACHE_DIR,
)
from scripts.detect_subjects.interfaces import DetectionResult  # noqa: F401
