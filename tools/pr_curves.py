"""Generate docs/ml_labeler/pr_curves.md: per-label precision/recall trade-offs.

For each tier-1 label:
  - Load (X, y) the same way train.py does
  - Run StratifiedKFold(5) once to get out-of-fold predicted probabilities
  - At each precision target (0.5, 0.6, 0.7, 0.8, 0.9), find the threshold
    that achieves >=target precision with maximum recall

Why oof preds, not train-set preds: training-set accuracy is meaningless
on a class-imbalanced HGB — it'll overfit and report P=1.0 R=1.0 trivially.
OOF gives an unbiased estimate of what a held-out user will actually see.
"""
from __future__ import annotations
from datetime import datetime
from pathlib import Path

import numpy as np
from sklearn.model_selection import StratifiedKFold, cross_val_predict

from scripts.detect_subjects.ml_labeler import TIER1_LABELS
from scripts.detect_subjects.ml_labeler.train import (
    _load_xy_for_label, _scalar_clf_factory,
)

OUT_PATH = Path("docs/ml_labeler/pr_curves.md")
TARGETS = [0.30, 0.50, 0.60, 0.70, 0.80, 0.90]


def _pr_at_target(probs: np.ndarray, y: np.ndarray, target: float) -> dict:
    """Highest-recall threshold that achieves precision >= target.
    Returns dict with achieved precision, recall, threshold, TP/FP/FN."""
    order = np.argsort(probs)[::-1]
    y_sorted = y[order]
    p_sorted = probs[order]
    n_pos = int(y.sum())
    best = {"precision": 1.0, "recall": 0.0, "threshold": 1.0,
            "tp": 0, "fp": 0, "fn": n_pos}
    tp = 0
    for i, (yi, pi) in enumerate(zip(y_sorted, p_sorted)):
        if yi == 1:
            tp += 1
        fp = (i + 1) - tp
        precision = tp / (i + 1)
        recall = tp / n_pos if n_pos else 0.0
        if precision >= target and recall > best["recall"]:
            best = {"precision": precision, "recall": recall,
                    "threshold": float(pi), "tp": tp, "fp": fp,
                    "fn": n_pos - tp}
    return best


def main() -> None:
    parquet = Path("data/cache/framing_detections.parquet")
    labels_path = Path("data/cache/labels.json")
    lines: list[str] = [
        f"# PR curves per tier-1 label (auto-generated {datetime.now():%Y-%m-%d %H:%M})",
        "",
        "Each row shows the highest-recall threshold that achieves the target precision.",
        "OOF predictions via StratifiedKFold(5) — unbiased estimate of held-out behavior.",
        "",
    ]
    for label in TIER1_LABELS:
        X, y, _ids = _load_xy_for_label(parquet, labels_path, label)
        n_pos = int(y.sum())
        n_neg = len(y) - n_pos
        if n_pos < 5 or n_neg < 5:
            lines += [f"\n## `{label}` — n={len(y)}, positives={n_pos}",
                      "", f"Skipped: too imbalanced.", ""]
            continue

        cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)
        probs = cross_val_predict(
            _scalar_clf_factory(), X, y, cv=cv, method="predict_proba", n_jobs=-1,
        )[:, 1]

        lines += [f"\n## `{label}` — n={len(y)}, positives={n_pos}",
                  "",
                  "| target precision | achieved | recall | threshold | TP | FP | FN |",
                  "|---:|---:|---:|---:|---:|---:|---:|"]
        for target in TARGETS:
            r = _pr_at_target(probs, y, target)
            lines.append(
                f"| {target:.2f} | {r['precision']:.2f} | {r['recall']:.2f} | "
                f"{r['threshold']:.3f} | {r['tp']} | {r['fp']} | {r['fn']} |"
            )

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text("\n".join(lines) + "\n")
    print(f"wrote {OUT_PATH}")


if __name__ == "__main__":
    main()
