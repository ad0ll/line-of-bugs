"""Phase A: 10-point sanity gate.

Runs each model on 5 sample images. Reports per-gate pass/fail with
concrete diagnostics. Exit code 0 if all gates pass, 1 otherwise.
"""
from __future__ import annotations
import time
from pathlib import Path

import psutil
import pyarrow as pa
import pyarrow.parquet as pq
from PIL import Image

from scripts.detect_subjects.config import (
    DATA_DIR,
    RANDOM_SEED,
    SAMPLE_PARQUET_PATH,
)
from scripts.detect_subjects.crop import save_medium_and_thumb
from scripts.detect_subjects.data import load_manifest_rows, pick_stratified_sample
from scripts.detect_subjects.detector_dino import GroundingDinoDetector
from scripts.detect_subjects.schema import (
    SCHEMA, DetectionRow, row_to_pyarrow_record,
)
from scripts.detect_subjects.segmenter_insectsam import InsectSAMSegmenter


def _color(s: str, c: str) -> str:
    codes = {"green": "\033[32m", "red": "\033[31m",
             "yellow": "\033[33m", "reset": "\033[0m"}
    return f"{codes.get(c, '')}{s}{codes['reset']}"


def _ok(msg: str) -> None:
    print(_color("  \u2713 " + msg, "green"))


def _fail(msg: str) -> None:
    print(_color("  \u2717 " + msg, "red"))


def _warn(msg: str) -> None:
    print(_color("  \u26a0 " + msg, "yellow"))


