"""Pipeline orchestrator for the framing experiment (V1)."""
from __future__ import annotations
import time
from pathlib import Path

import numpy as np
import pyarrow as pa
import pyarrow.parquet as pq
import torch
from PIL import Image

from scripts.detect_subjects.caches import load_completed_pairs
from scripts.detect_subjects.rule_labeler import classify_framing, suggest_labels
from scripts.detect_subjects.config import (
    CLASSIFY_BUG_TOO_SMALL_EDGE_PX,
    CROPS_DIR,
    DATA_DIR,
    PARQUET_PATH,
    PARQUET_WRITE_BATCH,
    SCHEMA_VERSION,
)
from scripts.detect_subjects import config as cfg
from scripts.detect_subjects.crop import compute_crop_bbox, save_medium_and_thumb
from scripts.detect_subjects.detectors import make_detector
from scripts.detect_subjects.features import (
    compute_geometric_features,
    compute_mask_features,
    compute_subject_sharpness,
)
from scripts.detect_subjects.ground_truth import GroundTruthIndex, lookup_gt_bbox
from scripts.detect_subjects.metrics import iou_xywh_normalized
from scripts.detect_subjects.schema import (
    DetectionRow,
    SCHEMA,
    row_to_pyarrow_record,
)
from scripts.detect_subjects.segmenters import make_segmenter

V1_NAME = "grounding_dino__insectsam"   # legacy variant string (re-tagged from v1_dino_insectsam in pre-work T6 to match cfg.variant_tag() format)
# Future variants use cfg.variant_tag() instead. We keep V1_NAME tied to the
# legacy string so the existing parquet's variant column doesn't have to migrate
# during Phase 1. Phase 2 introduces a new variant_tag()-based string when SAM 3
# swap lands.


def _image_path_for(row: dict) -> Path:
    return DATA_DIR / row["filename"]


def _now_ms() -> int:
    return int(time.time() * 1000)


def _flush_records(records: list[dict], parquet_path: Path) -> None:
    """Append records to the parquet file via read-concat-rewrite."""
    new_table = pa.Table.from_pylist(records, schema=SCHEMA)
    if parquet_path.exists():
        existing = pq.read_table(parquet_path)
        combined = pa.concat_tables([existing, new_table])
    else:
        combined = new_table
    pq.write_table(combined, parquet_path, compression="snappy")


