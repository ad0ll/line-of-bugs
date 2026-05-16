"""Protocol contracts for the modular label pipeline.

The pipeline composes a Detector (text → bbox + per-detection phrase),
a Segmenter (bbox → mask), and zero-or-more MLLabelers (features → label
probabilities) into a label-emission chain. Any implementation satisfying
these Protocols is a valid swap-in.
"""
from __future__ import annotations
from dataclasses import dataclass, field
from typing import Optional, Protocol, runtime_checkable

import numpy as np
from PIL import Image


@dataclass(slots=True)
class DetectionResult:
    """One detection pass over one image: primary bbox + all distinct subjects."""
    bbox_xywh_normalized: Optional[tuple[float, float, float, float]]
    confidence: Optional[float]
    n_raw_detections: int
    n_distinct_detections: int
    # Each distinct subject: (x, y, w, h, confidence, text_label_phrase)
    # text_label_phrase may be None if the detector doesn't expose per-phrase matches.
    distinct_subjects: list[tuple[float, float, float, float, float, Optional[str]]] = \
        field(default_factory=list)
    # Phrase that matched the primary bbox (e.g., "a butterfly"). None if not exposed.
    text_label: Optional[str] = None
    # Text-alignment confidence of the primary bbox's matched phrase.
    text_label_score: Optional[float] = None
    detection_ms: int = 0


@dataclass(slots=True)
class SegmentationResult:
    """One segmentation pass over one bbox: pixel mask + model's IoU self-score."""
    mask: Optional[np.ndarray]
    iou_score: Optional[float]
    segmentation_ms: int


@runtime_checkable
class Detector(Protocol):
    """Open-vocabulary bbox detector. Takes image + (internal text prompt) →
    bbox + per-detection phrase + count."""
    def detect(self, image: Image.Image, image_id: str | None = None
               ) -> DetectionResult: ...


@runtime_checkable
class Segmenter(Protocol):
    """Bbox-prompted segmenter. Takes image + normalized xywh bbox → pixel mask."""
    def segment_with_bbox(
        self, image_id: str, image: Image.Image,
        bbox_xywh_normalized: tuple[float, float, float, float],
    ) -> SegmentationResult: ...


@runtime_checkable
class MLLabeler(Protocol):
    """Trained ML labeler. Takes features dict → {label_name: probability}."""
    def predict(self, image_id: str, features: dict) -> dict[str, float]: ...
