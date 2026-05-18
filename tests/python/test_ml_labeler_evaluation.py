"""Verify 5x5 stratified CV produces MCC + PR-AUC + Brier metrics."""
import numpy as np

def test_cv_reports_three_metrics():
    from scripts.detect_subjects.ml_labeler.evaluation import cv_evaluate
    from sklearn.linear_model import LogisticRegression
    rng = np.random.default_rng(42)
    # 200 examples, 5 features, balanced binary target
    X = rng.standard_normal((200, 5)).astype(np.float32)
    y = (X[:, 0] > 0).astype(np.int8)
    result = cv_evaluate(
        clf_factory=lambda: LogisticRegression(max_iter=1000),
        X=X, y=y, n_splits=5, n_repeats=2, random_state=42,
    )
    assert set(result.keys()) == {"mcc_mean", "mcc_std", "pr_auc_mean", "brier_mean", "n_folds"}
    assert result["mcc_mean"] > 0.5  # easy linearly-separable task
    assert result["n_folds"] == 10
