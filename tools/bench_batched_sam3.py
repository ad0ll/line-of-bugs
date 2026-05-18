"""Benchmark batched SAM3 inference vs sequential.

Picks N fresh (cache-cold) images, runs the sequential path then the batched
path (at various batch sizes), reports wall-clock + per-image timing.

Sample is reset between runs by deleting the per-image detection JSON cache
and the segmentation mask cache. Output bboxes are also compared between
sequential and batched to confirm correctness.

Usage:
  .venv/bin/python -m tools.bench_batched_sam3 --n 40 --batch-sizes 2,4,8
"""
from __future__ import annotations
import argparse
import json
import sqlite3
import time
from pathlib import Path

import numpy as np
import polars as pl
from PIL import Image

from scripts.detect_subjects.config import CACHE_DIR, DATA_DIR, PARQUET_PATH
from scripts.detect_subjects.detectors.sam3 import Sam3Detector, SAM3_CACHE_DIR, _sam3_cache_key
from scripts.detect_subjects.segmenters.sam3 import Sam3Segmenter

DB_PATH = DATA_DIR / "db" / "line-of-bugs.db"
MASK_CACHE_DIR = CACHE_DIR / "sam3_masks_bench"


def _pick_fresh_unprocessed(n: int) -> list[dict]:
    """Random N non-specimen images NOT in parquet — guarantees cold cache."""
    processed = set(
        pl.read_parquet(PARQUET_PATH)["image_id"].unique().to_list()
    ) if PARQUET_PATH.exists() else set()
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    try:
        rows = con.execute(
            "SELECT image_id, filename FROM images "
            "WHERE subject_state != 'specimen' "
            "ORDER BY RANDOM() LIMIT ?",
            (n * 3,),
        ).fetchall()
    finally:
        con.close()
    picked = []
    for r in rows:
        if r["image_id"] in processed:
            continue
        p = DATA_DIR / r["filename"]
        if not p.exists():
            continue
        picked.append({"image_id": r["image_id"], "path": p})
        if len(picked) >= n:
            break
    return picked


def _clear_cache_for(ids: list[str], cache_key: str) -> None:
    for iid in ids:
        for d in (SAM3_CACHE_DIR, MASK_CACHE_DIR):
            for p in d.glob(f"{iid}__*.json"):
                p.unlink()
            (d / f"{iid}.npy").unlink(missing_ok=True)


def _bench(
    rows: list[dict], detector: Sam3Detector, segmenter: Sam3Segmenter,
    batch_size: int,
) -> dict:
    """Run detect + segment over rows in chunks of batch_size. Returns timing
    + a digest of bbox results for correctness comparison."""
    t0 = time.perf_counter()
    bboxes: list[tuple] = []
    for chunk_start in range(0, len(rows), batch_size):
        chunk = rows[chunk_start:chunk_start + batch_size]
        ids = [r["image_id"] for r in chunk]
        images = [Image.open(r["path"]).convert("RGB") for r in chunk]
        if batch_size == 1:
            dets = [detector.detect(images[0], image_id=ids[0])]
            segs = [
                segmenter.segment_with_bbox(ids[0], images[0], dets[0].bbox_xywh_normalized)
                if dets[0].bbox_xywh_normalized is not None else None
            ]
        else:
            dets = detector.detect_batch(images, ids)
            seg_indices = [i for i, d in enumerate(dets) if d.bbox_xywh_normalized is not None]
            segs = [None] * len(dets)
            if seg_indices:
                sub_ids = [ids[i] for i in seg_indices]
                sub_imgs = [images[i] for i in seg_indices]
                sub_bbs = [dets[i].bbox_xywh_normalized for i in seg_indices]
                seg_results = segmenter.segment_batch(sub_ids, sub_imgs, sub_bbs)
                for k, idx in enumerate(seg_indices):
                    segs[idx] = seg_results[k]
        for d, s in zip(dets, segs):
            bbox_digest = (
                tuple(round(v, 4) for v in d.bbox_xywh_normalized)
                if d.bbox_xywh_normalized else None
            )
            mask_pixels = int(s.mask.sum()) if s is not None and s.mask is not None else None
            bboxes.append((bbox_digest, mask_pixels))
        for im in images:
            im.close()
    elapsed = time.perf_counter() - t0
    return {
        "elapsed_s": round(elapsed, 2),
        "per_image_ms": round(elapsed * 1000 / len(rows), 1),
        "bbox_digest": bboxes,
    }


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--n", type=int, default=40)
    p.add_argument("--batch-sizes", default="2,4,8",
                   help="Comma-separated batch sizes to benchmark")
    args = p.parse_args()
    batch_sizes = [int(b) for b in args.batch_sizes.split(",")]

    rows = _pick_fresh_unprocessed(args.n)
    print(f"[bench] picked {len(rows)} fresh non-specimen images")

    detector = Sam3Detector(device="mps", prompt_phrases=["an insect"])
    segmenter = Sam3Segmenter(device="mps")
    text_query = detector._text_query
    cache_key = _sam3_cache_key(text_query, detector.model_id)
    ids = [r["image_id"] for r in rows]

    # Warm-up — first call paid model-load tax (already done above); the
    # MPS scheduler also seems to "warm up" — first inference is ~2x slow.
    print("[bench] warm-up pass (results discarded)")
    _clear_cache_for(ids[:2], cache_key)
    _bench(rows[:2], detector, segmenter, batch_size=1)

    results = {}
    # Sequential baseline
    _clear_cache_for(ids, cache_key)
    print(f"\n[bench] running sequential (bs=1)...")
    results[1] = _bench(rows, detector, segmenter, batch_size=1)
    print(f"  bs=1: {results[1]['elapsed_s']}s, {results[1]['per_image_ms']}ms/img")

    for bs in batch_sizes:
        _clear_cache_for(ids, cache_key)
        print(f"\n[bench] running batched (bs={bs})...")
        results[bs] = _bench(rows, detector, segmenter, batch_size=bs)
        print(f"  bs={bs}: {results[bs]['elapsed_s']}s, "
              f"{results[bs]['per_image_ms']}ms/img "
              f"(speedup {results[1]['per_image_ms'] / results[bs]['per_image_ms']:.2f}x)")

    # Correctness check: bbox digests should match across batch sizes
    print("\n[bench] correctness check (bbox digests):")
    baseline = results[1]["bbox_digest"]
    for bs in [1, *batch_sizes]:
        digest = results[bs]["bbox_digest"]
        matches = sum(1 for a, b in zip(baseline, digest) if a[0] == b[0])
        mask_matches = sum(
            1 for a, b in zip(baseline, digest)
            if a[1] is not None and b[1] is not None
            and abs(a[1] - b[1]) / max(a[1], 1) < 0.05
        )
        print(f"  bs={bs}: bbox-exact={matches}/{len(baseline)}  "
              f"mask-within-5%={mask_matches}/{sum(1 for x in baseline if x[1] is not None)}")

    print("\n[bench] summary:")
    print(f"  baseline (bs=1): {results[1]['per_image_ms']:.0f}ms/img")
    for bs in batch_sizes:
        speedup = results[1]['per_image_ms'] / results[bs]['per_image_ms']
        print(f"  bs={bs}: {results[bs]['per_image_ms']:.0f}ms/img — {speedup:.2f}x")


if __name__ == "__main__":
    main()
