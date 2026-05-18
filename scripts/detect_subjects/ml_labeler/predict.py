"""Batch inference: load joblib classifier(s), predict probabilities for every
sam3__sam3 row in the parquet, write predicted_<label>_p and _unreliable cols.

V1: scalar-arm only. Future: image-arm and per-label winner-arm selection.

CONCURRENCY: This function reads, modifies, and rewrites the entire parquet
file. Do not run concurrently with classify.py (which also rewrites the
parquet on each batch flush). predict_labels_batched is preferred over
sequential predict_label_into_parquet calls because it amortizes the
~1.7s parquet I/O across all labels (1 read + 1 write instead of N each).
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


def _load_bundle(label: str) -> dict:
    from scripts.detect_subjects.ml_labeler import MODELS_DIR
    model_path = MODELS_DIR / label / "arm_scalar_latest.joblib"
    bundle = joblib.load(model_path)
    if bundle.get("feature_names") != SCALAR_FEATURE_NAMES:
        raise ValueError(
            f"Feature-name drift between bundle and current features.py:\n"
            f"  bundle:  {bundle.get('feature_names')}\n"
            f"  current: {SCALAR_FEATURE_NAMES}\n"
            f"Retrain {label!r} after a features.py change."
        )
    return bundle


def predict_labels_batched(
    labels: list[str],
    parquet_path: Path = Path("data/cache/framing_detections.parquet"),
    unreliable_threshold: int = 30,
) -> dict[str, int]:
    """One parquet read + N model inferences + one parquet write. Returns
    {label: n_rows_updated}."""
    bundles = {lbl: _load_bundle(lbl) for lbl in labels}

    df = pl.read_parquet(parquet_path)
    # Restrict to sam3__sam3 rows that have a labelable subject. no_bug +
    # too_small cards have no bbox/mask, so most features are NaN. HGB
    # still emits a probability (defaulting to majority class) but it's
    # meaningless — these cards shouldn't appear in tab-specific views.
    # Leave their predicted_*_p as null so the UI can filter them out.
    sam3_rows = df.filter(
        (pl.col("variant") == "sam3__sam3")
        & ~pl.col("framing_quality").is_in(["no_bug", "bug_too_small"])
    )
    X = np.stack([scalar_feature_vector(row) for row in sam3_rows.iter_rows(named=True)])
    sam3_ids = sam3_rows["image_id"].to_list()

    new_cols: list[pl.Expr] = []
    counts: dict[str, int] = {}
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

    df = df.with_columns(new_cols)
    df.write_parquet(parquet_path)
    for lbl, n in counts.items():
        print(f"[predict:{lbl}] updated {n} rows with prob+unreliable cols")
    return counts


def predict_label_into_parquet(
    label: str,
    parquet_path: Path = Path("data/cache/framing_detections.parquet"),
    model_path: Optional[Path] = None,
    unreliable_threshold: int = 30,
) -> int:
    """Single-label predict — convenience wrapper. Prefer predict_labels_batched
    when updating multiple labels at once."""
    counts = predict_labels_batched(
        [label], parquet_path=parquet_path,
        unreliable_threshold=unreliable_threshold,
    )
    return counts[label]


if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1:
        predict_label_into_parquet(sys.argv[1])
    else:
        from scripts.detect_subjects.ml_labeler import TIER1_LABELS
        predict_labels_batched(TIER1_LABELS)
