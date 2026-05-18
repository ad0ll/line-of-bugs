"""Sync parquet predicted_<label>_p columns → SQLite `predictions`.

One row per (image_id, label). model_version is supplied by the caller
(predict.py reads it from the joblib bundle's `trained_at` int). Rows
with NaN/None probability are skipped — a NaN p means the model didn't
score this image (typically non-sam3 variants for a sam3-trained label).
"""
from __future__ import annotations
import math
import sqlite3
from pathlib import Path
from typing import Optional

import polars as pl

from scripts.detect_subjects.sqlite_db import open_conn, DEFAULT_DB_PATH


_UPSERT_SQL = (
    "INSERT INTO predictions "
    "(image_id, label, p, unreliable, model_version, predicted_at) "
    "VALUES (?, ?, ?, ?, ?, ?) "
    "ON CONFLICT(image_id, label) DO UPDATE SET "
    "p=excluded.p, "
    "unreliable=excluded.unreliable, "
    "model_version=excluded.model_version, "
    "predicted_at=excluded.predicted_at"
)


def sync_predictions_from_parquet(
    parquet_path: Path,
    labels: list[str],
    model_versions: dict[str, str],
    now_s: int,
    db_path: Optional[Path] = None,
) -> dict[str, dict]:
    """Upsert predictions for `labels`. Returns {label: {upserted: int}}."""
    if db_path is None:
        db_path = DEFAULT_DB_PATH
    df = pl.read_parquet(parquet_path)
    image_ids = df["image_id"].to_list()
    results: dict[str, dict] = {}

    conn = open_conn(db_path)
    try:
        existing_image_ids = {
            r[0] for r in conn.execute("SELECT image_id FROM images")
        }
        for label in labels:
            p_col = f"predicted_{label}_p"
            u_col = f"predicted_{label}_unreliable"
            if p_col not in df.columns:
                results[label] = {"upserted": 0, "missing_column": True}
                continue
            probs = df[p_col].to_list()
            unrel = df[u_col].to_list() if u_col in df.columns else [False] * len(probs)
            mv = model_versions[label]
            upserted = 0
            conn.execute("BEGIN")
            for iid, p, u in zip(image_ids, probs, unrel):
                if iid not in existing_image_ids:
                    continue
                if p is None or (isinstance(p, float) and math.isnan(p)):
                    continue
                conn.execute(_UPSERT_SQL, (
                    iid, label, float(p),
                    int(bool(u)) if u is not None else 0,
                    mv, now_s,
                ))
                upserted += 1
            conn.commit()
            results[label] = {"upserted": upserted}
            print(f"[sync:predictions:{label}] {upserted} upserted")
    finally:
        conn.close()
    return results


def model_version_for(label: str, bundle: dict) -> str:
    """Format the model_version string from a loaded joblib bundle."""
    return f"{label}@{bundle['trained_at']}"
