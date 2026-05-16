"""GroundingDINO wrapper for the framing experiment.

Loads `IDEA-Research/grounding-dino-base` at F16 onto MPS.
Detects insects via a multi-class text prompt, returns top NMS-deduplicated
bbox plus the count of distinct detections above the conf floor.

Reference: https://huggingface.co/docs/transformers/en/model_doc/grounding-dino
"""
from __future__ import annotations
import time
from typing import Optional

import torch
from PIL import Image
from transformers import AutoModelForZeroShotObjectDetection, AutoProcessor

import hashlib
import json
from pathlib import Path

from scripts.detect_subjects.config import (
    BBOX_CONF_TOLERANCE,
    BBOX_MAX_AREA_RATIO,
    BOX_THRESHOLD,
    CACHE_DIR,
    DINO_MODEL_ID,
    INSECT_PROMPT,
    NMS_IOU_THRESHOLD,
    TEXT_THRESHOLD,
    HIGH_CONF_THRESHOLD,
)


DINO_CACHE_DIR = CACHE_DIR / "raw_dino"
DINO_CACHE_DIR.mkdir(parents=True, exist_ok=True)


def _dino_cache_key(prompt: str, model_id: str) -> str:
    """Short fingerprint binding the cached result to the (model, prompt) combo."""
    h = hashlib.sha1((model_id + "|" + prompt).encode()).hexdigest()[:10]
    return h
from scripts.detect_subjects.metrics import iou_xywh_normalized


from scripts.detect_subjects.interfaces import DetectionResult

# Each distinct_subjects tuple is (x, y, w, h, confidence, phrase). GroundingDINO
# populates the phrase slot from the matched text prompt phrase per detection.
# interfaces.DetectionResult's text_label and text_label_score are populated from
# the primary detection's matched phrase and text-alignment logit score.
# The "bark-beetle fix" may pick a non-top-conf primary, so downstream consumers
# that want SECONDARY detections should skip whichever box matches the primary.


