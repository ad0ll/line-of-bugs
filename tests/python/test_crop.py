"""Tests for CropPlanner — computing the proposed crop bbox + previews."""
from __future__ import annotations
import math
from pathlib import Path

import pytest
from PIL import Image

from scripts.detect_subjects.crop import (
    compute_crop_bbox,
    apply_crop_and_save,
    CropDecision,
)


def test_skip_crop_when_bbox_already_large():
    # bbox area = 0.30 × 0.40 = 0.12 → below 0.25, NOT skipped
    # but 0.20 × 0.60 = 0.12, same area, would also not skip
    # 0.55 × 0.50 = 0.275 → above 0.25 area threshold, IS skipped
    d = compute_crop_bbox(
        bbox_x=0.20, bbox_y=0.25, bbox_w=0.55, bbox_h=0.50,
        subject_state="wild",
    )
    assert d.skip is True
    assert d.skip_reason == "already_well_framed"


def test_skip_crop_when_bbox_tiny():
    d = compute_crop_bbox(
        bbox_x=0.50, bbox_y=0.50, bbox_w=0.05, bbox_h=0.05,
        subject_state="wild",
    )
    assert d.skip is True
    assert d.skip_reason == "subject_too_small"


def test_crop_nature_targets_30pct_subject_area():
    d = compute_crop_bbox(
        bbox_x=0.30, bbox_y=0.30, bbox_w=0.20, bbox_h=0.50,
        subject_state="wild",
    )
    assert d.skip is False
    bbox_area = 0.20 * 0.50
    crop_area = d.crop_w * d.crop_h
    assert math.isclose(bbox_area / crop_area, 0.30, rel_tol=0.05)


def test_crop_specimen_targets_60pct_subject_area():
    d = compute_crop_bbox(
        bbox_x=0.30, bbox_y=0.30, bbox_w=0.20, bbox_h=0.20,
        subject_state="specimen",
    )
    assert d.skip is False
    bbox_area = 0.20 * 0.20
    crop_area = d.crop_w * d.crop_h
    assert math.isclose(bbox_area / crop_area, 0.60, rel_tol=0.05)


def test_crop_clamps_to_image_bounds():
    d = compute_crop_bbox(
        bbox_x=0.02, bbox_y=0.02, bbox_w=0.10, bbox_h=0.10,
        subject_state="wild",
    )
    assert d.crop_x >= 0.0
    assert d.crop_y >= 0.0
    assert d.crop_x + d.crop_w <= 1.0
    assert d.crop_y + d.crop_h <= 1.0


def test_apply_crop_writes_jpeg(sample_image_rgb, tmp_path):
    out_path = tmp_path / "crop.jpg"
    apply_crop_and_save(
        image=sample_image_rgb,
        crop_xywh_normalized=(0.25, 0.25, 0.5, 0.5),
        out_path=out_path,
        max_edge=200,
        quality=80,
    )
    assert out_path.exists()
    cropped = Image.open(out_path)
    assert max(cropped.size) <= 200
