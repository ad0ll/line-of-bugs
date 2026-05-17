"""SAM 3 detector wrapper implementing the Detector Protocol.

API notes from probe (2026-05-16):
- text must be a single string; pass all phrases joined by ". "
- post_process_instance_segmentation returns {scores, boxes, masks} — NO labels per detection
- pred_boxes is normalized [0,1] xyxy; post_process scales to pixels via target_sizes
- iou_scores is not present in SAM 3 (unlike SAM 1/2)
- text_label is set to the full prompt string (no per-detection phrase)

For the segmenter: box-prompted mode uses input_boxes=[[[x1,y1,x2,y2]]] (3 levels,
pixel xyxy coords). The processor normalizes them internally.

Disk cache (mirroring GroundingDinoDetector pattern):
- Cache key = sha1(prompt + model_id)[:10]
- One JSON file per (image_id, cache_key) at data/cache/raw_sam3/
- Cached fields: boxes (xyxy pixel), scores. Masks not cached (large).
"""
from __future__ import annotations
import hashlib
import json
import time
from pathlib import Path
from typing import Optional

import torch
from PIL import Image

from scripts.detect_subjects._sam3_shared import get_shared_sam3
from scripts.detect_subjects.config import CACHE_DIR
from scripts.detect_subjects.interfaces import DetectionResult

SAM3_CACHE_DIR = CACHE_DIR / "raw_sam3"
SAM3_CACHE_DIR.mkdir(parents=True, exist_ok=True)


def _sam3_cache_key(prompt: str, model_id: str) -> str:
    return hashlib.sha1((model_id + "|" + prompt).encode()).hexdigest()[:10]


class Sam3Detector:
    model_id: str = "facebook/sam3"

    def __init__(
        self,
        device: str = "mps",
        dtype: torch.dtype = torch.float32,
        prompt_phrases: Optional[list[str]] = None,
        box_threshold: float = 0.3,
        **kwargs,
    ) -> None:
        self.device = device
        self.dtype = dtype
        self.prompt_phrases = prompt_phrases or ["an insect"]
        self.box_threshold = box_threshold
        self.model, self.processor = get_shared_sam3(device=device, dtype=dtype)
        # Build and cache the text query at init time (token-budget trimming is O(phrases))
        self._text_query = self._build_text_query()
        print(f"[Sam3Detector] text query ({len(self._text_query.split('. '))} phrases): {self._text_query!r}")

    # SAM 3 tokenizer has a hard max_position_embeddings of 32 tokens.
    # Each phrase adds ~3 tokens; we trim to fit within 31 tokens to leave room for EOS.
    _TOKEN_BUDGET = 31

    def _build_text_query(self) -> str:
        """Join phrases into a single query string that fits within the 32-token budget.

        SAM 3's CLIP tokenizer has a hard max_position_embeddings of 32. The processor
        calls tokenizer(..., padding='max_length', max_length=32) WITHOUT truncation=True,
        so any sequence longer than 32 tokens raises a ValueError. We greedily accumulate
        phrases until adding the next one would exceed the budget.
        """
        accumulated: list[str] = []
        for phrase in self.prompt_phrases:
            candidate = ". ".join(accumulated + [phrase])
            # Silence the HuggingFace "sequence length > max_position_embeddings" warning:
            # we're intentionally probing one token past the limit to decide whether to add.
            import warnings
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                n_tokens = len(self.processor.tokenizer(candidate)["input_ids"])
            if n_tokens <= self._TOKEN_BUDGET:
                accumulated.append(phrase)
            else:
                break  # stop — adding more would overflow
        if not accumulated:
            accumulated = ["an insect"]  # last-resort fallback
        query = ". ".join(accumulated)
        return query

    @torch.no_grad()
    def detect(self, image: Image.Image, image_id: str | None = None) -> DetectionResult:
        start = time.perf_counter()
        W, H = image.width, image.height
        text_query = self._text_query

        # Disk cache: skip inference if (image_id, prompt, model_id) already processed.
        cache_key = _sam3_cache_key(text_query, self.model_id)
        cache_path = SAM3_CACHE_DIR / f"{image_id}__{cache_key}.json" if image_id else None
        cached = None
        if cache_path is not None and cache_path.exists():
            try:
                cached = json.loads(cache_path.read_text())
            except Exception:
                cached = None  # corrupted; re-run

        if cached is not None:
            boxes_list = cached["boxes"]
            scores_list = cached["scores"]
        else:
            inputs = self.processor(
                images=image,
                text=text_query,
                return_tensors="pt",
            ).to(self.device)
            if "pixel_values" in inputs:
                inputs["pixel_values"] = inputs["pixel_values"].to(self.dtype)

            outputs = self.model(**inputs)

            results = self.processor.post_process_instance_segmentation(
                outputs,
                threshold=self.box_threshold,
                mask_threshold=0.5,
                target_sizes=[(H, W)],
            )[0]

            boxes_tensor = results.get("boxes")
            scores_tensor = results.get("scores")
            if boxes_tensor is None or len(boxes_tensor) == 0:
                boxes_list, scores_list = [], []
            else:
                boxes_list = boxes_tensor.cpu().tolist()
                scores_list = scores_tensor.cpu().tolist()

            if cache_path is not None:
                try:
                    cache_path.write_text(json.dumps({
                        "boxes": boxes_list,
                        "scores": scores_list,
                    }))
                except Exception:
                    pass  # best-effort cache

        elapsed_ms = int((time.perf_counter() - start) * 1000)

        if not boxes_list:
            return DetectionResult(
                bbox_xywh_normalized=None,
                confidence=None,
                n_raw_detections=0,
                n_distinct_detections=0,
                detection_ms=elapsed_ms,
                distinct_subjects=[],
                text_label=None,
                text_label_score=None,
            )

        # Convert xyxy pixel → normalized xywh
        distinct: list[tuple] = []
        for (x1, y1, x2, y2), score in zip(boxes_list, scores_list):
            nx = x1 / W
            ny = y1 / H
            nw = max(0.0, (x2 - x1) / W)
            nh = max(0.0, (y2 - y1) / H)
            # SAM 3 has no per-detection label; attribute all to the full query string
            distinct.append((float(nx), float(ny), float(nw), float(nh),
                             float(score), text_query))

        # Sort by confidence descending; pick highest as primary
        distinct.sort(key=lambda r: r[4], reverse=True)
        primary = distinct[0]

        return DetectionResult(
            bbox_xywh_normalized=(primary[0], primary[1], primary[2], primary[3]),
            confidence=primary[4],
            n_raw_detections=len(distinct),
            n_distinct_detections=len(distinct),
            detection_ms=elapsed_ms,
            distinct_subjects=distinct,
            text_label=text_query,
            text_label_score=primary[4],
        )