class GroundingDinoDetector:
    model_id: str = DINO_MODEL_ID  # written to parquet rows; survives variant swaps

    def __init__(self, device: str = "mps", dtype: torch.dtype = torch.float32) -> None:
        self.device = device
        self.dtype = dtype
        self.processor = AutoProcessor.from_pretrained(DINO_MODEL_ID)
        self.model = AutoModelForZeroShotObjectDetection.from_pretrained(
            DINO_MODEL_ID
        ).to(device=self.device, dtype=self.dtype)
        self.model.eval()
        self.prompt = INSECT_PROMPT

    @torch.no_grad()
    def detect(self, image: Image.Image, image_id: str | None = None) -> DetectionResult:
        start = time.perf_counter()

        # Disk cache: if we already have raw DINO output for this (image, model, prompt),
        # skip inference and reuse it. Cache miss → run the model, then write to disk.
        cache_key = _dino_cache_key(self.prompt, DINO_MODEL_ID)
        cache_path = DINO_CACHE_DIR / f"{image_id}__{cache_key}.json" if image_id else None
        cached = None
        if cache_path is not None and cache_path.exists():
            try:
                cached = json.loads(cache_path.read_text())
            except Exception:
                cached = None  # corrupted; re-run

        if cached is not None:
            boxes = cached["boxes"]
            scores = cached["scores"]
            text_scores = cached.get("text_scores", [None] * len(boxes))
            labels = cached.get("labels", [None] * len(boxes))
        else:
            inputs = self.processor(
                images=image, text=self.prompt, return_tensors="pt"
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
            boxes = results["boxes"].cpu().tolist()
            scores = results["scores"].cpu().tolist()
            labels = [str(l) for l in results.get("labels", [None] * len(boxes))]
            logits = results.get("logits", None)
            if logits is not None:
                text_scores = logits.cpu().max(dim=-1).values.tolist()
            else:
                text_scores = [None] * len(boxes)
            if cache_path is not None:
                try:
                    cache_path.write_text(json.dumps({
                        "boxes": boxes,
                        "scores": scores,
                        "text_scores": text_scores,
                        "labels": labels,
                    }))
                except Exception:
                    pass  # best-effort cache; don't fail the run

        elapsed_ms = int((time.perf_counter() - start) * 1000)
        return self._detect_from_raw(
            boxes=boxes, scores=scores, text_scores=text_scores,
            labels=labels, elapsed_ms=elapsed_ms,
            image_w=image.width, image_h=image.height,
        )

    def _detect_from_raw(
        self,
        boxes: list,
        scores: list,
        elapsed_ms: int,
        image_w: int,
        image_h: int,
        text_scores: list | None = None,
        labels: list | None = None,
    ) -> DetectionResult:
        """Core detection logic, separated for testability."""
        if text_scores is None:
            text_scores = [None] * len(boxes)
        if labels is None:
            labels = [None] * len(boxes)

        n_raw = len(boxes)

        if not boxes:
            return DetectionResult(
                bbox_xywh_normalized=None, confidence=None,
                n_raw_detections=0, n_distinct_detections=0,
                detection_ms=elapsed_ms,
                distinct_subjects=[],
                text_label=None,
                text_label_score=None,
            )

        normalized = []
        for idx, ((x1, y1, x2, y2), score) in enumerate(zip(boxes, scores)):
            normalized.append((
                x1 / image_w,
                y1 / image_h,
                (x2 - x1) / image_w,
                (y2 - y1) / image_h,
                float(score),
                text_scores[idx],
                labels[idx],
            ))

        normalized.sort(key=lambda r: r[4], reverse=True)
        kept: list[tuple] = []
        for cand in normalized:
            cx, cy, cw, ch, cs = cand[0], cand[1], cand[2], cand[3], cand[4]
            if any(
                iou_xywh_normalized((cx, cy, cw, ch), (k[0], k[1], k[2], k[3]))
                > NMS_IOU_THRESHOLD
                for k in kept
            ):
                continue
            kept.append(cand)

        # Bark-beetle fix: DINO's top-1 box is sometimes a small distinctive sub-feature
        # (head/eye) while the whole-bug box ranks just below it. Among detections within
        # BBOX_CONF_TOLERANCE of the top score AND covering <= BBOX_MAX_AREA_RATIO of the
        # frame (rejects "whole image" boxes), pick the largest. Falls back to top-1.
        top_conf = kept[0][4]
        candidates = [
            k for k in kept
            if k[4] >= top_conf - BBOX_CONF_TOLERANCE
            and (k[2] * k[3]) <= BBOX_MAX_AREA_RATIO
        ]
        top = max(candidates, key=lambda k: k[2] * k[3]) if candidates else kept[0]

        # n_distinct_detections counts subject INSTANCES (not raw boxes).
        # Greedy clustering: a box is a "new subject" only if its center is NOT
        # inside any already-counted subject's box. This collapses head/body/whole
        # multi-detections of the same bug into one and counts genuinely separated
        # instances. Also exclude tiny specks (<0.5% area) and whole-scene boxes (>80%).
        confident = [
            k for k in kept
            if k[4] >= HIGH_CONF_THRESHOLD
            and 0.005 <= (k[2] * k[3]) <= BBOX_MAX_AREA_RATIO
        ]
        distinct_subjects: list[
            tuple[float, float, float, float, float, Optional[str]]
        ] = []
        for c in confident:  # already sorted by conf desc
            cx_center = c[0] + c[2] / 2.0
            cy_center = c[1] + c[3] / 2.0
            inside_any = False
            for s in distinct_subjects:
                if (s[0] <= cx_center <= s[0] + s[2]
                        and s[1] <= cy_center <= s[1] + s[3]):
                    inside_any = True
                    break
            if not inside_any:
                phrase = c[6] if len(c) > 6 else None
                distinct_subjects.append((c[0], c[1], c[2], c[3], c[4], phrase))
        n_distinct = len(distinct_subjects)

        primary_text_label = top[6] if len(top) > 6 else None
        primary_text_score = top[5] if len(top) > 5 else None
        if primary_text_score is not None:
            primary_text_score = float(primary_text_score)

        return DetectionResult(
            bbox_xywh_normalized=(top[0], top[1], top[2], top[3]),
            confidence=top[4],
            n_raw_detections=n_raw,
            n_distinct_detections=n_distinct,
            detection_ms=elapsed_ms,
            distinct_subjects=distinct_subjects,
            text_label=primary_text_label,
            text_label_score=primary_text_score,
        )
