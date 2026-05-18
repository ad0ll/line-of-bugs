"""5x5 stratified k-fold CV with MCC, PR-AUC, and Brier metrics per spec §6.

Why MCC over F1: Chicco & Jurman 2020 — F1 over-rewards trivial classifiers on
imbalanced data. MCC penalizes both classes symmetrically.
Why PR-AUC: ranking quality matters for the active-learning uncertainty sort.
Why Brier: calibration sanity for gate.py probability thresholds.
"""
from __future__ import annotations
from typing import Callable
import numpy as np
from sklearn.metrics import matthews_corrcoef, average_precision_score, brier_score_loss
from sklearn.model_selection import RepeatedStratifiedKFold


def cv_evaluate(
    clf_factory: Callable, X: np.ndarray, y: np.ndarray,
    n_splits: int = 5, n_repeats: int = 5, random_state: int = 42,
) -> dict:
    """5x5 stratified CV. Returns metric means/stds AND concatenated held-out
    probabilities + labels (consumed by train._recall_threshold)."""
    rskf = RepeatedStratifiedKFold(
        n_splits=n_splits, n_repeats=n_repeats, random_state=random_state,
    )
    mccs, prs, briers = [], [], []
    p_holdout: list[float] = []
    y_holdout: list[int] = []
    for train_idx, test_idx in rskf.split(X, y):
        X_tr, X_te = X[train_idx], X[test_idx]
        y_tr, y_te = y[train_idx], y[test_idx]
        clf = clf_factory()
        clf.fit(X_tr, y_tr)
        prob_pos = clf.predict_proba(X_te)[:, 1]
        pred = (prob_pos >= 0.5).astype(np.int8)
        mccs.append(matthews_corrcoef(y_te, pred))
        # PR-AUC only meaningful when both classes present in test fold
        if len(np.unique(y_te)) == 2:
            prs.append(average_precision_score(y_te, prob_pos))
        briers.append(brier_score_loss(y_te, prob_pos))
        p_holdout.extend(prob_pos.tolist())
        y_holdout.extend(y_te.tolist())
    return {
        "mcc_mean": float(np.mean(mccs)),
        "mcc_std": float(np.std(mccs)),
        "pr_auc_mean": float(np.mean(prs)) if prs else float("nan"),
        "brier_mean": float(np.mean(briers)),
        "n_folds": n_splits * n_repeats,
        "p_holdout": p_holdout,
        "y_holdout": y_holdout,
    }
