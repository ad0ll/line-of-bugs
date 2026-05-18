"""Sync parquet (framing_detections.parquet) → SQLite `detections` table.

Latest-variant-wins per image_id: when a parquet row exists for both
grounding_dino and sam3, the larger processed_at wins. Idempotent —
re-running with the same parquet is a no-op.

gate_rule_only is derived from suggested_labels via the same rule-tier
reject-label set used by recompute_gate.py — same logic classify.py uses
for the parquet's gate_decision column. The two implementations are
intentionally separate because detections.gate_rule_only is an analytics
baseline computed once at sync time, while recompute_gate recomputes the
full hierarchy at decision time.
"""
from __future__ import annotations
import json
import sqlite3
from pathlib import Path
from typing import Any, Optional

import polars as pl

from scripts.detect_subjects.sqlite_db import open_conn, DEFAULT_DB_PATH


_REJECT_RULE_LABELS = frozenset({
    "bbox-content_no-bug",
    "bbox-content_bbox-multibug_unusable",
    "bbox-content_subject-too-small",
})

_COLS = (
    "image_id", "variant", "suggested_labels", "gate_rule_only", "has_bbox",
    "bbox_x", "bbox_y", "bbox_w", "bbox_h",
    "mask_area_ratio", "lab_delta_e", "boundary_sharpness", "mask_iou_score",
    "crop_x", "crop_y", "crop_w", "crop_h", "post_crop_subject_area",
    "processed_at", "schema_version",
)
_UPDATE_COLS = tuple(c for c in _COLS if c != "image_id")

_UPSERT_SQL = (
    f"INSERT INTO detections ({', '.join(_COLS)}) "
    f"VALUES ({', '.join('?' for _ in _COLS)}) "
    f"ON CONFLICT(image_id) DO UPDATE SET "
    + ", ".join(f"{c}=excluded.{c}" for c in _UPDATE_COLS)
)


def _rule_gate(suggested_labels: list[str]) -> str:
    """Return 'keep' or 'reject' from the rule output alone."""
    for lbl in suggested_labels:
        if lbl in _REJECT_RULE_LABELS:
            return "reject"
    return "keep"


def _val(row: dict, col: str) -> Any:
    """Coerce polars-row scalars; polars hands back numpy types occasionally."""
    v = row.get(col)
    if v is None:
        return None
    if hasattr(v, "item"):  # numpy scalar
        return v.item()
    return v


def sync_detections_from_parquet(
    parquet_path: Path,
    db_path: Optional[Path] = None,
) -> dict:
    """Upsert detections from parquet. Returns {upserted, skipped_orphans}."""
    if db_path is None:
        db_path = DEFAULT_DB_PATH
    df = pl.read_parquet(parquet_path)
    # Pick the latest processed_at row per image_id.
    df = df.sort("processed_at", descending=True).unique(
        subset=["image_id"], keep="first", maintain_order=True,
    )

    conn = open_conn(db_path)
    try:
        existing_image_ids = {
            r[0] for r in conn.execute("SELECT image_id FROM images")
        }
        upserted = 0
        skipped_orphans = 0
        conn.execute("BEGIN")
        for row in df.iter_rows(named=True):
            image_id = row["image_id"]
            if image_id not in existing_image_ids:
                skipped_orphans += 1
                continue
            suggested = list(row.get("suggested_labels") or [])
            gate = _rule_gate(suggested)
            has_bbox = 1 if row.get("bbox_x") is not None else 0
            values = (
                image_id,
                row["variant"],
                json.dumps(suggested),
                gate,
                has_bbox,
                _val(row, "bbox_x"), _val(row, "bbox_y"),
                _val(row, "bbox_w"), _val(row, "bbox_h"),
                _val(row, "mask_area_ratio"),
                _val(row, "lab_delta_e"),
                _val(row, "boundary_sharpness"),
                _val(row, "mask_iou_score"),
                _val(row, "crop_x"), _val(row, "crop_y"),
                _val(row, "crop_w"), _val(row, "crop_h"),
                _val(row, "post_crop_subject_area"),
                _val(row, "processed_at"),
                _val(row, "schema_version"),
            )
            conn.execute(_UPSERT_SQL, values)
            upserted += 1
        conn.commit()
    finally:
        conn.close()

    print(f"[sync:detections] {upserted} upserted, {skipped_orphans} orphans skipped")
    return {"upserted": upserted, "skipped_orphans": skipped_orphans}


if __name__ == "__main__":
    from scripts.detect_subjects.config import PARQUET_PATH
    sync_detections_from_parquet(PARQUET_PATH)
