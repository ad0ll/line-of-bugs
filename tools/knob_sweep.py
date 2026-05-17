"""Knob sweep: re-run SAM 3 detection across a value range for one knob, measure stability.

Reports per knob value:
  - n_detections: how many of the sample have any bbox at all
  - mean_iou_vs_current: average IoU between this-value's bbox and the current-cfg bbox
  - n_shifted: # of sample where IoU < 0.5 vs current (these need re-review at this setting)

Sample defaults to 50 labeled images (validator_sample.parquet ∩ labels.json) to keep
the sweep fast. Use --n to override.

Currently supports knob=`box_threshold` for SAM 3. Future: add knobs from grounding_dino
and bbox-content rules.

Usage:
    .venv/bin/python -m tools.knob_sweep \
        --knob box_threshold \
        --values 0.1,0.2,0.3,0.4,0.5,0.6,0.7 \
        --n 30 \
        [--out docs/knob_sweep_box_threshold.md]
"""
from __future__ import annotations
import argparse
import json
import sys
import time
from pathlib import Path

import polars as pl
from PIL import Image

from scripts.detect_subjects.config import CACHE_DIR, DATA_DIR
from scripts.detect_subjects.metrics import iou_xywh_normalized
from scripts.detect_subjects.prompt_builder import build_insect_prompt

LABELS_PATH = CACHE_DIR / "labels.json"
DB_PATH = DATA_DIR / "db" / "line-of-bugs.db"
VALIDATOR_SAMPLE = CACHE_DIR / "validator_sample.parquet"


def load_labeled_sample(n: int, seed: int = 42) -> list[dict]:
    """Pick n rows from validator_sample whose image_id is also in labels.json."""
    labels = json.loads(LABELS_PATH.read_text()) if LABELS_PATH.exists() else {}
    sample = pl.read_parquet(VALIDATOR_SAMPLE)
    sample = sample.filter(pl.col("image_id").is_in(list(labels.keys())))
    if sample.height < n:
        print(f"[knob_sweep] WARN: only {sample.height} labeled images available (asked for {n})", file=sys.stderr)
        n = sample.height
    return sample.sample(n=n, seed=seed).to_dicts()


def _run_sam3_pass(
    rows: list[dict],
    prompt_phrases: list[str],
    box_threshold: float,
    device: str = "mps",
) -> dict[str, dict]:
    """Run SAM 3 over `rows` at given threshold. Returns {image_id: {bbox, conf}}.

    Each pass uses a fresh Sam3Detector at the given threshold. The disk cache
    keys by (prompt, model_id) so changing threshold reuses existing inference
    but re-filters by score — except SAM 3's cache stores ONLY boxes/scores
    above the cached threshold. To rerun with a LOWER threshold, we need
    inference re-run. Simpler: just always re-run inference; SAM 3 is fast.
    """
    from scripts.detect_subjects.detectors.sam3 import Sam3Detector
    # Use a unique cache key per threshold so we don't pollute the real cache.
    # We accomplish this by passing box_threshold to the detector and prefixing
    # the prompt with the threshold (sha1 cache key will differ per threshold).
    det = Sam3Detector(device=device, prompt_phrases=prompt_phrases, box_threshold=box_threshold)
    # Override the cache key for this sweep so different thresholds don't collide
    out: dict[str, dict] = {}
    for r in rows:
        image_id = r["image_id"]
        img_path = DATA_DIR / r["filename"]
        if not img_path.exists():
            continue
        try:
            with Image.open(img_path) as im:
                im = im.convert("RGB")
                d = det.detect(im, image_id=f"sweep__{box_threshold:.3f}__{image_id}")
                out[image_id] = {
                    "bbox": d.bbox_xywh_normalized,
                    "conf": d.confidence,
                    "n_distinct": d.n_distinct_detections,
                }
        except Exception as e:
            print(f"  ERROR {image_id}: {type(e).__name__}: {e}", file=sys.stderr)
    return out


