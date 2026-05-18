"""Targeted backfill: add lab_delta_e_p80 + recompute rule outputs ONLY for
sam3 rows currently flagged framing_quality='poor_contrast'.

Rationale: under the new AND rule (dE<12 AND p80<30), a row's framing_quality
can ONLY change from 'poor_contrast' to something else (the new rule is
strictly more conservative for rows that currently fire). Rows currently NOT
flagged poor_contrast can't start firing now — so they don't need backfill
unless we also tighten OTHER rules. We didn't.

So the user-visible bug fix only requires touching the ~70 affected rows.

Uses Sam3Segmenter.segment_batch with batch_size=4. Mask caching is now in
the segmenter, so re-runs are near-instant after the first pass.
"""
from __future__ import annotations
import sqlite3
import time
from pathlib import Path

import numpy as np
import polars as pl
import torch
from PIL import Image

from scripts.detect_subjects.config import DATA_DIR, PARQUET_PATH
from scripts.detect_subjects.metrics import lab_delta_e_p80_inside_vs_outside_mean
from scripts.detect_subjects.rule_labeler import suggest_labels, classify_framing
from scripts.detect_subjects.segmenters.sam3 import Sam3Segmenter

DB_PATH = DATA_DIR / "db" / "line-of-bugs.db"
BATCH_SIZE = 4


def main() -> None:
    df = pl.read_parquet(PARQUET_PATH)
    sam3 = df.filter(pl.col("variant") == "sam3__sam3")
    # Affected subset: rows currently flagged poor_contrast under the old rule.
    affected = sam3.filter(
        (pl.col("framing_quality") == "poor_contrast")
        & pl.col("bbox_x").is_not_null()
    )
    print(f"[backfill] sam3 rows total: {len(sam3)}; "
          f"currently flagged poor_contrast: {len(affected)}")
    if len(affected) == 0:
        print("[backfill] nothing to do")
        return

    # Filename map
    con = sqlite3.connect(DB_PATH)
    ids = affected["image_id"].to_list()
    placeholders = ",".join("?" * len(ids))
    fn_map = dict(con.execute(
        f"SELECT image_id, filename FROM images WHERE image_id IN ({placeholders})",
        ids,
    ).fetchall())
    con.close()

    print(f"[backfill] loading Sam3Segmenter...")
    segmenter = Sam3Segmenter(device="mps", dtype=torch.float32)

    # Per-row computed values
    p80_by_id: dict[str, float] = {}
    suggested_by_id: dict[str, list[str]] = {}
    quality_by_id: dict[str, str] = {}

    rows = affected.to_dicts()
    t_start = time.perf_counter()

    for chunk_start in range(0, len(rows), BATCH_SIZE):
        chunk = rows[chunk_start:chunk_start + BATCH_SIZE]
        # Load images
        images, bboxes, chunk_ids, chunk_rgbs = [], [], [], []
        for r in chunk:
            iid = r["image_id"]
            filename = fn_map.get(iid)
            if not filename:
                continue
            path = DATA_DIR / filename
            if not path.exists():
                continue
            try:
                img = Image.open(path).convert("RGB")
                images.append(img)
                bboxes.append((r["bbox_x"], r["bbox_y"], r["bbox_w"], r["bbox_h"]))
                chunk_ids.append(iid)
                chunk_rgbs.append(np.array(img))
            except Exception as e:
                print(f"  {iid} load failed: {type(e).__name__}: {e}")
        if not images:
            continue

        # Batched segment (uses mask cache transparently — re-runs are fast)
        try:
            seg_results = segmenter.segment_batch(chunk_ids, images, bboxes)
        except Exception as e:
            print(f"[backfill] segment_batch failed: {type(e).__name__}: {e}")
            continue

        # Per-image post-processing
        for j, (r, rgb, seg) in enumerate(zip(chunk, chunk_rgbs, seg_results)):
            iid = r["image_id"]
            if seg.mask is None or not seg.mask.any():
                p80 = None
            else:
                p80 = lab_delta_e_p80_inside_vs_outside_mean(rgb, seg.mask)
            p80_by_id[iid] = p80

            sugg = suggest_labels(
                confidence=r["confidence"],
                bbox_area_ratio=r["bbox_area_ratio"],
                bbox_long_edge_px=r["bbox_long_edge_px"],
                n_distinct_detections=r["n_distinct_detections"],
                n_in_primary_bbox=1,
                mask_area_ratio=r["mask_area_ratio"],
                lab_delta_e=r["lab_delta_e"],
                lab_delta_e_p80=p80,
                bbox_touches_edge=r["bbox_touches_edge"],
            )
            qual = classify_framing(
                confidence=r["confidence"],
                bbox_area_ratio=r["bbox_area_ratio"],
                bbox_long_edge_px=r["bbox_long_edge_px"],
                n_distinct_detections=r["n_distinct_detections"],
                mask_area_ratio=r["mask_area_ratio"],
                lab_delta_e=r["lab_delta_e"],
                lab_delta_e_p80=p80,
                bbox_touches_edge=r["bbox_touches_edge"],
            )
            suggested_by_id[iid] = sugg
            quality_by_id[iid] = qual

        done = chunk_start + len(chunk)
        elapsed = time.perf_counter() - t_start
        rate = done / elapsed
        eta = (len(rows) - done) / max(rate, 0.01)
        print(f"  {done}/{len(rows)}  ({rate:.2f} img/s, eta {eta:.0f}s)", flush=True)

    print(f"[backfill] segment + p80 done; updating parquet for {len(p80_by_id)} rows...")

    def _map_p80(iid):
        v = p80_by_id.get(iid)
        return float(v) if v is not None else float("nan")

    new_p80 = df["image_id"].map_elements(_map_p80, return_dtype=pl.Float64).cast(pl.Float32)
    if "lab_delta_e_p80" in df.columns:
        existing = df["lab_delta_e_p80"]
        new_p80 = pl.when(new_p80.is_nan()).then(existing).otherwise(new_p80)
    df = df.with_columns(new_p80.alias("lab_delta_e_p80"))

    def _map_suggested(s):
        v = suggested_by_id.get(s["image_id"])
        return v if v is not None else s["suggested_labels"]

    def _map_quality(s):
        v = quality_by_id.get(s["image_id"])
        return v if v is not None else s["framing_quality"]

    new_sugg = df.select(
        pl.struct(["image_id", "suggested_labels"])
          .map_elements(_map_suggested, return_dtype=pl.List(pl.Utf8))
          .alias("suggested_labels"),
    )
    new_qual = df.select(
        pl.struct(["image_id", "framing_quality"])
          .map_elements(_map_quality, return_dtype=pl.Utf8)
          .alias("framing_quality"),
    )
    df = df.with_columns([
        new_sugg["suggested_labels"],
        new_qual["framing_quality"],
    ])

    df.write_parquet(PARQUET_PATH)

    # Report flips
    poor_after = sum(1 for v in quality_by_id.values() if v == "poor_contrast")
    flipped = len(quality_by_id) - poor_after
    print(f"[backfill] DONE in {time.perf_counter()-t_start:.0f}s")
    print(f"[backfill] {len(quality_by_id)} rows reprocessed: "
          f"{poor_after} still flagged poor_contrast, {flipped} flipped to other")


if __name__ == "__main__":
    main()
