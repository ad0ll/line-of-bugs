"""Integration test: gate.py wired into classify.py orchestrator.

Uses _stub detector/segmenter (registered in pre-work T11) so no GPU needed.
Verifies gate_decision column is populated correctly.
"""
from __future__ import annotations
from unittest.mock import patch

import pyarrow.parquet as pq
from PIL import Image

from scripts.detect_subjects.gate import GateDecision


def _run_with_stub(tmp_path, image_id):
    """Run the pipeline against one synthetic image using _stub variants."""
    images_dir = tmp_path / "images"
    images_dir.mkdir()
    Image.new("RGB", (320, 240), color=(100, 150, 80)).save(
        str(images_dir / f"{image_id}.jpg"), "JPEG",
    )
    parquet_path = tmp_path / "test.parquet"
    sample_rows = [{
        "image_id": image_id,
        "source": "inaturalist",
        "subject_state": "wild",
        "filename": f"images/{image_id}.jpg",
    }]
    with patch("scripts.detect_subjects.classify.DATA_DIR", tmp_path), \
         patch("scripts.detect_subjects.classify.cfg.DETECTOR_VARIANT", "_stub"), \
         patch("scripts.detect_subjects.classify.cfg.SEGMENTER_VARIANT", "_stub"), \
         patch("scripts.detect_subjects.classify.CROPS_DIR", tmp_path / "crops"):
        from scripts.detect_subjects.classify import run_v1_on_sample
        run_v1_on_sample(sample_rows, parquet_path=parquet_path, device="cpu")
    return pq.read_table(parquet_path).to_pydict()


def test_gate_decision_column_populated(tmp_path):
    """gate_decision must be either KEEP or REJECT (not None) when pipeline runs."""
    row = _run_with_stub(tmp_path, "test-gate-001")
    assert "gate_decision" in row
    assert row["gate_decision"][0] in (GateDecision.KEEP.value, GateDecision.REJECT.value)