def sweep_box_threshold(values: list[float], n: int, seed: int = 42) -> dict:
    """Sweep SAM 3 box_threshold over `values`. Returns per-value stats + per-image data."""
    rows = load_labeled_sample(n=n, seed=seed)
    print(f"[knob_sweep] sampled {len(rows)} labeled images", file=sys.stderr)

    prompt_phrases, _ = build_insect_prompt(DB_PATH)

    results: dict[float, dict[str, dict]] = {}
    t0 = time.time()
    for v in values:
        print(f"[knob_sweep] running box_threshold={v} ...", file=sys.stderr)
        results[v] = _run_sam3_pass(rows, prompt_phrases, v)
        print(f"[knob_sweep]   {len(results[v])} processed, elapsed {time.time()-t0:.0f}s", file=sys.stderr)

    # Pick current value as comparison anchor (highest threshold = strictest, conventionally "current")
    # Actually use the middle value or smallest — use 0.3 as conventional baseline (matches cfg.SAM3_BOX_THRESHOLD)
    baseline_value = 0.3 if 0.3 in results else values[len(values) // 2]
    baseline = results[baseline_value]

    per_value: list[dict] = []
    for v in values:
        snap = results[v]
        n_det = sum(1 for r in snap.values() if r["bbox"] is not None)
        # IoU vs baseline (only counting images where BOTH have bbox)
        ious = []
        n_shifted = 0
        for image_id, r in snap.items():
            ref = baseline.get(image_id)
            if ref is None or ref["bbox"] is None or r["bbox"] is None:
                continue
            iou = iou_xywh_normalized(r["bbox"], ref["bbox"])
            ious.append(iou)
            if iou < 0.5:
                n_shifted += 1
        mean_iou = sum(ious) / len(ious) if ious else 0.0
        per_value.append({
            "value": v,
            "n_detected": n_det,
            "n_total": len(snap),
            "mean_iou_vs_baseline": mean_iou,
            "n_shifted_vs_baseline": n_shifted,
            "n_compared": len(ious),
        })

    return {
        "knob": "box_threshold",
        "values": values,
        "baseline_value": baseline_value,
        "n_sample": len(rows),
        "per_value": per_value,
    }


def render_markdown(report: dict) -> str:
    knob = report["knob"]
    baseline = report["baseline_value"]
    n = report["n_sample"]
    lines = [
        f"# Knob sweep: `{knob}` over {len(report['values'])} values",
        "",
        f"Sample size: {n} labeled images. Baseline value (anchor for IoU comparison): `{baseline}`.",
        "",
        "| value | n_detected | n_total | mean IoU vs baseline | n_shifted (IoU<0.5) | n_compared |",
        "|---:|---:|---:|---:|---:|---:|",
    ]
    for entry in report["per_value"]:
        marker = " ← baseline" if entry["value"] == baseline else ""
        lines.append(
            f"| {entry['value']:.2f}{marker} | {entry['n_detected']} | {entry['n_total']} | "
            f"{entry['mean_iou_vs_baseline']:.3f} | {entry['n_shifted_vs_baseline']} | {entry['n_compared']} |"
        )
    lines += [
        "",
        "## Reading this",
        "",
        "- **n_detected**: how many images get any bbox at this threshold. Lower threshold → more detections (some spurious).",
        "- **mean IoU vs baseline**: 1.0 = identical bbox to baseline value. Lower → more bbox movement.",
        "- **n_shifted (IoU<0.5)**: how many images at this threshold need re-review against the baseline.",
        "",
        "Pick a value where: high n_detected, mean_iou close to 1.0, low n_shifted vs current `cfg.SAM3_BOX_THRESHOLD`.",
        "",
    ]
    return "\n".join(lines)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--knob", choices=["box_threshold"], default="box_threshold",
                    help="which knob to sweep (only box_threshold supported in v1)")
    ap.add_argument("--values", required=True,
                    help="comma-separated knob values (e.g., 0.1,0.2,0.3,0.4,0.5)")
    ap.add_argument("--n", type=int, default=30, help="sample size of labeled images")
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--out", type=Path, default=None, help="markdown output file")
    args = ap.parse_args()

    values = [float(v.strip()) for v in args.values.split(",")]
    if args.knob == "box_threshold":
        report = sweep_box_threshold(values, n=args.n, seed=args.seed)
    else:
        print(f"unknown knob: {args.knob}", file=sys.stderr)
        return 1

    md = render_markdown(report)
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(md)
        print(f"wrote {args.out}")
    else:
        print(md)
    return 0


if __name__ == "__main__":
    sys.exit(main())
