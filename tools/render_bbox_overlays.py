"""Render bbox overlays for Claude's visual smoke test of detector output.

Two-tier protocol (per Phase 2 spec workflow):
  - Iterative 30-image samples DURING knob tuning loop (--n 30)
  - Final 50-image confidence check BEFORE handing to human review (--n 50)

For each sampled image: load the original from data/images/, draw the primary
bbox (pink), draw any secondaries (cyan), apply a red border if the matched
text_label is a NEGATIVE class (flower/leaf/stem/rock). Save JPEGs to the
output dir and write index.json so Claude can locate them by image_id.

Usage:
    .venv/bin/python -m tools.render_bbox_overlays \
        --variant sam3__sam3 --n 30 --out /tmp/bbox_check_30/
"""
from __future__ import annotations
import argparse
import json
import sqlite3
import sys
from pathlib import Path
from typing import Callable, Optional

import polars as pl
from PIL import Image, ImageDraw

from scripts.detect_subjects.config import DATA_DIR, PARQUET_PATH

DB_PATH = DATA_DIR / "db" / "line-of-bugs.db"

PRIMARY_COLOR = (255, 110, 199)         # pink
SECONDARY_COLOR = (103, 212, 230)       # cyan
NEGATIVE_BORDER_COLOR = (255, 70, 70)   # red
TEXT_COLOR = (255, 255, 255)            # white

NEGATIVE_CLASS_KEYWORDS = {"flower", "leaf", "stem", "rock"}


def _resolve_image_path_via_db(image_id: str) -> Optional[Path]:
    """Look up image_id -> filename via the SQLite DB."""
    if not DB_PATH.exists():
        return None
    con = sqlite3.connect(str(DB_PATH))
    try:
        row = con.execute(
            "SELECT filename FROM images WHERE image_id = ?", (image_id,),
        ).fetchone()
        if not row or not row[0]:
            return None
        return DATA_DIR / row[0]
    finally:
        con.close()


def sample_rows(df: pl.DataFrame, n: int, seed: int) -> pl.DataFrame:
    """Sample n rows deterministically; if df has < n, return all."""
    if df.height <= n:
        return df
    return df.sample(n=n, seed=seed, shuffle=True)


def _is_negative_class(text_label: Optional[str]) -> bool:
    if not text_label:
        return False
    stripped = text_label.strip().lower()
    for prefix in ("a ", "an ", "the "):
        if stripped.startswith(prefix):
            stripped = stripped[len(prefix):]
            break
    return any(kw == stripped or kw in stripped.split() for kw in NEGATIVE_CLASS_KEYWORDS)


def build_overlay_jpeg(
    image: Image.Image,
    bbox_xywh_normalized: Optional[tuple[float, float, float, float]],
    distinct_subjects: list,
    text_label: Optional[str] = None,
    text_label_score: Optional[float] = None,
) -> Image.Image:
    """Draw bboxes + text overlay onto a copy of the image. Returns the copy."""
    out = image.copy().convert("RGB")
    draw = ImageDraw.Draw(out)
    W, H = out.size

    # Draw secondaries first (cyan, behind primary).
    # distinct_subjects may be list-of-tuples (in-memory) OR list-of-dicts (from parquet struct).
    for s in distinct_subjects or []:
        if isinstance(s, dict):
            sx, sy, sw, sh = s.get("x"), s.get("y"), s.get("w"), s.get("h")
            if None in (sx, sy, sw, sh):
                continue
        else:
            if len(s) < 4:
                continue
            sx, sy, sw, sh = s[0], s[1], s[2], s[3]
        draw.rectangle(
            [sx * W, sy * H, (sx + sw) * W, (sy + sh) * H],
            outline=SECONDARY_COLOR, width=2,
        )

    # Draw primary
    if bbox_xywh_normalized is not None:
        x, y, w, h = bbox_xywh_normalized
        x1, y1, x2, y2 = x * W, y * H, (x + w) * W, (y + h) * H
        is_neg = _is_negative_class(text_label)
        color = NEGATIVE_BORDER_COLOR if is_neg else PRIMARY_COLOR
        draw.rectangle([x1, y1, x2, y2], outline=color, width=4)
        if text_label is not None:
            score_str = f"{text_label_score:.2f}" if text_label_score is not None else "?"
            label = f"{text_label}.{score_str}"
            draw.text((x1 + 4, max(0, y1 - 14)), label, fill=color)
    return out


def render_and_index(
    df: pl.DataFrame,
    n: int,
    seed: int,
    out_dir: Path,
    resolve_image_path: Callable[[str], Optional[Path]] = _resolve_image_path_via_db,
) -> list[dict]:
    """Sample n rows, render overlays, save JPEGs + index.json. Return the index list."""
    out_dir.mkdir(parents=True, exist_ok=True)
    sampled = sample_rows(df, n=n, seed=seed)

    index: list[dict] = []
    for i, row in enumerate(sampled.iter_rows(named=True)):
        image_id = row["image_id"]
        img_path = resolve_image_path(image_id)
        if img_path is None or not img_path.exists():
            index.append({
                "image_id": image_id, "overlay_jpeg": None,
                "error": f"image file not found at {img_path}",
            })
            continue

        with Image.open(img_path) as src:
            src = src.convert("RGB")
            bbox = None
            if row.get("bbox_x") is not None:
                bbox = (row["bbox_x"], row["bbox_y"], row["bbox_w"], row["bbox_h"])
            distinct = row.get("distinct_subjects") or []
            out = build_overlay_jpeg(
                src, bbox, distinct,
                text_label=row.get("text_label"),
                text_label_score=row.get("text_label_score"),
            )
            fname = f"{i:03d}_{image_id}.jpg"
            out.save(out_dir / fname, "JPEG", quality=85)
            index.append({
                "image_id": image_id,
                "overlay_jpeg": fname,
                "variant": row.get("variant"),
                "text_label": row.get("text_label"),
                "text_label_score": row.get("text_label_score"),
                "bbox_xywh": bbox,
                "n_distinct": len(distinct),
            })

    (out_dir / "index.json").write_text(json.dumps(index, indent=2))
    return index


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--variant", required=True, help="parquet variant tag (e.g., sam3__sam3)")
    parser.add_argument("--n", type=int, default=30, help="sample size (30 iterative / 50 final)")
    parser.add_argument("--out", type=Path, required=True, help="output directory")
    parser.add_argument("--seed", type=int, default=42, help="sampling seed")
    parser.add_argument("--seed-fresh", action="store_true",
                        help="use a fresh time-based seed (for final 50-check)")
    parser.add_argument("--parquet", type=Path, default=PARQUET_PATH)
    args = parser.parse_args()

    seed = args.seed
    if args.seed_fresh:
        import time
        seed = int(time.time())

    df = pl.read_parquet(args.parquet).filter(pl.col("variant") == args.variant)
    if df.height == 0:
        print(f"ERROR: no rows in parquet for variant={args.variant!r}", file=sys.stderr)
        return 1

    index = render_and_index(df, n=args.n, seed=seed, out_dir=args.out)
    n_ok = sum(1 for e in index if e.get("overlay_jpeg"))
    n_err = sum(1 for e in index if e.get("error"))
    print(f"rendered: {n_ok} ok, {n_err} errors, sample seed={seed}")
    print(f"index: {args.out / 'index.json'}")
    print(f"\nClaude: use the Read tool on each {args.out}/*.jpg to visually inspect.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
