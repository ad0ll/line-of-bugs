"""Tests for the bbox overlay renderer used by Claude's visual smoke test."""
from __future__ import annotations
import json
from pathlib import Path

import polars as pl
import pytest
from PIL import Image

from tools.render_bbox_overlays import (
    NEGATIVE_CLASS_KEYWORDS,
    build_overlay_jpeg,
    sample_rows,
)


def _pink_pixel_present(im: Image.Image) -> bool:
    """Pink primary bbox color is (255, 110, 199); search for it."""
    pixels = im.load()
    for x in range(im.width):
        for y in range(im.height):
            if pixels[x, y] == (255, 110, 199):
                return True
    return False


def _red_pixel_present(im: Image.Image) -> bool:
    """Red NEGATIVE-class border color is (255, 70, 70); search for it."""
    pixels = im.load()
    for x in range(im.width):
        for y in range(im.height):
            if pixels[x, y] == (255, 70, 70):
                return True
    return False


def test_renders_primary_bbox_in_pink():
    src = Image.new("RGB", (200, 200), color=(128, 128, 128))
    out = build_overlay_jpeg(
        src,
        bbox_xywh_normalized=(0.2, 0.3, 0.4, 0.3),
        distinct_subjects=[],
        text_label="butterfly",
        text_label_score=0.85,
    )
    assert _pink_pixel_present(out)
    assert not _red_pixel_present(out)


def test_negative_class_renders_red_border():
    src = Image.new("RGB", (200, 200), color=(128, 128, 128))
    out = build_overlay_jpeg(
        src,
        bbox_xywh_normalized=(0.2, 0.3, 0.4, 0.3),
        distinct_subjects=[],
        text_label="flower",
        text_label_score=0.42,
    )
    assert _red_pixel_present(out)


def test_negative_class_keywords_match_substring():
    """NEGATIVE class match strips leading 'a ' from prompt phrase."""
    assert "flower" in NEGATIVE_CLASS_KEYWORDS
    assert "leaf" in NEGATIVE_CLASS_KEYWORDS
    assert "stem" in NEGATIVE_CLASS_KEYWORDS
    assert "rock" in NEGATIVE_CLASS_KEYWORDS


def test_sample_rows_seed_deterministic():
    df = pl.DataFrame({"image_id": [f"img-{i}" for i in range(100)],
                       "variant": ["sam3__sam3"] * 100,
                       "bbox_x": [0.1] * 100, "bbox_y": [0.1] * 100,
                       "bbox_w": [0.5] * 100, "bbox_h": [0.5] * 100})
    a = sample_rows(df, n=10, seed=42)
    b = sample_rows(df, n=10, seed=42)
    assert a["image_id"].to_list() == b["image_id"].to_list()


def test_sample_rows_n_larger_than_df_returns_all():
    df = pl.DataFrame({"image_id": ["img-1", "img-2"],
                       "variant": ["sam3__sam3"] * 2,
                       "bbox_x": [0.1] * 2, "bbox_y": [0.1] * 2,
                       "bbox_w": [0.5] * 2, "bbox_h": [0.5] * 2})
    out = sample_rows(df, n=10, seed=42)
    assert out.height == 2


def test_outputs_index_json_with_metadata(tmp_path, monkeypatch):
    """End-to-end: index.json should be written with one entry per rendered image."""
    src_image = Image.new("RGB", (200, 200), color=(50, 50, 50))
    src_dir = tmp_path / "images"
    src_dir.mkdir()
    src_image.save(src_dir / "fake.jpg", "JPEG")

    df = pl.DataFrame({
        "image_id": ["img-1"],
        "variant": ["sam3__sam3"],
        "bbox_x": [0.2], "bbox_y": [0.3], "bbox_w": [0.4], "bbox_h": [0.3],
        "text_label": ["butterfly"], "text_label_score": [0.85],
    })

    from tools.render_bbox_overlays import render_and_index
    out_dir = tmp_path / "out"
    render_and_index(
        df, n=1, seed=42, out_dir=out_dir,
        resolve_image_path=lambda iid: src_dir / "fake.jpg",
    )

    idx = json.loads((out_dir / "index.json").read_text())
    assert len(idx) == 1
    assert idx[0]["image_id"] == "img-1"
    assert (out_dir / idx[0]["overlay_jpeg"]).exists()
