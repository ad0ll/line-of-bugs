"""Deterministic stub Detector and Segmenter for integration tests.

Both classes return fixed, reproducible outputs derived from the image_id so
tests can assert on exact values without GPU or model loading. They satisfy
the Detector and Segmenter Protocols in interfaces.py.

Registered as `_stub` in detectors/__init__.py and segmenters/__init__.py.
"""
from __future__ import annotations
import hashlib

import numpy as np
from PIL import Image

from scripts.detect_subjects.interfaces import DetectionResult, SegmentationResult


class StubDetector:
    """Returns deterministic DetectionResult. No model loading."""

    model_id: str = "_stub_detector_v0"

    def __init__(self, **kwargs) -> None:
        pass

    def detect(self, image: Image.Image, image_id: str | None = None) -> DetectionResult:
        seed_bytes = (image_id or "default").encode()
        h = int(hashlib.sha1(seed_bytes).hexdigest()[:8], 16)
        x = 0.10 + (h % 1000) / 10000.0
        y = 0.15 + (h % 900) / 10000.0
        w = 0.20 + (h % 800) / 10000.0
        h_ = 0.25 + (h % 700) / 10000.0
        conf = 0.75 + (h % 200) / 2000.0
        ts = 0.60 + (h % 150) / 1500.0

        distinct = [(x, y, w, h_, conf, "a beetle")]
        return DetectionResult(
            bbox_xywh_normalized=(x, y, w, h_),
            confidence=conf,
            n_raw_detections=1,
            n_distinct_detections=1,
            detection_ms=1,
            distinct_subjects=distinct,
            text_label="a beetle",
            text_label_score=ts,
        )


class StubSegmenter:
    """Returns deterministic SegmentationResult. No model loading."""

    model_id: str = "_stub_segmenter_v0"

    def __init__(self, **kwargs) -> None:
        pass

    def segment_with_bbox(
        self,
        image_id: str,
        image: Image.Image,
        bbox_xywh_normalized: tuple[float, float, float, float],
    ) -> SegmentationResult:
        W, H = image.size
        x, y, w, h = bbox_xywh_normalized
        mask = np.zeros((H, W), dtype=bool)
        x1 = int(x * W)
        y1 = int(y * H)
        x2 = int((x + w) * W)
        y2 = int((y + h) * H)
        mask[y1:y2, x1:x2] = True
        return SegmentationResult(mask=mask, iou_score=0.88, segmentation_ms=1)
