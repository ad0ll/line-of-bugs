"""One-off backfill: emit secondary bbox locations per image.

The detection schema only stores ONE bbox per image (the primary subject), but
the detector internally clusters multiple distinct subject instances. When a
human validator sees `multi-bug` flagged, they want to know *where* the system
thinks the other bugs are. This script re-runs DINO over the validator sample,
extracts every distinct subject bbox via center-clustering, drops the one that
overlaps the parquet's stored primary, and writes the rest to a sidecar JSON:

    data/cache/secondary_bboxes.json
      → { image_id: [[x, y, w, h, conf], ...] }
      normalized xywh + DINO confidence; primary excluded.

build_html.py reads this sidecar and the template renders dashed gray boxes
on the original-image overlay. The sidecar approach keeps the parquet schema
untouched while restoring the multi-bug visibility the validator needs.
"""
from __future__ import annotations
import json
from pathlib import Path

import polars as pl
import torch
from PIL import Image

from scripts.detect_subjects.config import CACHE_DIR, DATA_DIR, PARQUET_PATH
from scripts.detect_subjects.detector_dino import GroundingDinoDetector
from scripts.detect_subjects.metrics import iou_xywh_normalized

OUT_PATH = CACHE_DIR / "secondary_bboxes.json"

# Two distinct-subject boxes count as the "same" detection if they overlap
# heavily. The primary stored in the parquet is the one whose IoU with a
# distinct-subject box exceeds this threshold. Tuned conservatively: 0.5
# leaves real adjacent bugs (which never overlap that strongly) while still
# matching the bark-beetle case where the primary differs slightly from the
# top-conf box.
PRIMARY_IOU_MATCH = 0.5


def _load_sample_index() -> dict[str, dict]:
    """image_id → {filename, source} from the validator sample parquet."""
    sample = pl.read_parquet(CACHE_DIR / "validator_sample.parquet")
    idx: dict[str, dict] = {}
    for r in sample.iter_rows(named=True):
        idx[r["image_id"]] = {"filename": r["filename"], "source": r["source"]}
    return idx


def _existing_secondaries() -> dict[str, list]:
    if OUT_PATH.exists():
        try:
            return json.loads(OUT_PATH.read_text())
        except Exception:
            return {}
    return {}


def main(variant: str = "v1_dino_insectsam") -> None:
    parquet = pl.read_parquet(PARQUET_PATH).filter(pl.col("variant") == variant)
    sample_idx = _load_sample_index()
    out = _existing_secondaries()

    detector = GroundingDinoDetector(device="mps", dtype=torch.float32)

    n_total = parquet.height
    n_processed = 0
    n_skipped_existing = 0
    n_missing = 0

    for row in parquet.iter_rows(named=True):
        image_id = row["image_id"]
        if image_id in out:
            n_skipped_existing += 1
            continue
        meta = sample_idx.get(image_id)
        if not meta:
            n_missing += 1
            continue
        img_path = DATA_DIR / meta["filename"]
        if not img_path.exists():
            n_missing += 1
            continue

        with Image.open(img_path) as im:
            im = im.convert("RGB")
            det = detector.detect(im, image_id=image_id)

        # Single-detection images: nothing to overlay.
        if not det.distinct_subjects or len(det.distinct_subjects) <= 1:
            out[image_id] = []
        else:
            primary = None
            if row["bbox_x"] is not None:
                primary = (row["bbox_x"], row["bbox_y"], row["bbox_w"], row["bbox_h"])
            secondaries: list[list[float]] = []
            for s in det.distinct_subjects:
                cand = (s[0], s[1], s[2], s[3])
                if primary is not None and iou_xywh_normalized(cand, primary) >= PRIMARY_IOU_MATCH:
                    continue
                secondaries.append([
                    float(s[0]), float(s[1]), float(s[2]), float(s[3]), float(s[4]),
                ])
            out[image_id] = secondaries

        n_processed += 1
        if n_processed % 20 == 0:
            OUT_PATH.write_text(json.dumps(out))
            print(f"[secondary] {n_processed}/{n_total - n_skipped_existing} processed")

    OUT_PATH.write_text(json.dumps(out))
    print(f"[secondary] done. processed={n_processed} skipped_existing={n_skipped_existing} missing={n_missing} total={n_total}")
    print(f"[secondary] wrote {OUT_PATH}")
    n_with_secondaries = sum(1 for v in out.values() if v)
    print(f"[secondary] {n_with_secondaries}/{len(out)} images have ≥1 secondary bbox")


if __name__ == "__main__":
    main()
