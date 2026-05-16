"""Verify _stub detector and segmenter are registered in their factories."""
from __future__ import annotations


def test_stub_detector_registered():
    from scripts.detect_subjects.detectors import registered_detectors
    assert "_stub" in registered_detectors(), \
        f"'_stub' not in registered detectors: {registered_detectors()}"


def test_stub_segmenter_registered():
    from scripts.detect_subjects.segmenters import registered_segmenters
    assert "_stub" in registered_segmenters(), \
        f"'_stub' not in registered segmenters: {registered_segmenters()}"


def test_stub_detector_returns_detection_result():
    from scripts.detect_subjects.detectors import make_detector
    from scripts.detect_subjects.interfaces import DetectionResult
    from PIL import Image
    det = make_detector("_stub")
    img = Image.new("RGB", (640, 480))
    result = det.detect(img, image_id="test-stub-1")
    assert isinstance(result, DetectionResult)
    assert result.bbox_xywh_normalized is not None
    assert result.confidence is not None
    assert result.text_label is not None
    assert result.text_label_score is not None


def test_stub_segmenter_returns_segmentation_result():
    from scripts.detect_subjects.segmenters import make_segmenter
    from scripts.detect_subjects.interfaces import SegmentationResult
    from PIL import Image
    seg = make_segmenter("_stub")
    img = Image.new("RGB", (640, 480))
    result = seg.segment_with_bbox("test-stub-1", img, (0.1, 0.1, 0.3, 0.3))
    assert isinstance(result, SegmentationResult)
    assert result.mask is not None
    assert result.iou_score is not None
