"""Per-label training — V1: scalar-arm scikit-learn HistGradientBoostingClassifier
(TabPFN-v2 deferred pending license token) for mask_blur_unusable.

Loads framing_detections.parquet + SQLite image_labels, builds (X, y) for one
label, runs 5x5 stratified CV, fits a final model on all data, persists
joblib + metrics + writes suggested_threshold (recall ≥ 0.95) into
label_thresholds.

Future (Plan 2+): adds image arm (DINOv3+DoRA), runs both arms, picks winner.
"""
from __future__ import annotations
import json
import time
from pathlib import Path
from typing import Optional

import joblib
import numpy as np
import polars as pl

from scripts.detect_subjects.ml_labeler.features import (
    SCALAR_FEATURE_NAMES, scalar_feature_vector,
)
from scripts.detect_subjects.ml_labeler.evaluation import cv_evaluate
from scripts.detect_subjects.sqlite_db import open_conn, DEFAULT_DB_PATH
from scripts.detect_subjects.image_labels_io import fetch_all_reviewed_labels


def _load_non_drawable_ids(db_path: Optional[Path] = None) -> set[str]:
    """image_ids the gallery will never show students, regardless of label.
    Currently: bugwood close-ups (zoom shots of body parts — useless for
    gesture drawing). Queried from SQLite once per training run.
    """
    from scripts.detect_subjects.sqlite_db import open_conn, DEFAULT_DB_PATH
    if db_path is None:
        db_path = DEFAULT_DB_PATH
    if not Path(db_path).exists():
        return set()
    conn = open_conn(db_path)
    try:
        rows = conn.execute(
            "SELECT image_id FROM images WHERE view_label = 'close-up'"
        ).fetchall()
        return {r[0] for r in rows}
    finally:
        conn.close()


def _load_xy_for_label(
    parquet_path: Path, db_path: Path, label: str,
) -> tuple[np.ndarray, np.ndarray, list[str]]:
    """Return X (n,12), y (n,), image_ids list. Only sam3__sam3 rows whose
    image_id has a reviewed, user_edited row in image_labels are included.

    Excludes:
      - framing_quality in ('bug_too_small', 'no_bug') — non-drawable detections
      - bugwood close-ups (view_label='close-up') — zoom shots of body parts
    """
    conn = open_conn(db_path)
    try:
        labels = fetch_all_reviewed_labels(conn)
    finally:
        conn.close()
    non_drawable = _load_non_drawable_ids(db_path)
    df = pl.read_parquet(parquet_path).filter(pl.col("variant") == "sam3__sam3")
    X_rows, y_rows, ids = [], [], []
    for row in df.iter_rows(named=True):
        iid = row["image_id"]
        lbl = labels.get(iid)
        if not lbl or not lbl.get("user_edited"):
            continue
        # 'unsure' = user couldn't decide; not a negative example — exclude.
        if lbl.get("unsure"):
            continue
        # Skip non-drawable detections — students never see them in the
        # gallery, and including them poisons training with bad-feature rows.
        if row.get("framing_quality") in ("bug_too_small", "no_bug"):
            continue
        # Close-ups (bugwood view_label='close-up') are zoom shots of body
        # parts — useless for gesture drawing.
        if iid in non_drawable:
            continue
        col3 = lbl.get("col3") or []
        if label in col3:
            y_rows.append(1)
        elif lbl.get("col1") is not None or lbl.get("col2_count") is not None:
            y_rows.append(0)
        else:
            continue  # empty record, ambiguous — skip
        X_rows.append(scalar_feature_vector(row))
        ids.append(iid)
    X = np.asarray(X_rows, dtype=np.float32)
    y = np.asarray(y_rows, dtype=np.int8)
    return X, y, ids


def _scalar_clf_factory():
    """Fresh HistGradientBoostingClassifier per CV fold.

    class_weight='balanced' is load-bearing: bad-photo-quality is 32/240 and
    poor-contrast is similar — without rebalancing the unweighted loss lets
    the model predict ~0 for the minority class and call it a day (P≈1, R≈0).
    Weighted loss penalizes minority misses ~7x more, restoring usable recall
    at low-precision targets.
    """
    from sklearn.ensemble import HistGradientBoostingClassifier
    return HistGradientBoostingClassifier(
        random_state=42, max_iter=200, class_weight="balanced",
    )


