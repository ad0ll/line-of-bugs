"""CropPlanner — compute proposed crop bbox + render preview JPEGs."""
from __future__ import annotations
import math
from dataclasses import dataclass
from pathlib import Path

from PIL import Image

from scripts.detect_subjects.config import (
    CROP_SKIP_IF_AREA_ABOVE,
    CROP_TARGET_AREA_NATURE,
    CROP_TARGET_AREA_SPECIMEN,
    CROP_MEDIUM_MAX_EDGE,
    CROP_MEDIUM_QUALITY,
    CROP_THUMB_MAX_EDGE,
    CROP_THUMB_QUALITY,
    CLASSIFY_HIDDEN_AREA,
)


@dataclass(slots=True)
class CropDecision:
    skip: bool
    skip_reason: str | None
    crop_x: float
    crop_y: float
    crop_w: float
    crop_h: float
    post_crop_subject_area: float


def _target_area_for(subject_state: str) -> float:
    if subject_state == "specimen":
        return CROP_TARGET_AREA_SPECIMEN
    return CROP_TARGET_AREA_NATURE


def compute_crop_bbox(
    bbox_x: float, bbox_y: float, bbox_w: float, bbox_h: float,
    subject_state: str,
) -> CropDecision:
    """Compute crop bbox so the subject fills `target` fraction of the crop."""
    bbox_area = bbox_w * bbox_h

    if min(bbox_w, bbox_h) >= CROP_SKIP_IF_AREA_ABOVE:
        return CropDecision(
            skip=True, skip_reason="already_well_framed",
            crop_x=0.0, crop_y=0.0, crop_w=1.0, crop_h=1.0,
            post_crop_subject_area=bbox_area,
        )
    if bbox_area < CLASSIFY_HIDDEN_AREA:
        return CropDecision(
            skip=True, skip_reason="subject_too_small",
            crop_x=0.0, crop_y=0.0, crop_w=1.0, crop_h=1.0,
            post_crop_subject_area=bbox_area,
        )

    target = _target_area_for(subject_state)
    pad = math.sqrt(1.0 / target)
    crop_w = min(1.0, bbox_w * pad)
    crop_h = min(1.0, bbox_h * pad)
    bbox_cx = bbox_x + bbox_w / 2.0
    bbox_cy = bbox_y + bbox_h / 2.0
    crop_x = max(0.0, min(1.0 - crop_w, bbox_cx - crop_w / 2.0))
    crop_y = max(0.0, min(1.0 - crop_h, bbox_cy - crop_h / 2.0))

    post_subject_area = bbox_area / (crop_w * crop_h) if crop_w * crop_h > 0 else 0.0

    return CropDecision(
        skip=False, skip_reason=None,
        crop_x=crop_x, crop_y=crop_y, crop_w=crop_w, crop_h=crop_h,
        post_crop_subject_area=post_subject_area,
    )


def apply_crop_and_save(
    image: Image.Image,
    crop_xywh_normalized: tuple[float, float, float, float],
    out_path: Path,
    max_edge: int,
    quality: int,
) -> None:
    """Crop a full-res PIL image by normalized bbox, resize, save JPEG."""
    cx, cy, cw, ch = crop_xywh_normalized
    W, H = image.size
    left = int(round(cx * W))
    top = int(round(cy * H))
    right = int(round((cx + cw) * W))
    bottom = int(round((cy + ch) * H))
    cropped = image.crop((left, top, right, bottom))
    if max(cropped.size) > max_edge:
        cropped.thumbnail((max_edge, max_edge), Image.Resampling.LANCZOS)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    cropped.save(out_path, format="JPEG", quality=quality, optimize=True)


def save_medium_and_thumb(
    image: Image.Image,
    crop_xywh_normalized: tuple[float, float, float, float],
    medium_path: Path,
    thumb_path: Path,
) -> None:
    """Convenience: save both 1024px medium and 512px thumb variants."""
    apply_crop_and_save(image, crop_xywh_normalized, medium_path,
                        max_edge=CROP_MEDIUM_MAX_EDGE, quality=CROP_MEDIUM_QUALITY)
    apply_crop_and_save(image, crop_xywh_normalized, thumb_path,
                        max_edge=CROP_THUMB_MAX_EDGE, quality=CROP_THUMB_QUALITY)
