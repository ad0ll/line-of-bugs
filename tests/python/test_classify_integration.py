"""Integration test for classify.run_v1_on_sample using stub detector/segmenter.

Synthetic single-row input → no GPU, no model weights, no real images required.
Verifies the pipeline produces a valid parquet row with all Phase 2 schema
columns populated correctly.
"""
from __future__ import annotations
from unittest.mock import patch

import pyarrow.parquet as pq
from PIL import Image


STUB_IMAGE_ID = "stub-integration-0001"
STUB_SOURCE = "inaturalist"


def test_run_v1_with_stubs_produces_valid_parquet_row(tmp_path):
    """run_v1_on_sample with _stub detector/segmenter writes one parquet row
    with correct Phase 2 schema shape."""
    images_dir = tmp_path / "images"
    images_dir.mkdir()
    img = Image.new("RGB", (320, 240), color=(100, 150, 80))
    img.save(str(images_dir / f"{STUB_IMAGE_ID}.jpg"), "JPEG")

    parquet_path = tmp_path / "test_output.parquet"

    sample_rows = [{
        "image_id": STUB_IMAGE_ID,
        "source": STUB_SOURCE,
        "subject_state": "wild",
        "filename": f"images/{STUB_IMAGE_ID}.jpg",
    }]

    with patch("scripts.detect_subjects.classify.DATA_DIR", tmp_path), \
         patch("scripts.detect_subjects.classify.cfg.DETECTOR_VARIANT", "_stub"), \
         patch("scripts.detect_subjects.classify.cfg.SEGMENTER_VARIANT", "_stub"), \
         patch("scripts.detect_subjects.classify.CROPS_DIR", tmp_path / "crops"):

        from scripts.detect_subjects.classify import run_v1_on_sample
        summary = run_v1_on_sample(
            sample_rows=sample_rows,
            parquet_path=parquet_path,
            device="cpu",
        )

    assert summary["processed"] == 1, f"expected 1 processed, got {summary}"
    assert summary["errors"] == 0, f"unexpected errors: {summary}"
    assert parquet_path.exists(), "parquet not written"

    table = pq.read_table(parquet_path)
    assert table.num_rows == 1

    col_names = set(table.schema.names)
    for col in ("text_label", "text_label_score", "gate_decision", "distinct_subjects"):
        assert col in col_names, f"missing Phase 2 column: {col}"

    row = table.to_pydict()
    assert row["text_label"][0] == "a beetle", f"unexpected text_label: {row['text_label'][0]}"
    assert isinstance(row["text_label_score"][0], float)
    # gate_decision wired in Phase 2a — must now be a "keep" or "reject" string
    assert row["gate_decision"][0] in ("keep", "reject")
    ds = row["distinct_subjects"][0]
    assert len(ds) == 1
    assert ds[0]["phrase"] == "a beetle"
    assert "__" in row["variant"][0], f"variant missing __ separator: {row['variant'][0]}"
    assert row["bbox_x"][0] is not None
    assert row["confidence"][0] is not None
