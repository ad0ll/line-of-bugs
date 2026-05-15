"""Render the static review HTML page from the detections parquet."""
from __future__ import annotations
import csv
import json
from pathlib import Path

import polars as pl

from scripts.detect_subjects.config import (
    PARQUET_PATH,
    VALIDATOR_DIR,
    MANIFEST_DIR,
)


TEMPLATE_PATH = Path(__file__).parent / "templates" / "index.html.j2"


def _load_manifest_index(manifest_dir: Path = MANIFEST_DIR) -> dict[str, dict]:
    idx: dict[str, dict] = {}
    for src in ["inaturalist", "bugwood", "smithsonian", "usda_ars"]:
        path = manifest_dir / f"{src}.csv"
        if not path.exists():
            continue
        with path.open("r", newline="") as f:
            for row in csv.DictReader(f):
                idx[row["image_id"]] = row
    return idx


def build_html_for_variant(
    variant: str,
    parquet_path: Path = PARQUET_PATH,
    out_dir: Path = VALIDATOR_DIR,
) -> Path:
    df = pl.read_parquet(parquet_path).filter(pl.col("variant") == variant)
    if df.height == 0:
        raise RuntimeError(f"no rows in parquet for variant={variant}")

    manifest = _load_manifest_index()

    records = []
    sources = set()
    for row in df.iter_rows(named=True):
        img_id = row["image_id"]
        mrow = manifest.get(img_id, {})
        crop_rel = f"crops/{variant}/{img_id}.jpg"
        crop_path = crop_rel if (out_dir / crop_rel).exists() else None

        records.append({
            "image_id": img_id,
            "source": row["source"],
            "framing_quality": row["framing_quality"],
            "bbox_x": row["bbox_x"], "bbox_y": row["bbox_y"],
            "bbox_w": row["bbox_w"], "bbox_h": row["bbox_h"],
            "bbox_area_ratio": row["bbox_area_ratio"],
            "post_crop_subject_area": row["post_crop_subject_area"],
            "confidence": row["confidence"],
            "lab_delta_e": row["lab_delta_e"],
            "offcenter": row["offcenter"],
            "n_distinct_detections": row["n_distinct_detections"],
            "gt_iou": row["gt_iou"],
            "common_name": mrow.get("common_name", ""),
            "taxon_species": mrow.get("taxon_species", ""),
            "original_path": mrow.get("filename", ""),
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
    html = html.replace("{{ root }}", "../..")
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
