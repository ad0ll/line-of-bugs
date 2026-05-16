"""Tests for evaluation_utils.py — bootstrap F1 CI and PR curve utilities."""
from __future__ import annotations


def test_bootstrap_f1_ci_import():
    from scripts.detect_subjects.evaluation_utils import bootstrap_f1_ci
    assert callable(bootstrap_f1_ci)


def test_pr_curve_per_label_import():
    from scripts.detect_subjects.evaluation_utils import pr_curve_per_label
    assert callable(pr_curve_per_label)


def test_bootstrap_f1_ci_perfect_classifier():
    """Perfect predictions give F1=1.0, tight CI."""
    from scripts.detect_subjects.evaluation_utils import bootstrap_f1_ci
    y_true = [1, 1, 0, 0, 1, 0, 1, 0]
    y_pred = [1, 1, 0, 0, 1, 0, 1, 0]
    f1, ci_low, ci_high = bootstrap_f1_ci(y_true, y_pred, B=500, alpha=0.05)
    assert abs(f1 - 1.0) < 1e-6
    assert abs(ci_low - 1.0) < 0.01
    assert abs(ci_high - 1.0) < 0.01


def test_bootstrap_f1_ci_returns_tuple_of_three():
    from scripts.detect_subjects.evaluation_utils import bootstrap_f1_ci
    y_true = [1, 0, 1, 0, 1, 1, 0, 0]
    y_pred = [1, 0, 0, 1, 1, 1, 1, 0]
    result = bootstrap_f1_ci(y_true, y_pred, B=200, alpha=0.05)
    assert len(result) == 3
    f1, ci_low, ci_high = result
    assert 0.0 <= ci_low <= f1 <= ci_high <= 1.0


def test_bootstrap_f1_ci_all_zeros_returns_zero():
    """All-negative predictions give F1=0.0."""
    from scripts.detect_subjects.evaluation_utils import bootstrap_f1_ci
    y_true = [1, 1, 0, 0]
    y_pred = [0, 0, 0, 0]
    f1, _, _ = bootstrap_f1_ci(y_true, y_pred, B=200, alpha=0.05)
    assert f1 == 0.0


def test_pr_curve_per_label_returns_list_of_dicts():
    from scripts.detect_subjects.evaluation_utils import pr_curve_per_label
    y_true = [1, 1, 0, 0, 1, 0]
    y_score = [0.9, 0.8, 0.4, 0.3, 0.7, 0.6]
    thresholds = [0.3, 0.5, 0.7, 0.9]
    result = pr_curve_per_label(y_true, y_score, thresholds)
    assert isinstance(result, list)
    assert len(result) == len(thresholds)
    for entry in result:
        assert set(entry.keys()) == {"threshold", "precision", "recall", "f1"}
        assert 0.0 <= entry["precision"] <= 1.0
        assert 0.0 <= entry["recall"] <= 1.0
        assert 0.0 <= entry["f1"] <= 1.0


def test_pr_curve_per_label_monotone_threshold():
    """Higher threshold → fewer positives predicted → recall drops."""
    from scripts.detect_subjects.evaluation_utils import pr_curve_per_label
    y_true = [1, 1, 0, 0, 1, 0, 1, 0]
    y_score = [0.95, 0.85, 0.75, 0.65, 0.55, 0.45, 0.35, 0.25]
    thresholds = [0.2, 0.5, 0.8, 0.95]
    result = pr_curve_per_label(y_true, y_score, thresholds)
    recall_low_t = next(r["recall"] for r in result if r["threshold"] == 0.2)
    recall_high_t = next(r["recall"] for r in result if r["threshold"] == 0.95)
    assert recall_low_t >= recall_high_t
