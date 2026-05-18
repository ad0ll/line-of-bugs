"""SAM 3 segmenter wrapper (bbox-prompted mode) implementing the Segmenter Protocol.

API notes from probe (2026-05-16):
- Box-prompted: processor(images=..., input_boxes=[[[x1,y1,x2,y2]]], ...) — 3 levels,
  pixel xyxy coords. Processor normalizes to [0,1] internally.
- text auto-resolves to "visual" when only input_boxes provided (no explicit text needed)
- post_process_instance_segmentation returns {scores, boxes, masks} — use lowest threshold
  to get the prompted region's mask; pick the highest-scoring detection
- iou_scores not available in SAM 3; use detection score as proxy

Disk cache: same trust profile as Sam3Detector's cache —
  key = sha1(model_id + bbox_str)[:10] — invalidates on model swap and bbox
  changes (the realistic cases). Does NOT auto-invalidate on HF re-upload of
  same model_id or on changes to wrapper post-processing constants; manually
  delete the cache dir if you change those. Same risk Detector already lives
  with for its JSON cache.
"""
from __future__ import annotations
import hashlib
import os
import tempfile
import time

import numpy as np
import torch
from PIL import Image

from scripts.detect_subjects._sam3_shared import get_shared_sam3
from scripts.detect_subjects.config import CACHE_DIR
from scripts.detect_subjects.interfaces import SegmentationResult

SAM3_MASK_CACHE_DIR = CACHE_DIR / "sam3_masks"
SAM3_MASK_CACHE_DIR.mkdir(parents=True, exist_ok=True)


def _sam3_mask_cache_key(model_id: str, bbox: tuple[float, float, float, float]) -> str:
    bbox_str = f"{bbox[0]:.6f},{bbox[1]:.6f},{bbox[2]:.6f},{bbox[3]:.6f}"
    return hashlib.sha1(f"{model_id}|{bbox_str}".encode()).hexdigest()[:10]


def _save_mask_atomic(path, mask: np.ndarray, iou_score) -> None:
    """Atomic write: tempfile in same dir + rename. Avoids corruption if two
    processes race to write the same cache file (single-user dev, but
    backfill + pipeline could in theory overlap)."""
    iou_v = float(iou_score) if iou_score is not None else -1.0
    fd, tmp_path = tempfile.mkstemp(
        dir=str(path.parent), prefix=path.name + ".", suffix=".tmp",
    )
    try:
        with os.fdopen(fd, "wb") as f:
            np.savez_compressed(f, mask=mask, iou_score=np.array([iou_v]))
        os.replace(tmp_path, path)
    except Exception:
        try: os.unlink(tmp_path)
        except FileNotFoundError: pass
        raise


