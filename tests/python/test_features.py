"""Tests for pure feature computation helpers in features.py."""
from __future__ import annotations
import numpy as np

from scripts.detect_subjects.features import compute_geometric_features


def test_geometric_features_basic_bbox():
    """Bbox in middle of frame, 30% × 40% in size."""
    out = compute_geometric_features(
        bbox_xywh_normalized=(0.35, 0.30, 0.30, 0.40),
        img_w=1000, img_h=500,
    )
    assert out["bbox_area_ratio"] == 0.12  # 0.30 * 0.40
    assert out["bbox_min_edge_px"] == 200.0  # min(0.40*500, 0.30*1000) → 200
    assert out["bbox_long_edge_px"] == 300.0  # max(...) → 300
    assert out["bbox_touches_edge"] is False
    assert 0 <= out["offcenter"] <= 1


def test_geometric_features_edge_touching():
    """Bbox flush against image left edge → touches edge."""
    out = compute_geometric_features(
        bbox_xywh_normalized=(0.0, 0.10, 0.15, 0.20),
        img_w=1000, img_h=500,
    )
    assert out["bbox_touches_edge"] is True


def test_geometric_features_within_tolerance_touches_edge():
    """Bbox within 1.4% of image edge counts as touching (current config)."""
    out = compute_geometric_features(
        bbox_xywh_normalized=(0.01, 0.10, 0.15, 0.20),
        img_w=1000, img_h=500,
    )
    # Default BBOX_EDGE_TOLERANCE_NORMALIZED is 0.014
    assert out["bbox_touches_edge"] is True


def test_geometric_features_none_bbox_returns_all_none():
    """No bbox → all features are None."""
    out = compute_geometric_features(
        bbox_xywh_normalized=None,
        img_w=1000, img_h=500,
    )
    assert out["bbox_area_ratio"] is None
    assert out["bbox_long_edge_px"] is None
    assert out["bbox_touches_edge"] is None


def test_geometric_features_long_edge_picks_max():
    """For a tall narrow bbox, long edge is the height in px."""
    out = compute_geometric_features(
        bbox_xywh_normalized=(0.40, 0.10, 0.05, 0.80),
        img_w=1000, img_h=2000,
    )
    # height in px = 0.80 * 2000 = 1600; width in px = 0.05 * 1000 = 50
    assert out["bbox_long_edge_px"] == 1600.0
    assert out["bbox_min_edge_px"] == 50.0
