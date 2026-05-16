"""InsectSAM segmenter wrapper — SAM fine-tuned on insect imagery.

Caches the image embedding per image_id so that re-prompting the same image
with a different bbox is cheap.

Reference: https://huggingface.co/martintomov/InsectSAM
"""
from __future__ import annotations
import time
from dataclasses import dataclass
from typing import Optional

from pathlib import Path

import numpy as np
import torch
from PIL import Image
from transformers import SamModel, SamProcessor

from scripts.detect_subjects.config import CACHE_DIR, INSECTSAM_MODEL_ID


SAM_EMBED_DIR = CACHE_DIR / "sam_embed"
SAM_EMBED_DIR.mkdir(parents=True, exist_ok=True)


@dataclass(slots=True)
class SegmentationResult:
    mask: Optional[np.ndarray]
    iou_score: Optional[float]
    segmentation_ms: int


class InsectSAMSegmenter:
    model_id: str = INSECTSAM_MODEL_ID  # written to parquet rows; survives variant swaps

    def __init__(self, device: str = "mps", dtype: torch.dtype = torch.float32) -> None:
        self.device = device
        self.dtype = dtype
        self.processor = SamProcessor.from_pretrained(INSECTSAM_MODEL_ID)
        self.model = SamModel.from_pretrained(
            INSECTSAM_MODEL_ID
        ).to(device=self.device, dtype=self.dtype)
        self.model.eval()
        self._embedding_cache: dict[str, torch.Tensor] = {}

    @torch.no_grad()
    def _get_image_embedding(self, image_id: str, image: Image.Image) -> torch.Tensor:
        # In-memory cache (intra-run, e.g. multiple prompts per image)
        if image_id in self._embedding_cache:
            return self._embedding_cache[image_id]
        # Disk cache (cross-run): skip the heavy ViT encoder pass.
        disk_path = SAM_EMBED_DIR / f"{image_id}.npy"
        if disk_path.exists():
            try:
                arr = np.load(disk_path)
                embed = torch.from_numpy(arr).to(self.device, dtype=self.dtype)
                self._embedding_cache[image_id] = embed
                return embed
            except Exception:
                pass  # fall through to recompute

        inputs = self.processor(images=image, return_tensors="pt")
        for k, v in list(inputs.items()):
            if isinstance(v, torch.Tensor) and v.dtype == torch.float64:
                inputs[k] = v.to(torch.float32)
        inputs = inputs.to(self.device)
        if "pixel_values" in inputs:
            inputs["pixel_values"] = inputs["pixel_values"].to(self.dtype)
        embed = self.model.get_image_embeddings(inputs["pixel_values"])
        self._embedding_cache[image_id] = embed
        try:
            np.save(disk_path, embed.detach().cpu().float().numpy())
        except Exception:
            pass  # best-effort
        return embed

    def clear_cache(self) -> None:
        self._embedding_cache.clear()

    @torch.no_grad()
    def segment_with_bbox(
        self,
        image_id: str,
        image: Image.Image,
        bbox_xywh_normalized: tuple[float, float, float, float],
    ) -> SegmentationResult:
        start = time.perf_counter()
        x, y, w, h = bbox_xywh_normalized
        x1 = x * image.width
        y1 = y * image.height
        x2 = (x + w) * image.width
        y2 = (y + h) * image.height
        input_boxes = [[[x1, y1, x2, y2]]]

        inputs = self.processor(
            images=image, input_boxes=input_boxes, return_tensors="pt"
        )
        # MPS doesn't support float64. The SAM processor returns input_boxes
        # as float64 by default; cast all float tensors to F32 before .to(mps).
        for k, v in list(inputs.items()):
            if isinstance(v, torch.Tensor) and v.dtype == torch.float64:
                inputs[k] = v.to(torch.float32)
        inputs = inputs.to(self.device)
        if "pixel_values" in inputs:
            inputs["pixel_values"] = inputs["pixel_values"].to(self.dtype)

        image_embed = self._get_image_embedding(image_id, image)

        outputs = self.model(
            image_embeddings=image_embed,
            input_boxes=inputs["input_boxes"],
            multimask_output=True,
        )

        masks = self.processor.image_processor.post_process_masks(
            outputs.pred_masks.cpu(),
            inputs["original_sizes"].cpu(),
            inputs["reshaped_input_sizes"].cpu(),
        )
        candidates = masks[0][0]
        scores = outputs.iou_scores[0, 0].cpu().tolist()
        if len(candidates) == 0:
            elapsed_ms = int((time.perf_counter() - start) * 1000)
            return SegmentationResult(mask=None, iou_score=None,
                                       segmentation_ms=elapsed_ms)
        best_idx = int(np.argmax(scores))
        mask = candidates[best_idx].numpy().astype(bool)

        elapsed_ms = int((time.perf_counter() - start) * 1000)
        return SegmentationResult(
            mask=mask,
            iou_score=float(scores[best_idx]),
            segmentation_ms=elapsed_ms,
        )
