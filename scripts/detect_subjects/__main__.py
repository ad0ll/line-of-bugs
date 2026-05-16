"""CLI: `python -m scripts.detect_subjects [sample|smoke|v1|build-html]`."""
from __future__ import annotations
import argparse
import sys
from pathlib import Path

import polars as pl

from scripts.detect_subjects.build_html import build_html_for_variant
from scripts.detect_subjects.config import (
    PARQUET_PATH,
    RANDOM_SEED,
    SAMPLE_PARQUET_PATH,
)
from scripts.detect_subjects.data import (
    load_manifest_rows,
    pick_stratified_sample,
)
from scripts.detect_subjects.ground_truth import GroundTruthIndex
from scripts.detect_subjects.classify import V1_NAME, run_v1_on_sample


def _save_sample(sample: list[dict], path: Path) -> None:
    df = pl.DataFrame(sample)
    df.write_parquet(path)


def _load_sample(path: Path) -> list[dict]:
    df = pl.read_parquet(path)
    return [dict(r) for r in df.iter_rows(named=True)]


def cmd_sample(args: argparse.Namespace) -> int:
    rows = load_manifest_rows()
    sample = pick_stratified_sample(rows, seed=RANDOM_SEED)
    _save_sample(sample, SAMPLE_PARQUET_PATH)
    print(f"saved {len(sample)} rows to {SAMPLE_PARQUET_PATH}")
    by_source: dict[str, int] = {}
    for r in sample:
        by_source[r["source"]] = by_source.get(r["source"], 0) + 1
    for s, c in by_source.items():
        print(f"  {s}: {c}")
    return 0


def cmd_smoke(args: argparse.Namespace) -> int:
    # Deferred import — smoke module is implemented in Task 16
    from scripts.detect_subjects.smoke import run_smoke_benchmark
    return run_smoke_benchmark()


def cmd_v1(args: argparse.Namespace) -> int:
    if not SAMPLE_PARQUET_PATH.exists():
        print(f"ERROR: sample not found at {SAMPLE_PARQUET_PATH}. Run `sample` first.")
        return 2
    sample = _load_sample(SAMPLE_PARQUET_PATH)
    gt_path = Path(args.gt_json) if args.gt_json else None
    gt_index = GroundTruthIndex.from_inat2017_json(gt_path) \
        if gt_path and gt_path.exists() else None
    summary = run_v1_on_sample(sample, gt_index=gt_index, parquet_path=PARQUET_PATH)
    print(f"v1 done: processed={summary['processed']} "
          f"errors={summary['errors']} elapsed={summary['elapsed_s']:.1f}s")
    return 0 if summary["errors"] == 0 else 1


def cmd_build_html(args: argparse.Namespace) -> int:
    out = build_html_for_variant(args.variant)
    print(f"wrote {out}")
    return 0


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="detect_subjects")
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("sample", help="pick stratified sample").set_defaults(func=cmd_sample)
    sub.add_parser("smoke", help="Phase A smoke benchmark").set_defaults(func=cmd_smoke)
    pv1 = sub.add_parser("v1", help="run V1 over the sample")
    pv1.add_argument("--gt-json", default=None,
                      help="path to iNat-2017 annotations JSON (optional)")
    pv1.set_defaults(func=cmd_v1)
    pb = sub.add_parser("build-html", help="render HTML review page")
    pb.add_argument("--variant", default=V1_NAME)
    pb.set_defaults(func=cmd_build_html)
    args = p.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
