"""SAM 3 segmenter wrapper (bbox-prompted mode) implementing the Segmenter Protocol.

API notes from probe (2026-05-16):
- Box-prompted: processor(images=..., input_boxes=[[[x1,y1,x2,y2]]], ...) — 3 levels,
  pixel xyxy coords. Processor normalizes to [0,1] internally.
- text auto-resolves to "visual" when only input_boxes provided (no explicit text needed)
- post_process_instance_segmentation returns {scores, boxes, masks} — use lowest threshold
  to get the prompted region's mask; pick the highest-scoring detection
- iou_scores not available in SAM 3; use detection score as proxy
"""
from __future__ import annotations
import time

import numpy as np
import torch
from PIL import Image

from scripts.detect_subjects._sam3_shared import get_shared_sam3
from scripts.detect_subjects.interfaces import SegmentationResult


class Sam3Segmenter:
    model_id: str = "facebook/sam3"

    def __init__(self, device: str = "mps", dtype: torch.dtype = torch.float32,
                 processor=None, **kwargs) -> None:
        self.device = device
        self.dtype = dtype
        self.model, shared_processor = get_shared_sam3(device=device, dtype=dtype)
        self.processor = processor if processor is not None else shared_processor

    @torch.no_grad()
    def segment_with_bbox(
        self,
        image_id: str,
        image: Image.Image,
        bbox_xywh_normalized: tuple[float, float, float, float],
    ) -> SegmentationResult:
        start = time.perf_counter()
        W, H = image.width, image.height
        x, y, w, h = bbox_xywh_normalized
        # Convert normalized xywh → pixel xyxy
        x1 = x * W
        y1 = y * H
        x2 = (x + w) * W
        y2 = (y + h) * H

        try:
            # Box-prompted segmentation: processor takes pixel xyxy, normalizes internally
            # input_boxes format: [images, boxes, coords] — 3 levels
            inputs = self.processor(
                images=image,
                input_boxes=[[[x1, y1, x2, y2]]],
                return_tensors="pt",
            ).to(self.device)
            if "pixel_values" in inputs:
                inputs["pixel_values"] = inputs["pixel_values"].to(self.dtype)

            outputs = self.model(**inputs)

            # Use a low threshold to ensure we get at least one mask covering the bbox region
            results = self.processor.post_process_instance_segmentation(
                outputs,
                threshold=0.05,
                mask_threshold=0.5,
                target_sizes=[(H, W)],
            )[0]

            masks_tensor = results.get("masks")
            scores_tensor = results.get("scores")

            if masks_tensor is not None and len(masks_tensor) > 0:
                scores_list = scores_tensor.cpu().tolist() if scores_tensor is not None else []
                # Pick highest-scoring mask
                best_idx = int(np.argmax(scores_list)) if scores_list else 0
                iou_score = float(scores_list[best_idx]) if scores_list else None

                mask_raw = masks_tensor[best_idx].cpu()
                # masks are already binarized (long tensor 0/1) by post_process
                mask = mask_raw.numpy().astype(bool)
                # Ensure 2D HxW
                while mask.ndim > 2:
                    mask = mask[0]

                elapsed_ms = int((time.perf_counter() - start) * 1000)
                return SegmentationResult(
                    mask=mask,
                    iou_score=iou_score,
                    segmentation_ms=elapsed_ms,
                )

        except Exception as e:
            print(f"[sam3-seg] box-prompted segmentation failed for {image_id}: {e}; returning empty mask")

        # Fallback: empty mask
        elapsed_ms = int((time.perf_counter() - start) * 1000)
        return SegmentationResult(
            mask=np.zeros((H, W), dtype=bool),
            iou_score=None,
            segmentation_ms=elapsed_ms,
        )
