"""Batch inference: load joblib classifier(s), predict probabilities for every
sam3__sam3 row in the parquet, write predicted_<label>_p / _unreliable cols,
sync to SQLite `predictions`, and trigger gate recompute for the label.

V1: scalar-arm only. Future: image-arm and per-label winner-arm selection.

CONCURRENCY: This function reads, modifies, and rewrites the entire parquet
file. Do not run concurrently with classify.py (which also rewrites the
parquet on each batch flush). predict_labels_batched is preferred over
sequential predict_label_into_parquet calls because it amortizes the
~1.7s parquet I/O across all labels (1 read + 1 write instead of N each).
"""
from __future__ import annotations
import time
from pathlib import Path
from typing import Optional

import joblib
import numpy as np
import polars as pl

from scripts.detect_subjects.ml_labeler.features import (
    SCALAR_FEATURE_NAMES, scalar_feature_vector,
)
from scripts.detect_subjects.predictions_sync import (
    sync_predictions_from_parquet, model_version_for,
)
from scripts.detect_subjects.recompute_gate import recompute_for_label
from scripts.detect_subjects.sqlite_db import open_conn, DEFAULT_DB_PATH


def _load_bundle(label: str, models_dir: Optional[Path] = None) -> dict:
    if models_dir is None:
        from scripts.detect_subjects.ml_labeler import MODELS_DIR
        models_dir = MODELS_DIR
    model_path = models_dir / label / "arm_scalar_latest.joblib"
    bundle = joblib.load(model_path)
    if bundle.get("feature_names") != SCALAR_FEATURE_NAMES:
        raise ValueError(
            f"Feature-name drift between bundle and current features.py:\n"
            f"  bundle:  {bundle.get('feature_names')}\n"
            f"  current: {SCALAR_FEATURE_NAMES}\n"
            f"Retrain {label!r} after a features.py change."
        )
    return bundle


def warn_if_db_version_mismatch(
    label: str, bundle: dict, db_path: Optional[Path],
) -> None:
    """Print a warning if the joblib's trained_at would produce a
    model_version that doesn't appear in existing predictions.model_version
    for this label. Catches the C2 'silent drift' case where the joblib at
    HEAD has been rolled back but DB predictions still reference an older/
    newer version."""
    from scripts.detect_subjects.sqlite_db import open_conn, DEFAULT_DB_PATH
    if db_path is None:
        db_path = DEFAULT_DB_PATH
    expected = model_version_for(label, bundle)
    conn = open_conn(db_path)
    try:
        rows = conn.execute(
            "SELECT DISTINCT model_version FROM predictions WHERE label = ?",
            (label,),
        ).fetchall()
    finally:
        conn.close()
    versions = {r[0] for r in rows}
    if versions and expected not in versions:
        print(
            f"[predict:{label}] WARN: joblib trained_at would produce "
            f"model_version={expected!r} but DB has prediction(s) at "
            f"{sorted(versions)}. Run predict to overwrite DB with the joblib."
        )


def predict_labels_batched(
    labels: list[str],
    parquet_path: Path = Path("data/cache/framing_detections.parquet"),
    unreliable_threshold: int = 30,
    db_path: Optional[Path] = None,
    models_dir: Optional[Path] = None,
) -> dict[str, int]:
    """One parquet read + N inferences + one parquet write + sync to SQLite +
    gate recompute. Returns {label: n_rows_updated}."""
    if db_path is None:
        db_path = DEFAULT_DB_PATH
    bundles = {lbl: _load_bundle(lbl, models_dir) for lbl in labels}
    for lbl in labels:
        warn_if_db_version_mismatch(lbl, bundles[lbl], db_path)

    df = pl.read_parquet(parquet_path)
    # Restrict to sam3__sam3 rows that have a labelable subject. no_bug +
    # too_small cards have no bbox/mask, so most features are NaN. HGB
    # still emits a probability (defaulting to majority class) but it's
    # meaningless — these cards shouldn't appear in tab-specific views.
    # Leave their predicted_*_p as null so the UI can filter them out.
    # Also exclude close-ups (zoom shots of body parts) — students won't
    # see them in the gallery, so labels on them aren't useful.
    from scripts.detect_subjects.ml_labeler.train import _load_non_drawable_ids
    non_drawable = _load_non_drawable_ids(db_path)
    sam3_rows = df.filter(
        (pl.col("variant") == "sam3__sam3")
        & ~pl.col("framing_quality").is_in(["no_bug", "bug_too_small"])
        & ~pl.col("image_id").is_in(list(non_drawable))
    )
    X = np.stack([scalar_feature_vector(row) for row in sam3_rows.iter_rows(named=True)])
    sam3_ids = sam3_rows["image_id"].to_list()

    new_cols: list[pl.Expr] = []
    counts: dict[str, int] = {}
    model_versions: dict[str, str] = {}
    for lbl in labels:
        bundle = bundles[lbl]
        probs = bundle["clf"].predict_proba(X)[:, 1].astype(np.float32)
        prob_map = dict(zip(sam3_ids, probs))
        unreliable = bundle["n_positives"] < unreliable_threshold

        p_col = f"predicted_{lbl}_p"
        u_col = f"predicted_{lbl}_unreliable"
        new_p = df["image_id"].map_elements(
            lambda i: float(prob_map.get(i, float("nan"))), return_dtype=pl.Float64
        ).cast(pl.Float32)
        new_u = df["image_id"].map_elements(
            lambda i: bool(unreliable) if i in prob_map else None, return_dtype=pl.Boolean
        )
        new_cols += [new_p.alias(p_col), new_u.alias(u_col)]
        counts[lbl] = len(prob_map)
        model_versions[lbl] = model_version_for(lbl, bundle)

    df = df.with_columns(new_cols)
    df.write_parquet(parquet_path)
    for lbl, n in counts.items():
        print(f"[predict:{lbl}] updated {n} rows with prob+unreliable cols")

    # Sync to SQLite predictions + trigger gate recompute per label.
    now_s = int(time.time())
    sync_predictions_from_parquet(
        parquet_path, labels, model_versions=model_versions,
        now_s=now_s, db_path=db_path,
    )
    conn = open_conn(db_path)
    try:
        for lbl in labels:
            n = recompute_for_label(lbl, conn, now_s=now_s)
            print(f"[predict:{lbl}] gate recompute touched {n} rows")
    finally:
        conn.close()

    return counts


def predict_label_into_parquet(
    label: str,
    parquet_path: Path = Path("data/cache/framing_detections.parquet"),
    model_path: Optional[Path] = None,
    unreliable_threshold: int = 30,
    db_path: Optional[Path] = None,
    models_dir: Optional[Path] = None,
) -> int:
    """Single-label predict — convenience wrapper. Prefer predict_labels_batched
    when updating multiple labels at once."""
    counts = predict_labels_batched(
        [label], parquet_path=parquet_path,
        unreliable_threshold=unreliable_threshold,
        db_path=db_path, models_dir=models_dir,
    )
    return counts[label]


if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1:
        predict_label_into_parquet(sys.argv[1])
    else:
        from scripts.detect_subjects.ml_labeler import TIER1_LABELS
        predict_labels_batched(TIER1_LABELS)
