"""Smoke test: prove Sam3Detector.detect_batch + Sam3Segmenter.segment_batch
actually work on real (uncached) images in a real GPU forward pass.

Runs in a separate process so it doesn't contaminate the main pipeline's
import state. Loads its own SAM3 (adds ~1-2GB unified memory, shares GPU
with whatever else is running — fine for a quick verify).

Picks 4 image_ids from the SAMPLE that don't yet have sam3 detection cache
files (so we exercise the real model.forward path, not just cache decode).
"""
from __future__ import annotations
import time
from pathlib import Path

import polars as pl
import torch
from PIL import Image

from scripts.detect_subjects.config import (
    CACHE_DIR, DATA_DIR, SAMPLE_PARQUET_PATH,
)
from scripts.detect_subjects.detectors.sam3 import Sam3Detector
from scripts.detect_subjects.segmenters.sam3 import Sam3Segmenter

SAM3_DETECT_CACHE = CACHE_DIR / "raw_sam3"


def main(n: int = 4) -> None:
    sample = pl.read_parquet(SAMPLE_PARQUET_PATH)
    cached_ids = {p.stem.split("__")[0] for p in SAM3_DETECT_CACHE.glob("*.json")}
    print(f"[smoke] {len(cached_ids)} image_ids have detect cache; picking {n} that DO NOT")

    picks: list[dict] = []
    # Walk from the TAIL of the sample — least likely to overlap with the
    # main pipeline which processes from the head.
    for row in reversed(sample.iter_rows(named=True).__iter__() if False else list(sample.iter_rows(named=True))):
        if row["image_id"] in cached_ids:
            continue
        p = DATA_DIR / (row.get("filename") or "")
        if not p.exists():
            continue
        picks.append(row)
        if len(picks) >= n:
            break
    if not picks:
        print("[smoke] no uncached + on-disk images — falling back to cached")
        picks = sample.head(n).to_dicts()

    images = []
    ids = []
    for r in picks:
        im = Image.open(DATA_DIR / r["filename"]).convert("RGB")
        images.append(im)
        ids.append(r["image_id"])
    print(f"[smoke] loaded {len(images)} images: {ids}")

    t0 = time.perf_counter()
    detector = Sam3Detector(device="mps", dtype=torch.float32)
    print(f"[smoke] detector ready in {time.perf_counter()-t0:.1f}s")

    print(f"[smoke] calling detect_batch on {len(images)} images...")
    t1 = time.perf_counter()
    detections = detector.detect_batch(images, ids)
    print(f"[smoke] detect_batch took {time.perf_counter()-t1:.2f}s "
          f"({(time.perf_counter()-t1)/len(images):.2f}s per image amortized)")
    for iid, d in zip(ids, detections):
        bbox = d.bbox_xywh_normalized
        print(f"  {iid}: bbox={bbox}, conf={d.confidence}, "
              f"n_distinct={d.n_distinct_detections}")

    # Segment those that got a bbox
    with_bbox = [(im, iid, d.bbox_xywh_normalized)
                 for im, iid, d in zip(images, ids, detections)
                 if d.bbox_xywh_normalized is not None]
    if with_bbox:
        seg_images = [w[0] for w in with_bbox]
        seg_ids = [w[1] for w in with_bbox]
        seg_bboxes = [w[2] for w in with_bbox]
        print(f"[smoke] calling segment_batch on {len(with_bbox)} images...")
        segmenter = Sam3Segmenter(device="mps", dtype=torch.float32)
        t2 = time.perf_counter()
        seg_results = segmenter.segment_batch(seg_ids, seg_images, seg_bboxes)
        print(f"[smoke] segment_batch took {time.perf_counter()-t2:.2f}s "
              f"({(time.perf_counter()-t2)/len(with_bbox):.2f}s per image amortized)")
        for iid, sr in zip(seg_ids, seg_results):
            mask_pixels = int(sr.mask.sum()) if sr.mask is not None else 0
            print(f"  {iid}: mask_pixels={mask_pixels}, iou={sr.iou_score}")

    print("[smoke] DONE — batched paths returned without error")


if __name__ == "__main__":
    main(n=4)
