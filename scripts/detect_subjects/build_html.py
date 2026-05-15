"""Render the static review HTML page from the detections parquet.

Reads image metadata (filename, common_name, taxon_species) from the
SQLite DB (post-round-5: the CSV manifest layer was dropped).
"""
from __future__ import annotations
import json
import sqlite3
from pathlib import Path

import polars as pl

from scripts.detect_subjects.config import (
    DATA_DIR,
    PARQUET_PATH,
    VALIDATOR_DIR,
)


TEMPLATE_PATH = Path(__file__).parent / "templates" / "index.html.j2"
DB_PATH = DATA_DIR / "db" / "line-of-bugs.db"


def _load_db_index() -> dict[str, dict]:
    """Map image_id -> {filename, common_name, taxon_species}."""
    idx: dict[str, dict] = {}
    if not DB_PATH.exists():
        return idx
    con = sqlite3.connect(DB_PATH)
    try:
        cur = con.execute(
            "SELECT image_id, filename, common_name, taxon_species FROM images"
        )
        for image_id, filename, common, species in cur:
            idx[image_id] = {
                "filename": filename or "",
                "common_name": common or "",
                "taxon_species": species or "",
            }
    finally:
        con.close()
    return idx


def build_html_for_variant(
    variant: str,
    parquet_path: Path = PARQUET_PATH,
    out_dir: Path = VALIDATOR_DIR,
) -> Path:
    df = pl.read_parquet(parquet_path).filter(pl.col("variant") == variant)
    if df.height == 0:
        raise RuntimeError(f"no rows in parquet for variant={variant}")

    db_index = _load_db_index()

    records = []
    sources = set()
    for row in df.iter_rows(named=True):
        img_id = row["image_id"]
        mrow = db_index.get(img_id, {})
        crop_rel = f"crops/{variant}/{img_id}.jpg"
        crop_path = crop_rel if (out_dir / crop_rel).exists() else None

        records.append({
            "image_id": img_id,
            "source": row["source"],
            "framing_quality": row["framing_quality"],
            "bbox_x": row["bbox_x"], "bbox_y": row["bbox_y"],
            "bbox_w": row["bbox_w"], "bbox_h": row["bbox_h"],
            "bbox_area_ratio": row["bbox_area_ratio"],
            "bbox_min_edge_px": row.get("bbox_min_edge_px"),
            "bbox_long_edge_px": row.get("bbox_long_edge_px"),
            "bbox_touches_edge": row.get("bbox_touches_edge"),
            "post_crop_subject_area": row["post_crop_subject_area"],
            "confidence": row["confidence"],
            "lab_delta_e": row["lab_delta_e"],
            "subject_sharpness": row.get("subject_sharpness"),
            "offcenter": row["offcenter"],
            "n_distinct_detections": row["n_distinct_detections"],
            "gt_iou": row["gt_iou"],
            "common_name": mrow.get("common_name", ""),
            "taxon_species": mrow.get("taxon_species", ""),
            # Resolved relative to the HTML's location at audit/framing-validator/<f>.html.
            # DB stores filenames as "images/<file>.jpg" relative to data/, so we go up
            # two levels then into data/. Crops live next to the HTML.
            "original_path": f"../../data/{mrow.get('filename', '')}",
            "crop_path": crop_path,
        })
        sources.add(row["source"])

    sources_html = "".join(
        f'<option value="{s}">{s}</option>' for s in sorted(sources)
    )
    template_text = TEMPLATE_PATH.read_text()
    html = template_text.replace("{{ variant }}", variant)
    html = html.replace("{{ data_json }}", json.dumps(records))
    html = html.replace("{{ total }}", str(len(records)))
    html = html.replace(
        '{% for s in sources %}<option value="{{ s }}">{{ s }}</option>{% endfor %}',
        sources_html,
    )

    out_path = out_dir / f"{variant}.html"
    out_path.write_text(html)
    return out_path


if __name__ == "__main__":
    import sys
    variant = sys.argv[1] if len(sys.argv) > 1 else "v1_dino_insectsam"
    p = build_html_for_variant(variant)
    print(f"wrote {p}")
