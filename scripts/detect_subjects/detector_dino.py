"""GroundingDINO wrapper for the framing experiment.

Loads `IDEA-Research/grounding-dino-base` at F16 onto MPS.
Detects insects via a multi-class text prompt, returns top NMS-deduplicated
bbox plus the count of distinct detections above the conf floor.

Reference: https://huggingface.co/docs/transformers/en/model_doc/grounding-dino
"""
from __future__ import annotations
import time
from dataclasses import dataclass
from typing import Optional

import torch
from PIL import Image
from transformers import AutoModelForZeroShotObjectDetection, AutoProcessor

from scripts.detect_subjects.config import (
    BOX_THRESHOLD,
    DINO_MODEL_ID,
    INSECT_PROMPT,
    NMS_IOU_THRESHOLD,
    TEXT_THRESHOLD,
    HIGH_CONF_THRESHOLD,
)
from scripts.detect_subjects.metrics import iou_xywh_normalized


@dataclass(slots=True)
class DetectionResult:
    bbox_xywh_normalized: Optional[tuple[float, float, float, float]]
    confidence: Optional[float]
    n_raw_detections: int
    n_distinct_detections: int
    detection_ms: int


class GroundingDinoDetector:
    def __init__(self, device: str = "mps", dtype: torch.dtype = torch.float16) -> None:
        self.device = device
        self.dtype = dtype
        self.processor = AutoProcessor.from_pretrained(DINO_MODEL_ID)
        self.model = AutoModelForZeroShotObjectDetection.from_pretrained(
            DINO_MODEL_ID
        ).to(device=self.device, dtype=self.dtype)
        self.model.eval()
        self.prompt = INSECT_PROMPT

    @torch.no_grad()
    def detect(self, image: Image.Image) -> DetectionResult:
        start = time.perf_counter()
        text_labels = [[self.prompt]]
        inputs = self.processor(
            images=image, text=text_labels, return_tensors="pt"
        ).to(self.device)
        if "pixel_values" in inputs:
            inputs["pixel_values"] = inputs["pixel_values"].to(self.dtype)

        outputs = self.model(**inputs)

        results = self.processor.post_process_grounded_object_detection(
            outputs,
            threshold=BOX_THRESHOLD,
            text_threshold=TEXT_THRESHOLD,
            target_sizes=[(image.height, image.width)],
        )[0]

        elapsed_ms = int((time.perf_counter() - start) * 1000)
        boxes = results["boxes"].cpu().tolist()
        scores = results["scores"].cpu().tolist()
        n_raw = len(boxes)

        if not boxes:
            return DetectionResult(
                bbox_xywh_normalized=None, confidence=None,
                n_raw_detections=0, n_distinct_detections=0,
                detection_ms=elapsed_ms,
            )

        normalized = []
        for (x1, y1, x2, y2), score in zip(boxes, scores):
            normalized.append((
                x1 / image.width,
                y1 / image.height,
                (x2 - x1) / image.width,
                (y2 - y1) / image.height,
                float(score),
            ))

        normalized.sort(key=lambda r: r[4], reverse=True)
        kept: list[tuple[float, float, float, float, float]] = []
        for cand in normalized:
            cx, cy, cw, ch, cs = cand
            if any(
                iou_xywh_normalized((cx, cy, cw, ch), (k[0], k[1], k[2], k[3]))
                > NMS_IOU_THRESHOLD
                for k in kept
            ):
                continue
            kept.append(cand)

        top = kept[0]
        n_distinct = sum(1 for k in kept if k[4] >= HIGH_CONF_THRESHOLD)
        return DetectionResult(
            bbox_xywh_normalized=(top[0], top[1], top[2], top[3]),
            confidence=top[4],
            n_raw_detections=n_raw,
            n_distinct_detections=n_distinct,
            detection_ms=elapsed_ms,
        )