def run_v1_on_sample(
    sample_rows: list[dict],
    gt_index: GroundTruthIndex | None = None,
    parquet_path: Path = PARQUET_PATH,
    device: str = "mps",
    dtype: torch.dtype = torch.float32,
) -> dict:
    """Run V1 (DINO + InsectSAM) over every row in sample_rows."""
    completed = load_completed_pairs(parquet_path)
    to_process = [r for r in sample_rows
                  if (r["image_id"], cfg.variant_tag()) not in completed]
    print(f"[v1] {len(sample_rows)} total, {len(completed)} cached, "
          f"{len(to_process)} to process")

    detector = make_detector(cfg.DETECTOR_VARIANT, device=device, dtype=dtype)
    segmenter = make_segmenter(cfg.SEGMENTER_VARIANT, device=device, dtype=dtype)

    CROPS_DIR.joinpath(V1_NAME).mkdir(parents=True, exist_ok=True)

    pending_records: list[dict] = []
    summary = {"processed": 0, "errors": 0, "elapsed_s": 0.0}
    t_start = time.perf_counter()

    for i, row in enumerate(to_process):
        try:
            image_id = row["image_id"]
            source = row["source"]
            subject_state = row.get("subject_state") or "wild"
            img_path = _image_path_for(row)
            if not img_path.exists():
                print(f"[v1] WARN missing image {img_path}")
                continue

            with Image.open(img_path) as im:
                im = im.convert("RGB")
                W, H = im.size

                det = detector.detect(im, image_id=image_id)

                seg = None
                mask = None
                if det.bbox_xywh_normalized is not None:
                    seg = segmenter.segment_with_bbox(image_id, im,
                                                      det.bbox_xywh_normalized)
                    mask = seg.mask

                geom = compute_geometric_features(det.bbox_xywh_normalized, W, H)
                bbox_area = geom["bbox_area_ratio"]
                offc = geom["offcenter"]
                bbox_min_edge_px = geom["bbox_min_edge_px"]
                bbox_long_edge_px = geom["bbox_long_edge_px"]
                bbox_touches_edge = geom["bbox_touches_edge"]

                mask_iou = seg.iou_score if seg else None
                # rgb_np is needed for mask features and subject sharpness; build once.
                rgb_np = np.array(im) if det.bbox_xywh_normalized is not None else None
                mask_area = d_e = sharp = None
                if mask is not None and mask.any():
                    mf = compute_mask_features(mask, rgb_np)
                    mask_area = mf["mask_area_ratio"]
                    d_e = mf["lab_delta_e"]
                    sharp = mf["boundary_sharpness"]
                # Subject sharpness over the bbox region (Laplacian variance).
                # Unreliable on uniform-textured subjects — stored for future training data.
                subj_sharp = compute_subject_sharpness(
                    rgb_np, det.bbox_xywh_normalized, W, H,
                )

                crop_x = crop_y = crop_w = crop_h = None
                post_area = None
                if det.bbox_xywh_normalized is not None:
                    cd = compute_crop_bbox(
                        bbox_x=det.bbox_xywh_normalized[0],
                        bbox_y=det.bbox_xywh_normalized[1],
                        bbox_w=det.bbox_xywh_normalized[2],
                        bbox_h=det.bbox_xywh_normalized[3],
                        subject_state=subject_state,
                    )
                    crop_x, crop_y, crop_w, crop_h = (
                        cd.crop_x, cd.crop_y, cd.crop_w, cd.crop_h)
                    post_area = cd.post_crop_subject_area
                    # Skip saving the crop file when the bug fails the
                    # long-edge gate that classify uses for bug-too-small.
                    # The crop bbox is still stored in the row (informational)
                    # but no preview is written — a 200px-wide crop would just
                    # blur on a fullscreen draw view anyway.
                    long_edge_ok = (
                        bbox_long_edge_px is None
                        or bbox_long_edge_px >= CLASSIFY_BUG_TOO_SMALL_EDGE_PX
                    )
                    if not cd.skip and long_edge_ok:
                        save_medium_and_thumb(
                            im,
                            (crop_x, crop_y, crop_w, crop_h),
                            CROPS_DIR / V1_NAME / f"{image_id}.jpg",
                            CROPS_DIR / V1_NAME / f"{image_id}_thumb.jpg",
                        )

                suggested_labels = suggest_labels(
                    confidence=det.confidence,
                    bbox_area_ratio=bbox_area,
                    bbox_long_edge_px=bbox_long_edge_px,
                    n_distinct_detections=det.n_distinct_detections,
                    mask_area_ratio=mask_area,
                    lab_delta_e=d_e,
                    bbox_touches_edge=bbox_touches_edge,
                )
                quality = classify_framing(
                    confidence=det.confidence,
                    bbox_area_ratio=bbox_area,
                    bbox_long_edge_px=bbox_long_edge_px,
                    n_distinct_detections=det.n_distinct_detections,
                    mask_area_ratio=mask_area,
                    lab_delta_e=d_e,
                    bbox_touches_edge=bbox_touches_edge,
                )

                gt_bbox = lookup_gt_bbox(gt_index, image_id)
                gt_iou = None
                if gt_bbox is not None and det.bbox_xywh_normalized is not None:
                    gt_iou = iou_xywh_normalized(det.bbox_xywh_normalized, gt_bbox)

                # Convert distinct_subjects tuples → dicts for parquet struct storage
                distinct_subj_dicts = [
                    {"x": float(s[0]), "y": float(s[1]), "w": float(s[2]),
                     "h": float(s[3]), "conf": float(s[4]),
                     "phrase": s[5] if len(s) > 5 else None}
                    for s in (det.distinct_subjects or [])
                ]
                dr = DetectionRow(
                    image_id=image_id, source=source, variant=cfg.variant_tag(),
                    img_w=W, img_h=H, subject_state=subject_state,
                    n_raw_detections=det.n_raw_detections,
                    n_distinct_detections=det.n_distinct_detections,
                    bbox_x=det.bbox_xywh_normalized[0] if det.bbox_xywh_normalized else None,
                    bbox_y=det.bbox_xywh_normalized[1] if det.bbox_xywh_normalized else None,
                    bbox_w=det.bbox_xywh_normalized[2] if det.bbox_xywh_normalized else None,
                    bbox_h=det.bbox_xywh_normalized[3] if det.bbox_xywh_normalized else None,
                    confidence=det.confidence,
                    bbox_area_ratio=bbox_area, offcenter=offc,
                    mask_area_ratio=mask_area, mask_iou_score=mask_iou,
                    lab_delta_e=d_e, boundary_sharpness=sharp,
                    subject_sharpness=subj_sharp,
                    bbox_min_edge_px=bbox_min_edge_px,
                    bbox_long_edge_px=bbox_long_edge_px,
                    bbox_touches_edge=bbox_touches_edge,
                    crop_x=crop_x, crop_y=crop_y, crop_w=crop_w, crop_h=crop_h,
                    post_crop_subject_area=post_area,
                    framing_quality=quality,
                    suggested_labels=suggested_labels,
                    gt_bbox_x=gt_bbox[0] if gt_bbox else None,
                    gt_bbox_y=gt_bbox[1] if gt_bbox else None,
                    gt_bbox_w=gt_bbox[2] if gt_bbox else None,
                    gt_bbox_h=gt_bbox[3] if gt_bbox else None,
                    gt_iou=gt_iou,
                    detection_ms=det.detection_ms,
                    segmentation_ms=seg.segmentation_ms if seg else None,
                    detector_model=detector.model_id,
                    segmenter_model=segmenter.model_id,
                    processed_at=_now_ms(),
                    schema_version=SCHEMA_VERSION,
                    text_label=det.text_label,
                    text_label_score=det.text_label_score,
                    gate_decision=None,
                    distinct_subjects=distinct_subj_dicts,
                )
                pending_records.append(row_to_pyarrow_record(dr))

                if len(pending_records) >= PARQUET_WRITE_BATCH:
                    _flush_records(pending_records, parquet_path)
                    pending_records.clear()

                summary["processed"] += 1
                if (i + 1) % 25 == 0:
                    elapsed = time.perf_counter() - t_start
                    rate = (i + 1) / elapsed if elapsed > 0 else 0
                    print(f"[v1] {i+1}/{len(to_process)}  ({rate:.2f} img/s)")
        except Exception as e:
            summary["errors"] += 1
            print(f"[v1] ERROR on {row.get('image_id', '?')}: "
                  f"{type(e).__name__}: {e}")

    if pending_records:
        _flush_records(pending_records, parquet_path)
    summary["elapsed_s"] = time.perf_counter() - t_start
    return summary
