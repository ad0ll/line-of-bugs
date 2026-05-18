"""Append N non-specimen images to validator_sample.parquet.

Targets unprocessed (image_id, sam3__sam3) pairs only — classify.py will
skip already-processed rows automatically, but we further pre-filter here
so we don't bloat the sample file with no-ops.

Bias rationale: specimens (museum-style pinned/preserved photos) are
generally clean and well-handled by the current model. The model needs
more *unclean* data (in-situ wild photos with messy backgrounds, blur,
poor lighting). subject_state in the DB is the cleanest signal — values
are 'specimen' / 'wild' / 'captive'. We exclude 'specimen' only.

Usage:
  .venv/bin/python -m tools.extend_sample_nonspecimen --n 300
"""
from __future__ import annotations
import argparse
import sqlite3
from pathlib import Path

import polars as pl

from scripts.detect_subjects.config import (
    DATA_DIR, PARQUET_PATH, SAMPLE_PARQUET_PATH,
)

DB_PATH = DATA_DIR / "db" / "line-of-bugs.db"
SAMPLE_COLS = [
    "image_id", "collection_id", "source", "source_id", "source_page_url",
    "image_url", "filename", "thumbnail_filename", "medium_filename",
    "file_size_bytes", "file_sha256", "width", "height", "license",
    "license_url", "photographer_attribution", "photographer", "institution",
    "taxon_order", "taxon_species", "common_name", "subject_state", "view_label",
    "life_stage", "sex", "host_organism", "specimen_condition", "description",
    "captured_date", "raw_metadata",
]


def _load_processed_ids() -> set[str]:
    """image_ids already present in the framing parquet, any variant."""
    if not PARQUET_PATH.exists():
        return set()
    return set(pl.read_parquet(PARQUET_PATH)["image_id"].unique().to_list())


def _load_existing_sample_ids() -> set[str]:
    """image_ids already in validator_sample.parquet."""
    if not SAMPLE_PARQUET_PATH.exists():
        return set()
    return set(pl.read_parquet(SAMPLE_PARQUET_PATH)["image_id"].unique().to_list())


def pick_nonspecimen(n: int, seed: int = 42) -> list[dict]:
    excluded = _load_processed_ids() | _load_existing_sample_ids()
    print(f"[extend] excluding {len(excluded)} already-processed/sampled image_ids")
    cols = ",".join(SAMPLE_COLS)
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    try:
        # Sample 2N to leave headroom for the post-filter, then we'll trim
        # to N once we've dropped already-processed.
        rows = con.execute(
            f"SELECT {cols} FROM images "
            f"WHERE subject_state != 'specimen' "
            f"ORDER BY RANDOM() LIMIT ?",
            (n * 3,),
        ).fetchall()
    finally:
        con.close()
    picked: list[dict] = []
    for r in rows:
        if r["image_id"] in excluded:
            continue
        # Verify file exists on disk so the pipeline doesn't fail mid-run
        if not (DATA_DIR / (r["filename"] or "")).exists():
            continue
        picked.append({c: (r[c] if r[c] is not None else "") for c in SAMPLE_COLS})
        if len(picked) >= n:
            break
    return picked


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--n", type=int, default=300)
    p.add_argument("--seed", type=int, default=42)
    args = p.parse_args()
    new_rows = pick_nonspecimen(args.n, args.seed)
    if not new_rows:
        print("[extend] no rows picked — nothing to append")
        return
    # Append to the existing sample parquet (concat + rewrite — file is tiny)
    new_df = pl.DataFrame(new_rows, schema={c: pl.Utf8 for c in SAMPLE_COLS})
    if SAMPLE_PARQUET_PATH.exists():
        existing = pl.read_parquet(SAMPLE_PARQUET_PATH)
        combined = pl.concat([existing, new_df], how="vertical_relaxed")
    else:
        combined = new_df
    combined.write_parquet(SAMPLE_PARQUET_PATH)
    by_source = {}
    for r in new_rows:
        by_source[r["source"]] = by_source.get(r["source"], 0) + 1
    print(f"[extend] appended {len(new_rows)} rows to {SAMPLE_PARQUET_PATH}")
    print(f"[extend] total rows now: {len(combined)}")
    print(f"[extend] new-row source breakdown:")
    for s, c in sorted(by_source.items()):
        print(f"  {s}: {c}")


if __name__ == "__main__":
    main()
