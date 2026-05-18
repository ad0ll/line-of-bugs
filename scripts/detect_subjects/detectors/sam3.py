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

    # Empirical finding (2026-05-17): multi-phrase prompts dilute SAM 3's
    # presence_logits.sigmoid() — the scene-level gate that determines whether
    # ANY query gets a high score. Adding 8 phrases drops presence from 0.98 to
    # 0.08 on the same dragonfly image. Per-taxon single phrases ("a dragonfly")
    # beat "an insect" on clean taxa but regress on damselflies / larvae where
    # the CLIP concept doesn't include the subject. A/B over 87 images:
    # "an insect" alone produced 34 new detections + 0 regressions vs the
    # 9-phrase prompt. See docs/sam3_prompt_investigation.md.
    DEFAULT_PROMPT_PHRASES = ["an insect"]

    def __init__(
        self,
        device: str = "mps",
        dtype: torch.dtype = torch.float32,
        prompt_phrases: Optional[list[str]] = None,
        box_threshold: float = 0.3,
        processor=None,
        **kwargs,
    ) -> None:
        self.device = device
        self.dtype = dtype
        self.prompt_phrases = prompt_phrases or list(self.DEFAULT_PROMPT_PHRASES)
        if prompt_phrases and prompt_phrases != self.DEFAULT_PROMPT_PHRASES:
            print(f"[Sam3Detector] WARN: caller passed {len(prompt_phrases)} prompt phrases; "
                  f"empirical evidence says single 'an insect' wins (see "
                  f"docs/sam3_prompt_investigation.md). Honoring caller's choice anyway.")
        self.box_threshold = box_threshold
        # Shared model (singleton); processor is per-instance if caller provided one
        # (concurrent inference workers need their own — see _sam3_shared.py).
        self.model, shared_processor = get_shared_sam3(device=device, dtype=dtype)
        self.processor = processor if processor is not None else shared_processor
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
        """Single-image detect — thin wrapper over detect_batch for API compat."""
        return self.detect_batch([image], [image_id])[0]

    @torch.no_grad()
    def detect_batch(
        self, images: list[Image.Image], image_ids: list[str | None],
    ) -> list[DetectionResult]:
        """Batched detection: one model.forward() over N images, then per-image
        post-processing. Cache hits are decoded without touching the GPU; the
        remaining uncached images go through a single batched forward.

        The text query is the same for every image (it's a property of the
        detector instance), so we can pass `text=text_query` once and let the
        processor broadcast — no per-image text needed.
        """
        if len(images) != len(image_ids):
            raise ValueError(f"images ({len(images)}) and image_ids ({len(image_ids)}) length mismatch")
        if not images:
            return []

        text_query = self._text_query
        cache_key = _sam3_cache_key(text_query, self.model_id)
        n = len(images)

        # Phase 1: cache check
        cached_at: dict[int, dict] = {}
        cache_paths: list[Path | None] = []
        for i, image_id in enumerate(image_ids):
            cache_path = (
                SAM3_CACHE_DIR / f"{image_id}__{cache_key}.json" if image_id else None
            )
            cache_paths.append(cache_path)
            if cache_path is not None and cache_path.exists():
                try:
                    cached_at[i] = json.loads(cache_path.read_text())
                except Exception:
                    pass  # corrupted; re-run below

        # Phase 2: batched inference for uncached indices
        # Per-image timing is meaningless in a batch — apportion the batch wall
        # time evenly across the uncached members.
        uncached_idx = [i for i in range(n) if i not in cached_at]
        per_image_ms = {}

        if uncached_idx:
            t_batch = time.perf_counter()
            sub_images = [images[i] for i in uncached_idx]
            target_sizes = [(images[i].height, images[i].width) for i in uncached_idx]
            # SAM3 requires text to be batched 1-to-1 with images — passing a
            # single string with N images yields RuntimeError on cross-attn
            # shape ('[N, ...]' invalid for input of size N*single_text).
            # Repeat the same prompt N times.
            inputs = self.processor(
                images=sub_images,
                text=[text_query] * len(sub_images),
                return_tensors="pt",
            ).to(self.device)
            if "pixel_values" in inputs:
                inputs["pixel_values"] = inputs["pixel_values"].to(self.dtype)
            outputs = self.model(**inputs)
            results_per_image = self.processor.post_process_instance_segmentation(
                outputs, threshold=self.box_threshold, mask_threshold=0.5,
                target_sizes=target_sizes,
            )
            batch_ms = int((time.perf_counter() - t_batch) * 1000)
            apportioned = max(1, batch_ms // len(uncached_idx))
            for j, i in enumerate(uncached_idx):
                r = results_per_image[j]
                boxes_t = r.get("boxes")
                scores_t = r.get("scores")
                if boxes_t is None or len(boxes_t) == 0:
                    boxes_list, scores_list = [], []
                else:
                    boxes_list = boxes_t.cpu().tolist()
                    scores_list = scores_t.cpu().tolist()
                cached_at[i] = {"boxes": boxes_list, "scores": scores_list}
                per_image_ms[i] = apportioned
                cp = cache_paths[i]
                if cp is not None:
                    try:
                        cp.write_text(json.dumps({"boxes": boxes_list, "scores": scores_list}))
                    except Exception:
                        pass

        # Phase 3: decode into DetectionResults in input order
        out: list[DetectionResult] = []
        for i in range(n):
            data = cached_at[i]
            boxes_list = data["boxes"]
            scores_list = data["scores"]
            W, H = images[i].width, images[i].height
            ms = per_image_ms.get(i, 0)  # 0 for cache hits — load was negligible
            if not boxes_list:
                out.append(DetectionResult(
                    bbox_xywh_normalized=None, confidence=None,
                    n_raw_detections=0, n_distinct_detections=0,
                    detection_ms=ms, distinct_subjects=[],
                    text_label=None, text_label_score=None,
                ))
                continue
            distinct: list[tuple] = []
            for (x1, y1, x2, y2), score in zip(boxes_list, scores_list):
                nx = x1 / W
                ny = y1 / H
                nw = max(0.0, (x2 - x1) / W)
                nh = max(0.0, (y2 - y1) / H)
                distinct.append((float(nx), float(ny), float(nw), float(nh),
                                 float(score), text_query))
            distinct.sort(key=lambda r: r[4], reverse=True)
            primary = distinct[0]
            out.append(DetectionResult(
                bbox_xywh_normalized=(primary[0], primary[1], primary[2], primary[3]),
                confidence=primary[4],
                n_raw_detections=len(distinct),
                n_distinct_detections=len(distinct),
                detection_ms=ms,
                distinct_subjects=distinct,
                text_label=text_query,
                text_label_score=primary[4],
            ))
        return out
