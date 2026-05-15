"""Tests for iNat-2017 ground truth bbox lookup."""
from __future__ import annotations
import json

from scripts.detect_subjects.ground_truth import (
    GroundTruthIndex,
    lookup_gt_bbox,
)


def test_gt_index_returns_none_when_missing():
    idx = GroundTruthIndex(annotations_by_source_id={})
    assert idx.lookup("inat-12345") is None


def test_gt_index_returns_bbox_when_present():
    idx = GroundTruthIndex(annotations_by_source_id={
        "12345": (0.25, 0.30, 0.20, 0.25),
    })
    assert idx.lookup("inat-12345") == (0.25, 0.30, 0.20, 0.25)


def test_gt_index_ignores_non_inat_sources():
    idx = GroundTruthIndex(annotations_by_source_id={
        "12345": (0.1, 0.1, 0.1, 0.1),
    })
    assert idx.lookup("bw-12345") is None


def test_gt_index_from_json_file(tmp_path):
    data = {
        "images": [{"id": 12345, "width": 4000, "height": 3000}],
        "annotations": [{"image_id": 12345, "bbox": [1000, 750, 800, 600]}],
    }
    p = tmp_path / "inat2017.json"
    p.write_text(json.dumps(data))
    idx = GroundTruthIndex.from_inat2017_json(p)
    bbox = idx.lookup("inat-12345")
    assert bbox is not None
    x, y, w, h = bbox
    assert abs(x - 0.25) < 1e-5
    assert abs(y - 0.25) < 1e-5
    assert abs(w - 0.20) < 1e-5
    assert abs(h - 0.20) < 1e-5


def test_lookup_gt_bbox_with_no_index_returns_none():
    assert lookup_gt_bbox(None, "inat-12345") is None