def _load_mask(path) -> tuple[np.ndarray, float | None] | None:
    try:
        data = np.load(path)
        mask = data["mask"].astype(bool)
        iou = float(data["iou_score"][0])
        return mask, (iou if iou >= 0 else None)
    except Exception:
        return None  # corrupt / unreadable — treat as miss


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
        SegmentationResult in input order. Disk-cached per (image_id, bbox)
        so re-runs (backfills, feature recomputations) skip the GPU entirely.
        Batched call only processes cache misses.

        On batched-inference failure, retries each item individually so one
        bad image doesn't sink the batch.
        """
        n = len(images)
        if n == 0:
            return []
        if not (n == len(image_ids) == len(bboxes_xywh_normalized)):
            raise ValueError("segment_batch: input lists must be same length")

        # Phase 1: cache check
        cached_results: dict[int, SegmentationResult] = {}
        cache_paths: list = []
        for i, (iid, bbox) in enumerate(zip(image_ids, bboxes_xywh_normalized)):
            key = _sam3_mask_cache_key(self.model_id, bbox)
            cp = SAM3_MASK_CACHE_DIR / f"{iid}__{key}.npz"
            cache_paths.append(cp)
            if cp.exists():
                loaded = _load_mask(cp)
                if loaded is not None:
                    mask, iou = loaded
                    cached_results[i] = SegmentationResult(
                        mask=mask, iou_score=iou, segmentation_ms=0,
                    )

        # If every input is cached, skip GPU entirely.
        miss_indices = [i for i in range(n) if i not in cached_results]
        if not miss_indices:
            return [cached_results[i] for i in range(n)]

        # Convert normalized xywh → pixel xyxy per image (miss-only)
        input_boxes = []
        miss_images = []
        target_sizes = []
        for i in miss_indices:
            img = images[i]
            x, y, w, h = bboxes_xywh_normalized[i]
            W, H = img.width, img.height
            x1, y1 = x * W, y * H
            x2, y2 = (x + w) * W, (y + h) * H
            input_boxes.append([[x1, y1, x2, y2]])
            miss_images.append(img)
            target_sizes.append((H, W))

        t_batch = time.perf_counter()

        try:
            inputs = self.processor(
                images=miss_images, input_boxes=input_boxes, return_tensors="pt",
            ).to(self.device)
            if "pixel_values" in inputs:
                inputs["pixel_values"] = inputs["pixel_values"].to(self.dtype)
            outputs = self.model(**inputs)
            results_per_image = self.processor.post_process_instance_segmentation(
                outputs, threshold=0.05, mask_threshold=0.5, target_sizes=target_sizes,
            )
        except Exception as e:
            # Batched call failed — fall back to per-image so one bad image doesn't
            # poison the whole batch. Per-image path also caches via segment_with_bbox.
            print(f"[sam3-seg-batch] batched call failed ({type(e).__name__}: {e}); "
                  f"falling back to per-image for this chunk")
            miss_results: dict[int, SegmentationResult] = {}
            for j, i in enumerate(miss_indices):
                try:
                    sr = self._segment_single_inline(
                        image_ids[i], miss_images[j], bboxes_xywh_normalized[i],
                    )
                except Exception as inner:
                    print(f"[sam3-seg] {image_ids[i]} also failed singly: {inner}; empty mask")
                    sr = SegmentationResult(
                        mask=np.zeros((miss_images[j].height, miss_images[j].width), dtype=bool),
                        iou_score=None,
                        segmentation_ms=0,
                    )
                miss_results[i] = sr
                # Cache successful fallback results (skip the empty-mask error case)
                if sr.mask is not None and sr.mask.any():
                    try:
                        _save_mask_atomic(cache_paths[i], sr.mask, sr.iou_score)
                    except Exception:
                        pass  # best-effort cache write
            return [cached_results.get(i) or miss_results[i] for i in range(n)]

        batch_ms = int((time.perf_counter() - t_batch) * 1000)
        per_image_ms = max(1, batch_ms // len(miss_indices))

        miss_results: dict[int, SegmentationResult] = {}
        for j, (i, res) in enumerate(zip(miss_indices, results_per_image)):
            img = miss_images[j]
            W, H = img.width, img.height
            masks_tensor = res.get("masks")
            scores_tensor = res.get("scores")
            if masks_tensor is None or len(masks_tensor) == 0:
                miss_results[i] = SegmentationResult(
                    mask=np.zeros((H, W), dtype=bool),
                    iou_score=None,
                    segmentation_ms=per_image_ms,
                )
                continue
            scores_list = scores_tensor.cpu().tolist() if scores_tensor is not None else []
            best_idx = int(np.argmax(scores_list)) if scores_list else 0
            iou_score = float(scores_list[best_idx]) if scores_list else None
            mask_raw = masks_tensor[best_idx].cpu()
            mask = mask_raw.numpy().astype(bool)
            while mask.ndim > 2:
                mask = mask[0]
            miss_results[i] = SegmentationResult(
                mask=mask, iou_score=iou_score, segmentation_ms=per_image_ms,
            )
            # Cache the freshly-computed mask
            if mask.any():
                try:
                    _save_mask_atomic(cache_paths[i], mask, iou_score)
                except Exception:
                    pass

        return [cached_results.get(i) or miss_results[i] for i in range(n)]

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
