"""Tests for pure feature computation helpers in features.py."""
from __future__ import annotations

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


def test_mask_features_with_simple_mask():
    """Solid-color background + a single high-contrast mask region."""
    import numpy as np
    H, W = 200, 200
    rgb = np.full((H, W, 3), 200, dtype=np.uint8)  # background = grey
    # Put a dark square in the middle as "the bug"
    rgb[80:120, 80:120] = (30, 30, 30)
    mask = np.zeros((H, W), dtype=bool)
    mask[80:120, 80:120] = True

    from scripts.detect_subjects.features import compute_mask_features
    out = compute_mask_features(mask, rgb)
    assert out["mask_area_ratio"] == 1600 / (200 * 200)  # 40*40/40000 = 0.04
    assert out["lab_delta_e"] > 50  # huge contrast (grey 200 vs dark 30)
    assert out["boundary_sharpness"] > 0  # crisp edge


def test_mask_features_none_mask_returns_none_values():
    """No mask → all fields None."""
    from scripts.detect_subjects.features import compute_mask_features
    out = compute_mask_features(None, rgb=None)
    assert out["mask_area_ratio"] is None
    assert out["lab_delta_e"] is None
    assert out["boundary_sharpness"] is None


def test_mask_features_empty_mask_returns_zero_area():
    """Mask of all False → area is 0; ΔE/sharpness undefined (None) because nothing inside."""
    import numpy as np
    mask = np.zeros((50, 50), dtype=bool)
    rgb = np.zeros((50, 50, 3), dtype=np.uint8)
    from scripts.detect_subjects.features import compute_mask_features
    out = compute_mask_features(mask, rgb)
    assert out["mask_area_ratio"] == 0.0
    assert out["lab_delta_e"] is None
    assert out["boundary_sharpness"] is None


def test_subject_sharpness_returns_float():
    """Sharp synthetic image inside bbox → positive Laplacian variance."""
    import numpy as np
    rgb = np.zeros((200, 200, 3), dtype=np.uint8)
    # Add a high-frequency checkerboard inside the bbox region
    for y in range(50, 150):
        for x in range(50, 150):
            if (x + y) % 2 == 0:
                rgb[y, x] = (255, 255, 255)
    from scripts.detect_subjects.features import compute_subject_sharpness
    val = compute_subject_sharpness(
        rgb, bbox_xywh_normalized=(0.25, 0.25, 0.50, 0.50),
        img_w=200, img_h=200,
    )
    assert val is not None
    assert val > 100  # checkerboard has very high Laplacian variance


def test_subject_sharpness_none_bbox_returns_none():
    from scripts.detect_subjects.features import compute_subject_sharpness
    val = compute_subject_sharpness(rgb=None, bbox_xywh_normalized=None,
                                     img_w=100, img_h=100)
    assert val is None


def test_subject_sharpness_tiny_bbox_returns_none():
    """Bbox smaller than 5px doesn't have enough data for Laplacian → None."""
    import numpy as np
    rgb = np.zeros((100, 100, 3), dtype=np.uint8)
    from scripts.detect_subjects.features import compute_subject_sharpness
    val = compute_subject_sharpness(
        rgb, bbox_xywh_normalized=(0.49, 0.49, 0.02, 0.02),
        img_w=100, img_h=100,
    )
    assert val is None
