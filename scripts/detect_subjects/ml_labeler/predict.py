"""Batch inference: load joblib classifier, predict probabilities for every
sam3__sam3 row in the parquet, write predicted_<label>_p and _unreliable cols.

V1: scalar-arm only. Future: image-arm and per-label winner-arm selection.

CONCURRENCY: This function reads, modifies, and rewrites the entire parquet
file. Do not run concurrently with classify.py (which also rewrites the
parquet on each batch flush). No lock is taken. In V1's single-user dev
flow this is acceptable; revisit if classify and predict ever run in
parallel.
"""
from __future__ import annotations
from pathlib import Path
from typing import Optional

import joblib
import numpy as np
import polars as pl

from scripts.detect_subjects.ml_labeler.features import (
    SCALAR_FEATURE_NAMES, scalar_feature_vector,
)


def predict_label_into_parquet(
    label: str,
    parquet_path: Path = Path("data/cache/framing_detections.parquet"),
    model_path: Optional[Path] = None,
    unreliable_threshold: int = 30,
) -> int:
    """Run inference for `label` on all sam3 rows. Writes:
       predicted_<label>_p (float32), predicted_<label>_unreliable (bool).
    Returns count of rows updated."""
    if model_path is None:
        from scripts.detect_subjects.ml_labeler import MODELS_DIR
        model_path = MODELS_DIR / label / "arm_scalar_latest.joblib"
    bundle = joblib.load(model_path)
    clf = bundle["clf"]
    if bundle.get("feature_names") != SCALAR_FEATURE_NAMES:
        raise ValueError(
            f"Feature-name drift between bundle and current features.py:\n"
            f"  bundle:  {bundle.get('feature_names')}\n"
            f"  current: {SCALAR_FEATURE_NAMES}\n"
            f"Retrain {label!r} after a features.py change."
        )
    unreliable = bundle["n_positives"] < unreliable_threshold

    df = pl.read_parquet(parquet_path)
    sam3_mask = df["variant"] == "sam3__sam3"

    # Build feature matrix for sam3 rows only
    sam3_rows = df.filter(sam3_mask)
    X = np.stack([scalar_feature_vector(row) for row in sam3_rows.iter_rows(named=True)])

    probs = clf.predict_proba(X)[:, 1].astype(np.float32)

    # Build a mapping image_id → prob for sam3 rows, then join back
    sam3_ids = sam3_rows["image_id"].to_list()
    prob_map = dict(zip(sam3_ids, probs))

    p_col = f"predicted_{label}_p"
    u_col = f"predicted_{label}_unreliable"
    new_p = df["image_id"].map_elements(
        lambda i: float(prob_map.get(i, float("nan"))), return_dtype=pl.Float64
    ).cast(pl.Float32)
    new_u = df["image_id"].map_elements(
        lambda i: bool(unreliable) if i in prob_map else None, return_dtype=pl.Boolean
    )
    df = df.with_columns([new_p.alias(p_col), new_u.alias(u_col)])

    df.write_parquet(parquet_path)
    n = len(prob_map)
    print(f"[predict:{label}] updated {n} rows with prob+unreliable cols")
    return n


if __name__ == "__main__":
    import sys
    label = sys.argv[1] if len(sys.argv) > 1 else "mask_blur_unusable"
    predict_label_into_parquet(label)
