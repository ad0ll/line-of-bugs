"""Compute per-label operating thresholds at a precision target.

Writes the chosen probability threshold + observed (precision, recall, TP/FP/FN)
into each label's metrics.json. Downstream consumers (UI marker, future gate
integration) can read `metrics['operating']` to know "above this p, treat as
positive".

Policy decisions baked in:
  blur_unusable      → P=0.50 (well-trained, accept more recall)
  blur_usable        → P=0.60 (weak, want fewer false positives)
  bad-photo-quality  → P=0.60
  poor-contrast      → P=0.60

OOF predictions via StratifiedKFold(5) — same methodology as pr_curves.py.
"""
from __future__ import annotations
import json
import time
from pathlib import Path

import numpy as np
from sklearn.model_selection import StratifiedKFold, cross_val_predict

from scripts.detect_subjects.ml_labeler import TIER1_LABELS
from scripts.detect_subjects.ml_labeler.train import (
    _load_xy_for_label, _scalar_clf_factory,
)

# Per-label precision target. blur_unusable is well-trained — accepting more
# recall at lower precision is fine. The other three are weaker — bias toward
# higher precision so a "predicted positive" call is meaningful.
PRECISION_TARGET = {
    "mask_blur_unusable": 0.50,
    "mask_blur_usable": 0.60,
    "mask_bad-photo-quality": 0.60,
    "mask_poor-contrast": 0.60,
}


def _best_threshold_at_precision(
    probs: np.ndarray, y: np.ndarray, target: float,
) -> dict:
    """Highest-recall threshold that achieves precision >= target. Returns
    dict with p_threshold, achieved precision, recall, tp, fp, fn."""
    order = np.argsort(probs)[::-1]
    y_sorted = y[order]
    p_sorted = probs[order]
    n_pos = int(y.sum())
    best = {
        "p_threshold": 1.0, "precision": 1.0, "recall": 0.0,
        "tp": 0, "fp": 0, "fn": n_pos,
    }
    tp = 0
    for i, (yi, pi) in enumerate(zip(y_sorted, p_sorted)):
        if yi == 1:
            tp += 1
        fp = (i + 1) - tp
        precision = tp / (i + 1)
        recall = tp / n_pos if n_pos else 0.0
        if precision >= target and recall > best["recall"]:
            best = {
                "p_threshold": float(pi), "precision": float(precision),
                "recall": float(recall), "tp": tp, "fp": fp, "fn": n_pos - tp,
            }
    return best


def main() -> None:
    parquet = Path("data/cache/framing_detections.parquet")
    labels_path = Path("data/cache/labels.json")

    from scripts.detect_subjects.ml_labeler import MODELS_DIR

    for label in TIER1_LABELS:
        target = PRECISION_TARGET[label]
        X, y, _ids = _load_xy_for_label(parquet, labels_path, label)
        n_pos = int(y.sum())
        if n_pos < 5 or len(y) - n_pos < 5:
            print(f"[{label}] skipped — only {n_pos} positives")
            continue

        cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)
        probs = cross_val_predict(
            _scalar_clf_factory(), X, y, cv=cv, method="predict_proba", n_jobs=-1,
        )[:, 1]
        op = _best_threshold_at_precision(probs, y, target)

        metrics_path = MODELS_DIR / label / "metrics.json"
        if not metrics_path.exists():
            print(f"[{label}] no metrics.json — run train first")
            continue
        metrics = json.loads(metrics_path.read_text())
        metrics["operating"] = {
            "target_precision": target,
            "policy_note": (
                "blur_unusable accepts more recall at P=0.50 (well-trained); "
                "the weaker labels operate at P=0.60 so a 'predicted positive' "
                "call is meaningful enough to act on"
            ),
            **op,
            "computed_at": int(time.time()),
        }
        metrics_path.write_text(json.dumps(metrics, indent=2))
        print(f"[{label}] target P={target:.2f} → p>={op['p_threshold']:.3f}: "
              f"achieved P={op['precision']:.2f} R={op['recall']:.2f} "
              f"(TP={op['tp']} FP={op['fp']} FN={op['fn']})")


if __name__ == "__main__":
    main()
