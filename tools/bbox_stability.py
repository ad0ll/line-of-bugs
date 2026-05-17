"""Bbox stability report: compare bbox IoU between two parquet variants per image.

For each `image_id` present in BOTH variants, computes IoU(variant_a_bbox,
variant_b_bbox). Reports the distribution:
  - stable: IoU >= 0.8 → bbox barely moved; labels transfer
  - shifted: 0.5 <= IoU < 0.8 → bbox overlapping but different; conditional transfer
  - moved:  IoU < 0.5 → meaningfully different bbox; re-review needed

Used by:
  - tools/transfer_labels.py to predict re-review queue size
  - tools/knob_sweep.py to measure how much a knob change perturbs bboxes

Usage:
    .venv/bin/python -m tools.bbox_stability \
        --variant-a grounding_dino__insectsam \
        --variant-b sam3__sam3 \
        [--out docs/bbox_stability_2026-05-16.md]

Output:
  - markdown report to stdout (or --out file)
  - CSV histogram alongside (.csv extension on --out)
"""
from __future__ import annotations
import argparse
import csv
import sys
from collections import Counter
from pathlib import Path
from typing import Optional

import polars as pl

from scripts.detect_subjects.config import PARQUET_PATH
from scripts.detect_subjects.metrics import iou_xywh_normalized

STABLE_THRESHOLD = 0.8
SHIFTED_THRESHOLD = 0.5


def _bbox(row: dict) -> Optional[tuple[float, float, float, float]]:
    if row.get("bbox_x") is None:
        return None
    return (row["bbox_x"], row["bbox_y"], row["bbox_w"], row["bbox_h"])


def compare_variants(parquet_path: Path, variant_a: str, variant_b: str) -> dict:
    """Compare bbox IoU per image_id present in both variants.

    Returns: {
        common: int,
        only_a: int,
        only_b: int,
        ious: list[float],                       # IoU for each common image
        per_image: list[dict],                   # {image_id, iou, bucket}
        buckets: {stable: int, shifted: int, moved: int, both_no_bbox: int, one_no_bbox: int},
    }
    """
    df = pl.read_parquet(parquet_path)
    df_a = df.filter(pl.col("variant") == variant_a)
    df_b = df.filter(pl.col("variant") == variant_b)

    a_ids = set(df_a["image_id"].to_list())
    b_ids = set(df_b["image_id"].to_list())
    common = a_ids & b_ids

    a_by_id = {r["image_id"]: r for r in df_a.iter_rows(named=True)}
    b_by_id = {r["image_id"]: r for r in df_b.iter_rows(named=True)}

    ious: list[float] = []
    per_image: list[dict] = []
    buckets = Counter()

    for image_id in sorted(common):
        bb_a = _bbox(a_by_id[image_id])
        bb_b = _bbox(b_by_id[image_id])
        if bb_a is None and bb_b is None:
            bucket = "both_no_bbox"
            iou = None
        elif bb_a is None or bb_b is None:
            bucket = "one_no_bbox"
            iou = 0.0
        else:
            iou = iou_xywh_normalized(bb_a, bb_b)
            if iou >= STABLE_THRESHOLD:
                bucket = "stable"
            elif iou >= SHIFTED_THRESHOLD:
                bucket = "shifted"
            else:
                bucket = "moved"
            ious.append(iou)
        per_image.append({"image_id": image_id, "iou": iou, "bucket": bucket})
        buckets[bucket] += 1

    return {
        "common": len(common),
        "only_a": len(a_ids - b_ids),
        "only_b": len(b_ids - a_ids),
        "ious": ious,
        "per_image": per_image,
        "buckets": dict(buckets),
    }


def render_markdown(report: dict, variant_a: str, variant_b: str) -> str:
    n = report["common"]
    b = report["buckets"]
    stable = b.get("stable", 0)
    shifted = b.get("shifted", 0)
    moved = b.get("moved", 0)
    one_no = b.get("one_no_bbox", 0)
    both_no = b.get("both_no_bbox", 0)

    def pct(x):
        return (x / n * 100) if n else 0.0

    ious = report["ious"]
    mean_iou = sum(ious) / len(ious) if ious else 0.0
    median_iou = sorted(ious)[len(ious) // 2] if ious else 0.0
    sub_50 = sum(1 for v in ious if v < 0.5)

    lines = [
        f"# Bbox stability: `{variant_a}` vs `{variant_b}`",
        "",
        f"**Common image_ids:** {n}",
        f"**Only in `{variant_a}`:** {report['only_a']}",
        f"**Only in `{variant_b}`:** {report['only_b']}",
        "",
        "## Distribution",
        "",
        "| bucket | count | pct |",
        "|---|---:|---:|",
        f"| **stable** (IoU ≥ {STABLE_THRESHOLD}) — labels likely transfer | {stable} | {pct(stable):.1f}% |",
        f"| **shifted** ({SHIFTED_THRESHOLD} ≤ IoU < {STABLE_THRESHOLD}) — conditional transfer | {shifted} | {pct(shifted):.1f}% |",
        f"| **moved** (IoU < {SHIFTED_THRESHOLD}) — re-review needed | {moved} | {pct(moved):.1f}% |",
        f"| **one_no_bbox** — one variant has bbox, other doesn't | {one_no} | {pct(one_no):.1f}% |",
        f"| **both_no_bbox** — neither variant detected | {both_no} | {pct(both_no):.1f}% |",
        "",
        "## Stats (IoU values, both have bbox)",
        "",
        f"- n = {len(ious)}",
        f"- mean IoU = {mean_iou:.3f}",
        f"- median IoU = {median_iou:.3f}",
        f"- IoU < 0.5 = {sub_50} ({(sub_50/len(ious)*100) if ious else 0:.1f}%)",
        "",
        "## Implication for label transfer",
        "",
        f"- Auto-transfer candidates (IoU ≥ 0.8): **{stable}**",
        f"- Conditional transfer candidates (0.5 ≤ IoU < 0.8): **{shifted}** (review per-label rules)",
        f"- Force re-review (IoU < 0.5 or one_no_bbox): **{moved + one_no}**",
        f"- Re-review queue projection (assuming all labeled images): up to {moved + one_no + shifted} of {n}",
        "",
    ]
    return "\n".join(lines)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--variant-a", required=True, help="baseline variant (e.g., grounding_dino__insectsam)")
    ap.add_argument("--variant-b", required=True, help="new variant (e.g., sam3__sam3)")
    ap.add_argument("--parquet", type=Path, default=PARQUET_PATH)
    ap.add_argument("--out", type=Path, default=None, help="markdown output file; also writes .csv with per-image data")
    args = ap.parse_args()

    report = compare_variants(args.parquet, args.variant_a, args.variant_b)
    if report["common"] == 0:
        print(f"ERROR: no common image_ids between {args.variant_a!r} and {args.variant_b!r}", file=sys.stderr)
        return 1

    md = render_markdown(report, args.variant_a, args.variant_b)
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(md)
        csv_path = args.out.with_suffix(".csv")
        with csv_path.open("w", newline="") as f:
            w = csv.writer(f)
            w.writerow(["image_id", "iou", "bucket"])
            for r in report["per_image"]:
                w.writerow([r["image_id"], "" if r["iou"] is None else f"{r['iou']:.4f}", r["bucket"]])
        print(f"wrote {args.out} and {csv_path}")
    else:
        print(md)
    return 0


if __name__ == "__main__":
    sys.exit(main())
