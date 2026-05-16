"""Backward-compat shim. Real module: scripts.detect_subjects.detectors.grounding_dino.

Deprecated. Use `from scripts.detect_subjects.detectors import make_detector`
or import directly from `scripts.detect_subjects.detectors.grounding_dino`.
"""
from scripts.detect_subjects.detectors.grounding_dino import (
    GroundingDinoDetector,
    DetectionResult,
    DINO_CACHE_DIR,
)
