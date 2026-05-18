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
from scripts.detect_subjects.gate import decide_drawability
from scripts.detect_subjects.rule_labeler import (
    classify_framing,
    count_bugs_in_primary_bbox,
    suggest_labels,
)
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
    compute_top10pct_lap_masked,
    compute_edge_density_mask_vs_bg,
)
from scripts.detect_subjects.ground_truth import GroundTruthIndex, lookup_gt_bbox
from scripts.detect_subjects.metrics import iou_xywh_normalized
from scripts.detect_subjects.schema import (
    DetectionRow,
    SCHEMA,
    row_to_pyarrow_record,
)
from scripts.detect_subjects.segmenters import make_segmenter
from scripts.detect_subjects.prompt_builder import build_insect_prompt

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
    """Append records to the parquet file via read-concat-rewrite.

    Projects existing to the declared SCHEMA columns before cast + concat —
    drops any downstream-added cols (e.g. predict.py's predicted_* outputs)
    so schemas line up. Those cols are re-derived by running predict after
    classify finishes.
    """
    new_table = pa.Table.from_pylist(records, schema=SCHEMA)
    if parquet_path.exists():
        existing = pq.read_table(parquet_path)
        declared_names = [n for n in SCHEMA.names if n in existing.schema.names]
        existing = existing.select(declared_names)
        try:
            existing = existing.cast(SCHEMA)
        except Exception:
            pass  # if cast fails (e.g. type mismatch), let concat raise
        combined = pa.concat_tables([existing, new_table])
    else:
        combined = new_table
    pq.write_table(combined, parquet_path, compression="snappy")


def _build_record_for_image(
    row: dict,
    im: Image.Image,
    det,  # DetectionResult
    seg,  # SegmentationResult | None
    gt_index: GroundTruthIndex | None,
    detector,
    segmenter,
) -> dict:
    """Per-image post-detect work (CPU): features, crop, rule labels, gate
    decision, DetectionRow construction. Returns a parquet record dict.
    Pure of GPU; safe to call after batched inference.
    """
    image_id = row["image_id"]
    source = row["source"]
    subject_state = row.get("subject_state") or "wild"
    W, H = im.width, im.height
    mask = seg.mask if seg is not None else None

    geom = compute_geometric_features(det.bbox_xywh_normalized, W, H)
    bbox_area = geom["bbox_area_ratio"]
    offc = geom["offcenter"]
    bbox_min_edge_px = geom["bbox_min_edge_px"]
    bbox_long_edge_px = geom["bbox_long_edge_px"]
    bbox_touches_edge = geom["bbox_touches_edge"]

    mask_iou = seg.iou_score if seg else None
    rgb_np = np.array(im) if det.bbox_xywh_normalized is not None else None
    mask_area = d_e = sharp = None
    if mask is not None and mask.any():
        mf = compute_mask_features(mask, rgb_np)
        mask_area = mf["mask_area_ratio"]
        d_e = mf["lab_delta_e"]
        sharp = mf["boundary_sharpness"]
    subj_sharp = compute_subject_sharpness(rgb_np, det.bbox_xywh_normalized, W, H, mask=mask)
    top10_lap_mask = compute_top10pct_lap_masked(rgb_np, mask)
    edge_dens_ratio = compute_edge_density_mask_vs_bg(
        rgb_np, mask, det.bbox_xywh_normalized, W, H,
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
        crop_x, crop_y, crop_w, crop_h = (cd.crop_x, cd.crop_y, cd.crop_w, cd.crop_h)
        post_area = cd.post_crop_subject_area
        long_edge_ok = (
            bbox_long_edge_px is None
            or bbox_long_edge_px >= CLASSIFY_BUG_TOO_SMALL_EDGE_PX
        )
        if not cd.skip and long_edge_ok:
            save_medium_and_thumb(
                im, (crop_x, crop_y, crop_w, crop_h),
                CROPS_DIR / V1_NAME / f"{image_id}.jpg",
                CROPS_DIR / V1_NAME / f"{image_id}_thumb.jpg",
            )

    if det.bbox_xywh_normalized is not None:
        n_in_primary = count_bugs_in_primary_bbox(
            det.bbox_xywh_normalized, det.distinct_subjects or [],
        )
    else:
        n_in_primary = 0
    suggested_labels = suggest_labels(
        confidence=det.confidence, bbox_area_ratio=bbox_area,
        bbox_long_edge_px=bbox_long_edge_px,
        n_distinct_detections=det.n_distinct_detections,
        n_in_primary_bbox=n_in_primary, mask_area_ratio=mask_area,
        lab_delta_e=d_e, bbox_touches_edge=bbox_touches_edge,
    )
    quality = classify_framing(
        confidence=det.confidence, bbox_area_ratio=bbox_area,
        bbox_long_edge_px=bbox_long_edge_px,
        n_distinct_detections=det.n_distinct_detections,
        n_in_primary_bbox=n_in_primary, mask_area_ratio=mask_area,
        lab_delta_e=d_e, bbox_touches_edge=bbox_touches_edge,
    )
    _bbox_content_count = "bbox-content_single"
    _bbox_too_small = False
    _bbox_img_multibug = False
    for lbl in suggested_labels:
        if lbl == "bbox-content_no-bug":
            _bbox_content_count = "bbox-content_no-bug"
        elif lbl == "bbox-content_bbox-multibug_unusable":
            _bbox_content_count = "bbox-content_bbox-multibug_unusable"
        elif lbl == "bbox-content_subject-too-small":
            _bbox_too_small = True
        elif lbl == "bbox-content_image-multi-bug":
            _bbox_img_multibug = True
    gate_decision_str = decide_drawability({
        "bbox": "bbox_correct-subject_not-clipped",
        "bbox_content_count": _bbox_content_count,
        "bbox_too_small": _bbox_too_small,
        "mask_labels": [], "ml_labels": [],
        "bbox_content_image_multi_bug": _bbox_img_multibug,
    }).value

    gt_bbox = lookup_gt_bbox(gt_index, image_id)
    gt_iou = None
    if gt_bbox is not None and det.bbox_xywh_normalized is not None:
        gt_iou = iou_xywh_normalized(det.bbox_xywh_normalized, gt_bbox)

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
        top10pct_lap_mask=top10_lap_mask,
        edge_density_mask_vs_bg=edge_dens_ratio,
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
        gate_decision=gate_decision_str,
        distinct_subjects=distinct_subj_dicts,
    )
    return row_to_pyarrow_record(dr)


