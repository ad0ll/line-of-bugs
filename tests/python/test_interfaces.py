"""Protocol contracts for the modular pipeline."""
from __future__ import annotations
import inspect

from scripts.detect_subjects.interfaces import (
    Detector, Segmenter, MLLabeler,
    DetectionResult, SegmentationResult,
)


def test_detector_protocol_has_detect_method():
    assert hasattr(Detector, "detect")


def test_segmenter_protocol_has_segment_with_bbox_method():
    assert hasattr(Segmenter, "segment_with_bbox")


def test_ml_labeler_protocol_has_predict_method():
    assert hasattr(MLLabeler, "predict")


def test_detection_result_fields():
    result = DetectionResult(
        bbox_xywh_normalized=(0.1, 0.2, 0.3, 0.4),
        confidence=0.85,
        n_raw_detections=3,
        n_distinct_detections=1,
        distinct_subjects=[(0.1, 0.2, 0.3, 0.4, 0.85, "a butterfly")],
        text_label="a butterfly",
        text_label_score=0.42,
        detection_ms=120,
    )
    assert result.bbox_xywh_normalized == (0.1, 0.2, 0.3, 0.4)
    assert result.text_label == "a butterfly"


def test_detection_result_nullable_fields():
    """When no bug detected, primary fields are None."""
    result = DetectionResult(
        bbox_xywh_normalized=None,
        confidence=None,
        n_raw_detections=0,
        n_distinct_detections=0,
        distinct_subjects=[],
        text_label=None,
        text_label_score=None,
        detection_ms=42,
    )
    assert result.bbox_xywh_normalized is None


def test_segmentation_result_fields():
    import numpy as np
    mask = np.zeros((10, 10), dtype=bool)
    result = SegmentationResult(mask=mask, iou_score=0.92, segmentation_ms=85)
    assert result.iou_score == 0.92
    assert result.mask.shape == (10, 10)
