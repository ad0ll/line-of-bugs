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