def _run_batched_loop(
    to_process: list[dict], detector, segmenter,
    gt_index, parquet_path: Path, batch_size: int,
) -> dict:
    """Batched SAM3 inference: chunk inputs into BATCH_SIZE groups, run
    detect_batch then segment_batch over each chunk, build records per-image.
    GPU savings come from one model.forward() per chunk instead of N.
    """
    from PIL import Image as PILImage
    pending_records: list[dict] = []
    summary = {"processed": 0, "errors": 0, "elapsed_s": 0.0}
    t_start = time.perf_counter()
    n_total = len(to_process)

    for chunk_start in range(0, n_total, batch_size):
        chunk_rows = to_process[chunk_start:chunk_start + batch_size]
        # Phase A: load images (cheap; serial is fine but ThreadPool could help)
        loaded: list[tuple[dict, PILImage.Image]] = []
        for row in chunk_rows:
            path = _image_path_for(row)
            if not path.exists():
                print(f"[v1] WARN missing image {path}")
                continue
            try:
                with PILImage.open(path) as raw:
                    im = raw.convert("RGB")  # decouples from file handle
                loaded.append((row, im))
            except Exception as e:
                summary["errors"] += 1
                print(f"[v1] LOAD ERROR on {row.get('image_id', '?')}: "
                      f"{type(e).__name__}: {e}")
        if not loaded:
            continue

        images = [d[1] for d in loaded]
        ids = [d[0]["image_id"] for d in loaded]

        # Phase B: batched detect
        try:
            detections = detector.detect_batch(images, ids)
        except Exception as e:
            summary["errors"] += len(loaded)
            print(f"[v1] DETECT_BATCH ERROR on chunk: {type(e).__name__}: {e}")
            continue

        # Phase C: batched segment (only for cards with a bbox)
        seg_indices = [i for i, d in enumerate(detections) if d.bbox_xywh_normalized is not None]
        seg_map: dict[int, object] = {}
        if seg_indices:
            seg_images = [images[i] for i in seg_indices]
            seg_ids = [ids[i] for i in seg_indices]
            seg_bboxes = [detections[i].bbox_xywh_normalized for i in seg_indices]
            try:
                seg_results = segmenter.segment_batch(seg_ids, seg_images, seg_bboxes)
                for k, idx in enumerate(seg_indices):
                    seg_map[idx] = seg_results[k]
            except Exception as e:
                # segment_batch already has internal fallback; if it still raised
                # we treat the whole chunk's segments as empty (record still built)
                print(f"[v1] SEGMENT_BATCH ERROR on chunk: {type(e).__name__}: {e}")

        # Phase D: per-image post-processing (CPU, sequential)
        for j, ((row, im), det) in enumerate(zip(loaded, detections)):
            seg = seg_map.get(j)
            try:
                rec = _build_record_for_image(
                    row, im, det, seg, gt_index, detector, segmenter,
                )
                pending_records.append(rec)
                summary["processed"] += 1
            except Exception as e:
                summary["errors"] += 1
                print(f"[v1] BUILD ERROR on {row.get('image_id', '?')}: "
                      f"{type(e).__name__}: {e}")

        if len(pending_records) >= PARQUET_WRITE_BATCH:
            _flush_records(pending_records, parquet_path)
            pending_records.clear()

        done = chunk_start + len(loaded)
        if done % 25 < batch_size:  # rough alignment to existing print cadence
            elapsed = time.perf_counter() - t_start
            rate = done / elapsed if elapsed > 0 else 0
            print(f"[v1] {done}/{n_total}  ({rate:.2f} img/s, batched x{batch_size})")

    if pending_records:
        _flush_records(pending_records, parquet_path)
    summary["elapsed_s"] = time.perf_counter() - t_start
    return summary


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

    # Build DB-driven prompt phrases. The full ordered list is kept for lineage /
    # GroundingDINO use, but for sam3 we override with ["an insect"] because
    # multi-phrase prompts dilute SAM 3's scene-level presence gate (see
    # docs/sam3_prompt_investigation.md). Sam3Detector also enforces this as
    # its default, but we override here explicitly so the prompt version we
    # log matches what the model actually sees.
    full_prompt_phrases, prompt_version = build_insect_prompt(DATA_DIR / "db" / "line-of-bugs.db")
    if cfg.DETECTOR_VARIANT == "sam3":
        prompt_phrases = ["an insect"]
        print(f"[v1] sam3 prompt: 1 phrase ('an insect'); full lookup had "
              f"{len(full_prompt_phrases)} phrases, version={prompt_version}")
    else:
        prompt_phrases = full_prompt_phrases
        print(f"[v1] prompt_builder: {len(prompt_phrases)} phrases, version={prompt_version}")

    detector = make_detector(cfg.DETECTOR_VARIANT, device=device, dtype=dtype,
                             prompt_phrases=prompt_phrases)
    segmenter = make_segmenter(cfg.SEGMENTER_VARIANT, device=device, dtype=dtype)

    CROPS_DIR.joinpath(V1_NAME).mkdir(parents=True, exist_ok=True)

    # Batched dispatch when both wrappers support it AND batch_size > 1. The
    # batched code path is correctness-verified (real bboxes + masks) but
    # speedup vs sequential on M5 Max unified-memory is not yet benchmarked
    # in isolation — preliminary measurements during GPU contention suggested
    # it may actually be slower than sequential on this hardware. Set
    # DETECT_BATCH_SIZE in config.py to >1 to opt in.
    from scripts.detect_subjects.config import DETECT_BATCH_SIZE
    if (DETECT_BATCH_SIZE > 1
            and hasattr(detector, "detect_batch")
            and hasattr(segmenter, "segment_batch")):
        print(f"[v1] using batched inference, batch_size={DETECT_BATCH_SIZE}")
        return _run_batched_loop(
            to_process, detector, segmenter, gt_index, parquet_path,
            batch_size=DETECT_BATCH_SIZE,
        )

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
                # Subject sharpness — schema v2: mask-restricted Laplacian variance
                # (was bbox-only). Mask-restriction empirically beats bbox-only
                # at separating user-labeled blur (Youden-J 0.43 vs 0.37) by
                # excluding blurred-DOF background pixels. Falls back to bbox-
                # only when no mask is available.
                subj_sharp = compute_subject_sharpness(
                    rgb_np, det.bbox_xywh_normalized, W, H, mask=mask,
                )
                # Additional ML labeler training inputs (schema v2)
                top10_lap_mask = compute_top10pct_lap_masked(rgb_np, mask)
                edge_dens_ratio = compute_edge_density_mask_vs_bg(
                    rgb_np, mask, det.bbox_xywh_normalized, W, H,
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

                # Phase 2a: count bug centers inside the primary bbox
                # (drives bbox-content_bbox-multibug_unusable rule).
                if det.bbox_xywh_normalized is not None:
                    n_in_primary = count_bugs_in_primary_bbox(
                        det.bbox_xywh_normalized,
                        det.distinct_subjects or [],
                    )
                else:
                    n_in_primary = 0
                suggested_labels = suggest_labels(
                    confidence=det.confidence,
                    bbox_area_ratio=bbox_area,
                    bbox_long_edge_px=bbox_long_edge_px,
                    n_distinct_detections=det.n_distinct_detections,
                    n_in_primary_bbox=n_in_primary,
                    mask_area_ratio=mask_area,
                    lab_delta_e=d_e,
                    bbox_touches_edge=bbox_touches_edge,
                )
                quality = classify_framing(
                    confidence=det.confidence,
                    bbox_area_ratio=bbox_area,
                    bbox_long_edge_px=bbox_long_edge_px,
                    n_distinct_detections=det.n_distinct_detections,
                    n_in_primary_bbox=n_in_primary,
                    mask_area_ratio=mask_area,
                    lab_delta_e=d_e,
                    bbox_touches_edge=bbox_touches_edge,
                )

                # Phase 2a: compute drawability gate decision from rule-labeler output.
                # Column 1 (bbox quality) is human-only; assume gate-pass default
                # until the user reviews. Mask/ML labels not yet emitted in Phase 2a.
                _bbox_content_count = "bbox-content_single"
                _bbox_too_small = False
                _bbox_img_multibug = False
                for lbl in suggested_labels:
                    if lbl == "bbox-content_no-bug":
                        _bbox_content_count = "bbox-content_no-bug"
                    elif lbl == "bbox-content_bbox-multibug_unusable":
                        _bbox_content_count = "bbox-content_bbox-multibug_unusable"
                    elif lbl == "bbox-content_subject-too-small":
                        _bbox_too_small = True
                    elif lbl == "bbox-content_image-multi-bug":
                        _bbox_img_multibug = True
                gate_decision_str = decide_drawability({
                    "bbox": "bbox_correct-subject_not-clipped",
                    "bbox_content_count": _bbox_content_count,
                    "bbox_too_small": _bbox_too_small,
                    "mask_labels": [],
                    "ml_labels": [],
                    "bbox_content_image_multi_bug": _bbox_img_multibug,
                }).value

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
                    top10pct_lap_mask=top10_lap_mask,
                    edge_density_mask_vs_bg=edge_dens_ratio,
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
                    gate_decision=gate_decision_str,
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

    # Sync the parquet's per-row detections into SQLite for the production
    # gate. Latest-variant-wins; idempotent if no parquet rows changed.
    try:
        from scripts.detect_subjects.detections_sync import sync_detections_from_parquet
        sync_result = sync_detections_from_parquet(parquet_path)
        summary["sqlite_detections_upserted"] = sync_result["upserted"]
    except Exception as e:
        # Don't fail the whole classify run on a sync hiccup — the parquet
        # is still good and a manual rerun of sync_detections will recover.
        print(f"[v1] WARN detections sync failed: {type(e).__name__}: {e}")
        summary["sqlite_detections_upserted"] = -1

    return summary
