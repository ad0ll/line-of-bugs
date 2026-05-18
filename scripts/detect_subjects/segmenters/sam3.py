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
        """Single-image segment — thin wrapper over segment_batch."""
        return self.segment_batch([image_id], [image], [bbox_xywh_normalized])[0]

    @torch.no_grad()
    def segment_batch(
        self,
        image_ids: list[str],
        images: list[Image.Image],
        bboxes_xywh_normalized: list[tuple[float, float, float, float]],
    ) -> list[SegmentationResult]:
        """One model.forward() over N (image, bbox) pairs. Returns list of
        SegmentationResult in input order. On batched-inference failure,
        retries each item individually so one bad image doesn't sink the batch.
        """
        n = len(images)
        if n == 0:
            return []
        if not (n == len(image_ids) == len(bboxes_xywh_normalized)):
            raise ValueError("segment_batch: input lists must be same length")

        # Convert normalized xywh → pixel xyxy per image
        input_boxes = []
        for img, (x, y, w, h) in zip(images, bboxes_xywh_normalized):
            W, H = img.width, img.height
            x1, y1 = x * W, y * H
            x2, y2 = (x + w) * W, (y + h) * H
            input_boxes.append([[x1, y1, x2, y2]])  # 2 levels per image: [[box_pixel_coords]]

        target_sizes = [(img.height, img.width) for img in images]
        t_batch = time.perf_counter()

        try:
            inputs = self.processor(
                images=images, input_boxes=input_boxes, return_tensors="pt",
            ).to(self.device)
            if "pixel_values" in inputs:
                inputs["pixel_values"] = inputs["pixel_values"].to(self.dtype)
            outputs = self.model(**inputs)
            results_per_image = self.processor.post_process_instance_segmentation(
                outputs, threshold=0.05, mask_threshold=0.5, target_sizes=target_sizes,
            )
        except Exception as e:
            # Batched call failed — fall back to per-image so one bad image doesn't
            # poison the whole batch. Re-raise here would lose N-1 good results.
            print(f"[sam3-seg-batch] batched call failed ({type(e).__name__}: {e}); "
                  f"falling back to per-image for this chunk")
            out: list[SegmentationResult] = []
            for iid, img, bb in zip(image_ids, images, bboxes_xywh_normalized):
                # Delegate to single-image path. To avoid infinite recursion if
                # the failure is image-independent, we recurse with batch of 1
                # which takes the same code path but with N=1 — same risk. Just
                # do the inference inline.
                try:
                    out.append(self._segment_single_inline(iid, img, bb))
                except Exception as inner:
                    print(f"[sam3-seg] {iid} also failed singly: {inner}; empty mask")
                    out.append(SegmentationResult(
                        mask=np.zeros((img.height, img.width), dtype=bool),
                        iou_score=None,
                        segmentation_ms=0,
                    ))
            return out

        batch_ms = int((time.perf_counter() - t_batch) * 1000)
        per_image_ms = max(1, batch_ms // n)

        out: list[SegmentationResult] = []
        for j, (img, res) in enumerate(zip(images, results_per_image)):
            W, H = img.width, img.height
            masks_tensor = res.get("masks")
            scores_tensor = res.get("scores")
            if masks_tensor is None or len(masks_tensor) == 0:
                out.append(SegmentationResult(
                    mask=np.zeros((H, W), dtype=bool),
                    iou_score=None,
                    segmentation_ms=per_image_ms,
                ))
                continue
            scores_list = scores_tensor.cpu().tolist() if scores_tensor is not None else []
            best_idx = int(np.argmax(scores_list)) if scores_list else 0
            iou_score = float(scores_list[best_idx]) if scores_list else None
            mask_raw = masks_tensor[best_idx].cpu()
            mask = mask_raw.numpy().astype(bool)
            while mask.ndim > 2:
                mask = mask[0]
            out.append(SegmentationResult(
                mask=mask, iou_score=iou_score, segmentation_ms=per_image_ms,
            ))
        return out

    @torch.no_grad()
    def _segment_single_inline(
        self, image_id: str, image: Image.Image,
        bbox_xywh_normalized: tuple[float, float, float, float],
    ) -> SegmentationResult:
        """Fallback for when batched segment fails. Single-image inference,
        no recursion into segment_batch."""
        W, H = image.width, image.height
        x, y, w, h = bbox_xywh_normalized
        x1, y1, x2, y2 = x * W, y * H, (x + w) * W, (y + h) * H
        t = time.perf_counter()
        inputs = self.processor(
            images=image, input_boxes=[[[x1, y1, x2, y2]]], return_tensors="pt",
        ).to(self.device)
        if "pixel_values" in inputs:
            inputs["pixel_values"] = inputs["pixel_values"].to(self.dtype)
        outputs = self.model(**inputs)
        res = self.processor.post_process_instance_segmentation(
            outputs, threshold=0.05, mask_threshold=0.5, target_sizes=[(H, W)],
        )[0]
        ms = int((time.perf_counter() - t) * 1000)
        masks_tensor = res.get("masks")
        scores_tensor = res.get("scores")
        if masks_tensor is None or len(masks_tensor) == 0:
            return SegmentationResult(
                mask=np.zeros((H, W), dtype=bool), iou_score=None, segmentation_ms=ms,
            )
        scores_list = scores_tensor.cpu().tolist() if scores_tensor is not None else []
        best_idx = int(np.argmax(scores_list)) if scores_list else 0
        iou_score = float(scores_list[best_idx]) if scores_list else None
        mask = masks_tensor[best_idx].cpu().numpy().astype(bool)
        while mask.ndim > 2:
            mask = mask[0]
        return SegmentationResult(mask=mask, iou_score=iou_score, segmentation_ms=ms)
