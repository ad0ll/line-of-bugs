"""Backward-compat shim. Real module: scripts.detect_subjects.segmenters.insectsam.

Deprecated. Use `from scripts.detect_subjects.segmenters import make_segmenter`
or import directly from `scripts.detect_subjects.segmenters.insectsam`.
"""
from scripts.detect_subjects.segmenters.insectsam import (
    InsectSAMSegmenter,
    SegmentationResult,
    SAM_EMBED_DIR,
)
