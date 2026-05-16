"""Shared evaluation utilities for Phase 2+ pipeline assessment.

Pure functions, no I/O. Used by evaluate_pipeline.py (Phase 2a),
the ablation tool (Phase 2b), and the gate sweep (Phase 4).
"""
from __future__ import annotations
import random


def _f1_score(y_true: list[int], y_pred: list[int]) -> float:
    """Binary F1; returns 0.0 when both precision and recall are 0."""
    tp = sum(1 for t, p in zip(y_true, y_pred) if t == 1 and p == 1)
    fp = sum(1 for t, p in zip(y_true, y_pred) if t == 0 and p == 1)
    fn = sum(1 for t, p in zip(y_true, y_pred) if t == 1 and p == 0)
    precision = tp / (tp + fp) if (tp + fp) > 0 else 0.0
    recall = tp / (tp + fn) if (tp + fn) > 0 else 0.0
    if precision + recall == 0:
        return 0.0
    return 2 * precision * recall / (precision + recall)


def bootstrap_f1_ci(
    y_true: list[int],
    y_pred: list[int],
    B: int = 2000,
    alpha: float = 0.05,
    seed: int = 42,
) -> tuple[float, float, float]:
    """Binary F1 with bootstrap (1-alpha) confidence interval.

    Returns (f1, ci_low, ci_high).
    """
    n = len(y_true)
    f1 = _f1_score(y_true, y_pred)

    rng = random.Random(seed)
    indices = list(range(n))
    boot_f1s: list[float] = []
    for _ in range(B):
        sample_idx = [rng.choice(indices) for _ in range(n)]
        bt = [y_true[i] for i in sample_idx]
        bp = [y_pred[i] for i in sample_idx]
        boot_f1s.append(_f1_score(bt, bp))

    boot_f1s.sort()
    lo_idx = max(0, int((alpha / 2) * B))
    hi_idx = min(B - 1, int((1 - alpha / 2) * B) - 1)
    return f1, boot_f1s[lo_idx], boot_f1s[hi_idx]


def pr_curve_per_label(
    y_true: list[int],
    y_score: list[float],
    thresholds: list[float],
) -> list[dict]:
    """Compute precision/recall/F1 at each threshold.

    Returns a list of {threshold, precision, recall, f1} dicts, one per threshold.
    """
    results = []
    for t in thresholds:
        y_pred = [1 if s >= t else 0 for s in y_score]
        tp = sum(1 for yt, yp in zip(y_true, y_pred) if yt == 1 and yp == 1)
        fp = sum(1 for yt, yp in zip(y_true, y_pred) if yt == 0 and yp == 1)
        fn = sum(1 for yt, yp in zip(y_true, y_pred) if yt == 1 and yp == 0)
        precision = tp / (tp + fp) if (tp + fp) > 0 else 0.0
        recall = tp / (tp + fn) if (tp + fn) > 0 else 0.0
        if precision + recall > 0:
            f1 = 2 * precision * recall / (precision + recall)
        else:
            f1 = 0.0
        results.append({
            "threshold": t,
            "precision": precision,
            "recall": recall,
            "f1": f1,
        })
    return results