def train_label(
    label: str,
    parquet_path: Path = Path("data/cache/framing_detections.parquet"),
    db_path: Path = DEFAULT_DB_PATH,
    out_dir: Optional[Path] = None,
    random_state: int = 42,
) -> dict:
    """Train scalar-arm HistGradientBoosting classifier for `label`. Returns metrics.

    Also writes label_thresholds.suggested_threshold for `label` (recall ≥ 0.95
    on the CV held-out probabilities). Does NOT touch the live `threshold`
    column — that is human-edited only.
    """
    if out_dir is None:
        from scripts.detect_subjects.ml_labeler import MODELS_DIR
        out_dir = MODELS_DIR / label
    out_dir.mkdir(parents=True, exist_ok=True)

    X, y, ids = _load_xy_for_label(parquet_path, db_path, label)
    n_pos = int(y.sum())
    n_total = len(y)
    print(f"[train:{label}] n_total={n_total}, n_positives={n_pos}")

    if n_pos < 5 or n_total - n_pos < 5:
        raise ValueError(
            f"Label {label!r} too imbalanced: {n_pos} pos / {n_total-n_pos} neg. "
            "Need >=5 of each class."
        )

    t0 = time.perf_counter()
    cv_metrics = cv_evaluate(_scalar_clf_factory, X, y, n_splits=5, n_repeats=5,
                             random_state=random_state)
    cv_elapsed = time.perf_counter() - t0
    print(f"[train:{label}] CV ({cv_metrics['n_folds']} folds) in {cv_elapsed:.1f}s: "
          f"MCC={cv_metrics['mcc_mean']:.3f}±{cv_metrics['mcc_std']:.3f}, "
          f"PR-AUC={cv_metrics['pr_auc_mean']:.3f}, Brier={cv_metrics['brier_mean']:.3f}")

    final_clf = _scalar_clf_factory()
    final_clf.fit(X, y)
    trained_at = int(time.time())
    model_path = out_dir / "arm_scalar_latest.joblib"
    joblib.dump({
        "label": label, "arm": "scalar",
        "clf_class": type(final_clf).__name__,
        "clf": final_clf,
        "feature_names": SCALAR_FEATURE_NAMES,
        "n_train": n_total, "n_positives": n_pos,
        "trained_at": trained_at,
    }, model_path)
    print(f"[train:{label}] persisted → {model_path}")

    # Write the recall ≥ 0.95 suggested threshold from CV held-out probs.
    suggested = _recall_threshold(cv_metrics, target_recall=0.95)
    if suggested is not None:
        _write_suggested_threshold(db_path, label, suggested, trained_at)

    metrics = {
        "label": label, "n_total": n_total, "n_positives": n_pos,
        "arm_scalar": cv_metrics,
        "trained_at": trained_at,
        "cv_elapsed_s": round(cv_elapsed, 1),
        "suggested_threshold": suggested,
    }
    (out_dir / "metrics.json").write_text(json.dumps(metrics, indent=2))
    return metrics


def _recall_threshold(cv_metrics: dict, target_recall: float) -> Optional[float]:
    """Largest threshold such that mean recall >= target_recall.
    Requires cv_metrics to include 'p_holdout' (concatenated CV-fold probs)
    and 'y_holdout'. Returns None if cv_evaluate didn't surface them."""
    p = cv_metrics.get("p_holdout")
    y = cv_metrics.get("y_holdout")
    if p is None or y is None:
        return None
    p = np.asarray(p)
    y = np.asarray(y)
    if not y.any():
        return None
    sorted_p = np.sort(np.unique(p))[::-1]
    for t in sorted_p:
        recall = ((p >= t) & (y == 1)).sum() / max(int(y.sum()), 1)
        if recall >= target_recall:
            return float(t)
    return float(sorted_p[-1])


def _write_suggested_threshold(
    db_path: Path, label: str, value: float, now_s: int,
) -> None:
    conn = open_conn(db_path)
    try:
        # Update only suggested_threshold + updated_at. Per spec, `threshold`
        # is human-edited and not touched here.
        conn.execute(
            "UPDATE label_thresholds SET suggested_threshold = ?, updated_at = ? "
            "WHERE label = ?",
            (value, now_s, label),
        )
        conn.commit()
    finally:
        conn.close()


if __name__ == "__main__":
    import sys
    label = sys.argv[1] if len(sys.argv) > 1 else "mask_blur_unusable"
    train_label(label)
