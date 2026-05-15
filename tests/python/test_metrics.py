"""Tests for geometric and mask-based metrics."""
from __future__ import annotations
import math

from scripts.detect_subjects.metrics import (
    bbox_area_ratio_normalized,
    offcenter_normalized,
    iou_xywh_normalized,
)


def test_bbox_area_ratio_quarter():
    assert bbox_area_ratio_normalized(0.25, 0.25) == 0.0625


def test_bbox_area_ratio_full():
    assert bbox_area_ratio_normalized(1.0, 1.0) == 1.0


def test_offcenter_dead_center():
    assert offcenter_normalized(0.25, 0.25, 0.5, 0.5) == 0.0


def test_offcenter_corner():
    result = offcenter_normalized(0.0, 0.0, 0.1, 0.1)
    assert 0.85 < result < 0.95


def test_iou_identical_boxes():
    assert iou_xywh_normalized((0.1, 0.1, 0.2, 0.2), (0.1, 0.1, 0.2, 0.2)) == 1.0


def test_iou_no_overlap():
    assert iou_xywh_normalized((0.0, 0.0, 0.1, 0.1), (0.5, 0.5, 0.1, 0.1)) == 0.0


def test_iou_half_overlap():
    iou = iou_xywh_normalized((0.0, 0.0, 0.2, 0.2), (0.1, 0.0, 0.2, 0.2))
    assert math.isclose(iou, 1/3, rel_tol=1e-5)


# ─── Mask-based metrics (Task 10) ─────────────────────────────────

import numpy as np

from scripts.detect_subjects.metrics import (
    lab_delta_e_mask_vs_background,
    boundary_sharpness,
)


def test_lab_delta_e_high_for_red_on_white(sample_image_rgb, sample_mask_binary):
    rgb = np.array(sample_image_rgb)
    delta_e = lab_delta_e_mask_vs_background(rgb, sample_mask_binary)
    assert delta_e > 30.0


def test_lab_delta_e_low_for_camouflage():
    rgb = np.full((100, 100, 3), 128, dtype=np.uint8)
    mask = np.zeros((100, 100), dtype=bool)
    mask[30:70, 30:70] = True
    delta_e = lab_delta_e_mask_vs_background(rgb, mask)
    assert delta_e < 5.0


def test_lab_delta_e_returns_zero_when_no_mask():
    rgb = np.full((100, 100, 3), 128, dtype=np.uint8)
    mask = np.zeros((100, 100), dtype=bool)
    delta_e = lab_delta_e_mask_vs_background(rgb, mask)
    assert delta_e == 0.0


def test_boundary_sharpness_high_for_hard_edge():
    rgb = np.full((100, 100, 3), 255, dtype=np.uint8)
    rgb[30:70, 30:70] = (220, 30, 30)
    mask = np.zeros((100, 100), dtype=bool)
    mask[30:70, 30:70] = True
    s = boundary_sharpness(rgb, mask)
    assert s > 10.0


def test_boundary_sharpness_low_for_blurred_edge():
    rgb = np.zeros((100, 100, 3), dtype=np.uint8)
    for i in range(100):
        rgb[i, :, :] = i * 2
    mask = np.zeros((100, 100), dtype=bool)
    mask[40:60, 40:60] = True
    s = boundary_sharpness(rgb, mask)
    assert s < 30.0
