"""Test that GroundingDINO detector populates per-detection phrase fields.

These tests exercise the post-processing logic without loading the GPU model.
We patch the processor and model to return controlled outputs.
"""
from __future__ import annotations
from unittest.mock import MagicMock, patch

import torch
from PIL import Image

from scripts.detect_subjects.interfaces import DetectionResult


def _make_mock_detector():
    """Build a GroundingDinoDetector with mocked model + processor."""
    from scripts.detect_subjects.detectors.grounding_dino import GroundingDinoDetector
    with patch("scripts.detect_subjects.detectors.grounding_dino.AutoProcessor.from_pretrained") as mp, \
         patch("scripts.detect_subjects.detectors.grounding_dino.AutoModelForZeroShotObjectDetection.from_pretrained") as mm:
        mock_processor = MagicMock()
        mock_model = MagicMock()
        mock_model.to.return_value = mock_model
        mp.return_value = mock_processor
        mm.return_value = mock_model
        det = GroundingDinoDetector.__new__(GroundingDinoDetector)
        det.device = "cpu"
        det.dtype = torch.float32
        det.processor = mock_processor
        det.model = mock_model
        det.prompt = "an insect. a butterfly."
    return det


def test_no_detections_returns_none_phrase():
    """When no boxes detected, text_label and text_label_score stay None."""
    det = _make_mock_detector()
    result = det._detect_from_raw(boxes=[], scores=[], text_scores=[], elapsed_ms=10,
                                   image_w=640, image_h=480)
    assert result.text_label is None
    assert result.text_label_score is None
    assert result.distinct_subjects == []


def test_single_detection_populates_phrase():
    """A single detection above threshold populates text_label and text_label_score."""
    det = _make_mock_detector()
    boxes = [[100.0, 50.0, 300.0, 200.0]]  # x1,y1,x2,y2 in 640x480 pixels
    scores = [0.82]
    text_scores = [0.65]

    result = det._detect_from_raw(
        boxes=boxes, scores=scores, text_scores=text_scores,
        elapsed_ms=50, image_w=640, image_h=480,
    )
    assert result.text_label_score is not None
    assert abs(result.text_label_score - 0.65) < 1e-5
    assert result.confidence is not None
    assert abs(result.confidence - 0.82) < 1e-5


def test_distinct_subjects_phrase_slot_populated():
    """Each distinct_subjects entry's 6th slot (phrase) is populated from text output."""
    det = _make_mock_detector()
    boxes = [
        [50.0, 50.0, 200.0, 200.0],
        [400.0, 300.0, 600.0, 450.0],
    ]
    scores = [0.85, 0.78]
    text_scores = [0.71, 0.63]
    labels = ["a beetle", "a butterfly"]

    result = det._detect_from_raw(
        boxes=boxes, scores=scores, text_scores=text_scores, labels=labels,
        elapsed_ms=60, image_w=640, image_h=480,
    )
    for subj in result.distinct_subjects:
        x, y, w, h, conf, phrase = subj
        assert phrase is not None, f"phrase slot is None for subject at ({x},{y})"