def run_smoke_benchmark() -> int:
    print("\n=== Phase A: framing detector smoke benchmark ===\n")
    failures = 0

    if SAMPLE_PARQUET_PATH.exists():
        import polars as pl
        sample = pl.read_parquet(SAMPLE_PARQUET_PATH).head(5).to_dicts()
    else:
        rows = load_manifest_rows()
        sample = pick_stratified_sample(rows, seed=RANDOM_SEED)[:5]

    if not sample:
        _fail("no sample images available")
        return 1

    print(f"Sample: {len(sample)} images")
    for r in sample:
        print(f"  {r['image_id']} ({r['source']})")
    print()

    print("Gate 1: model load")
    rss_before = psutil.Process().memory_info().rss / 1e9
    t0 = time.perf_counter()
    try:
        detector = GroundingDinoDetector()
        segmenter = InsectSAMSegmenter()
        load_time = time.perf_counter() - t0
        rss_after = psutil.Process().memory_info().rss / 1e9
        _ok(f"both models loaded in {load_time:.1f}s; "
            f"RSS {rss_before:.1f}\u2192{rss_after:.1f} GB")
        if rss_after - rss_before > 16:
            _warn(f"memory growth {rss_after - rss_before:.1f} GB > 16 GB threshold")
    except Exception as e:
        _fail(f"model load failed: {type(e).__name__}: {e}")
        return 1

    print("Gate 3: device assignment")
    dev = next(detector.model.parameters()).device
    if str(dev).startswith("mps"):
        _ok(f"DINO on {dev}")
    else:
        _warn(f"DINO on {dev} (expected mps); will be slow")
    dev2 = next(segmenter.model.parameters()).device
    if str(dev2).startswith("mps"):
        _ok(f"InsectSAM on {dev2}")
    else:
        _warn(f"InsectSAM on {dev2} (expected mps); will be slow")

    print("Gate 4-7: first-batch sanity (5 images)")
    n_valid_bbox = 0
    n_valid_mask = 0
    n_in_range_conf = 0
    confidence_list = []
    for r in sample:
        img_path = DATA_DIR / r["filename"]
        if not img_path.exists():
            _warn(f"missing image: {img_path}")
            continue
        with Image.open(img_path) as im:
            im = im.convert("RGB")
            det = detector.detect(im)
            if det.bbox_xywh_normalized is not None:
                x, y, w, h = det.bbox_xywh_normalized
                if 0 <= x <= 1 and 0 <= y <= 1 and 0 < w <= 1 and 0 < h <= 1:
                    n_valid_bbox += 1
                if det.confidence is not None:
                    confidence_list.append(det.confidence)
                    if 0.05 < det.confidence < 0.99:
                        n_in_range_conf += 1
                seg = segmenter.segment_with_bbox(
                    r["image_id"], im, det.bbox_xywh_normalized)
                if seg.mask is not None and seg.mask.any():
                    n_valid_mask += 1

    if n_valid_bbox >= 4:
        _ok(f"Gate 4: {n_valid_bbox}/5 images got a valid bbox")
    else:
        _fail(f"Gate 4: only {n_valid_bbox}/5 valid bboxes (expected \u22654)")
        failures += 1
    if confidence_list:
        avg_conf = sum(confidence_list) / len(confidence_list)
        if 0.05 < avg_conf < 0.99 and n_in_range_conf >= 3:
            _ok(f"Gate 5: confidence range plausible "
                f"(avg {avg_conf:.2f}, {n_in_range_conf}/5 in [0.05, 0.99])")
        else:
            _fail(f"Gate 5: suspicious confidence: avg {avg_conf:.2f}, "
                  f"{n_in_range_conf}/5 in range")
            failures += 1
    else:
        _fail("Gate 5: no confidences recorded")
        failures += 1
    if n_valid_mask >= 3:
        _ok(f"Gate 7: {n_valid_mask}/5 valid masks")
    else:
        _fail(f"Gate 7: only {n_valid_mask}/5 valid masks (expected \u22653)")
        failures += 1

    print("Gate 8: parquet write/read roundtrip")
    try:
        dr = DetectionRow(
            image_id="smoke-1", source="test", variant="smoke",
            img_w=100, img_h=100, subject_state="wild",
            n_raw_detections=1, n_distinct_detections=1,
            bbox_x=0.25, bbox_y=0.25, bbox_w=0.25, bbox_h=0.25,
            confidence=0.8, bbox_area_ratio=0.0625, offcenter=0.0,
            mask_area_ratio=0.05, mask_iou_score=0.9, lab_delta_e=30.0,
            boundary_sharpness=20.0,
            crop_x=0.1, crop_y=0.1, crop_w=0.8, crop_h=0.8,
            post_crop_subject_area=0.25, framing_quality="good",
            gt_bbox_x=None, gt_bbox_y=None, gt_bbox_w=None, gt_bbox_h=None,
            gt_iou=None,
            detection_ms=100, segmentation_ms=100,
            detector_model="test", segmenter_model="test",
            processed_at=int(time.time() * 1000),
            schema_version=1,
        )
        tmp = Path("/tmp/smoke_test.parquet")
        table = pa.Table.from_pylist([row_to_pyarrow_record(dr)], schema=SCHEMA)
        pq.write_table(table, tmp, compression="snappy")
        loaded = pq.read_table(tmp)
        if loaded.num_rows == 1 and loaded.column("image_id").to_pylist()[0] == "smoke-1":
            _ok("Gate 8: parquet roundtrip succeeded")
            tmp.unlink()
        else:
            _fail("Gate 8: parquet roundtrip data mismatch")
            failures += 1
    except Exception as e:
        _fail(f"Gate 8: parquet roundtrip failed: {type(e).__name__}: {e}")
        failures += 1

    print("Gate 9: crop preview generation")
    try:
        img_path = DATA_DIR / sample[0]["filename"]
        with Image.open(img_path) as im:
            im = im.convert("RGB")
            tmp_med = Path("/tmp/smoke_crop.jpg")
            tmp_thumb = Path("/tmp/smoke_thumb.jpg")
            save_medium_and_thumb(im, (0.2, 0.2, 0.6, 0.6), tmp_med, tmp_thumb)
            if tmp_med.exists() and tmp_thumb.exists() \
                    and tmp_med.stat().st_size > 0:
                _ok(f"Gate 9: crops saved "
                    f"({tmp_med.stat().st_size} + {tmp_thumb.stat().st_size} bytes)")
                tmp_med.unlink()
                tmp_thumb.unlink()
            else:
                _fail("Gate 9: crop files empty")
                failures += 1
    except Exception as e:
        _fail(f"Gate 9: crop generation failed: {type(e).__name__}: {e}")
        failures += 1

    print("\nPer-image latency (real samples):")
    for r in sample[:3]:
        img_path = DATA_DIR / r["filename"]
        if not img_path.exists():
            continue
        with Image.open(img_path) as im:
            im = im.convert("RGB")
            t0 = time.perf_counter()
            det = detector.detect(im)
            t1 = time.perf_counter()
            if det.bbox_xywh_normalized:
                seg = segmenter.segment_with_bbox(
                    r["image_id"], im, det.bbox_xywh_normalized)
                t2 = time.perf_counter()
                print(f"  {r['image_id']}: dino={int((t1-t0)*1000)}ms  "
                      f"sam={int((t2-t1)*1000)}ms")
            else:
                print(f"  {r['image_id']}: dino={int((t1-t0)*1000)}ms  "
                      f"sam=skipped (no bbox)")

    print()
    if failures == 0:
        print(_color("=== Phase A: ALL GATES PASSED ===", "green"))
        return 0
    else:
        print(_color(f"=== Phase A: {failures} gate(s) failed ===", "red"))
        return 1
