"""Per-label training — V1: scalar-arm TabPFN-v2 for mask_blur_unusable.

Loads framing_detections.parquet + labels.json, builds (X, y) for one label,
runs 5x5 stratified CV, fits a final model on all data, persists joblib + metrics.

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


def _load_xy_for_label(
    parquet_path: Path, labels_path: Path, label: str,
) -> tuple[np.ndarray, np.ndarray, list[str]]:
    """Return X (n,12), y (n,), image_ids list. Only sam3__sam3 rows with a
    reviewed labels.json entry are included."""
    labels = json.loads(labels_path.read_text())
    df = pl.read_parquet(parquet_path).filter(pl.col("variant") == "sam3__sam3")
    X_rows, y_rows, ids = [], [], []
    for row in df.iter_rows(named=True):
        iid = row["image_id"]
        lbl = labels.get(iid)
        if not lbl or not lbl.get("reviewed_at") or not lbl.get("user_edited"):
            continue
        # Determine label class
        if label in (lbl.get("col3") or []):
            y_rows.append(1)
        elif lbl.get("col1") is not None or lbl.get("col2_count") is not None:
            # User looked at this card and chose not to mark this label.
            y_rows.append(0)
        else:
            continue  # truly empty label = unclear; skip
        X_rows.append(scalar_feature_vector(row))
        ids.append(iid)
    X = np.asarray(X_rows, dtype=np.float32)
    y = np.asarray(y_rows, dtype=np.int8)
    return X, y, ids


def _tabpfn_factory():
    """Fresh TabPFNClassifier per CV fold (in-context, no shared state)."""
    from tabpfn import TabPFNClassifier
    return TabPFNClassifier(device="cpu", n_jobs=1, ignore_pretraining_limits=True)


def train_label(
    label: str,
    parquet_path: Path = Path("data/cache/framing_detections.parquet"),
    labels_path: Path = Path("data/cache/labels.json"),
    out_dir: Optional[Path] = None,
    random_state: int = 42,
) -> dict:
    """Train scalar-arm TabPFN classifier for `label`. Returns metrics dict."""
    if out_dir is None:
        from scripts.detect_subjects.ml_labeler import MODELS_DIR
        out_dir = MODELS_DIR / label
    out_dir.mkdir(parents=True, exist_ok=True)

    X, y, ids = _load_xy_for_label(parquet_path, labels_path, label)
    n_pos = int(y.sum())
    n_total = len(y)
    print(f"[train:{label}] n_total={n_total}, n_positives={n_pos}")

    if n_pos < 5 or n_total - n_pos < 5:
        raise ValueError(
            f"Label {label!r} too imbalanced: {n_pos} pos / {n_total-n_pos} neg. "
            "Need >=5 of each class."
        )

    t0 = time.perf_counter()
    cv_metrics = cv_evaluate(_tabpfn_factory, X, y, n_splits=5, n_repeats=5,
                             random_state=random_state)
    cv_elapsed = time.perf_counter() - t0
    print(f"[train:{label}] CV ({cv_metrics['n_folds']} folds) in {cv_elapsed:.1f}s: "
          f"MCC={cv_metrics['mcc_mean']:.3f}±{cv_metrics['mcc_std']:.3f}, "
          f"PR-AUC={cv_metrics['pr_auc_mean']:.3f}, Brier={cv_metrics['brier_mean']:.3f}")

    # Final model on all data
    final_clf = _tabpfn_factory()
    final_clf.fit(X, y)
    model_path = out_dir / "arm_scalar_latest.joblib"
    joblib.dump({
        "label": label,
        "arm": "scalar",
        "clf": final_clf,
        "feature_names": SCALAR_FEATURE_NAMES,
        "n_train": n_total,
        "n_positives": n_pos,
        "trained_at": int(time.time()),
    }, model_path)
    print(f"[train:{label}] persisted → {model_path}")

    metrics = {
        "label": label,
        "n_total": n_total,
        "n_positives": n_pos,
        "arm_scalar": cv_metrics,
        "trained_at": int(time.time()),
        "cv_elapsed_s": round(cv_elapsed, 1),
    }
    (out_dir / "metrics.json").write_text(json.dumps(metrics, indent=2))
    return metrics


if __name__ == "__main__":
    import sys
    label = sys.argv[1] if len(sys.argv) > 1 else "mask_blur_unusable"
    train_label(label)
