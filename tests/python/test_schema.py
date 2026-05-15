"""Tests for the parquet schema + DetectionRow dataclass."""
from __future__ import annotations
import io
import pyarrow as pa
import pyarrow.parquet as pq

from scripts.detect_subjects.schema import (
    DetectionRow,
    SCHEMA,
    row_to_pyarrow_record,
)


def test_schema_has_required_columns():
    expected = {
        "image_id", "source", "variant",
        "img_w", "img_h", "subject_state",
        "n_raw_detections", "n_distinct_detections",
        "bbox_x", "bbox_y", "bbox_w", "bbox_h", "confidence",
        "bbox_area_ratio", "offcenter",
        "mask_area_ratio", "mask_iou_score", "lab_delta_e", "boundary_sharpness",
        "crop_x", "crop_y", "crop_w", "crop_h", "post_crop_subject_area",
        "framing_quality",
        "gt_bbox_x", "gt_bbox_y", "gt_bbox_w", "gt_bbox_h", "gt_iou",
        "detection_ms", "segmentation_ms",
        "detector_model", "segmenter_model",
        "processed_at", "schema_version",
    }
    actual = set(SCHEMA.names)
    assert expected == actual, f"missing: {expected - actual}; extra: {actual - expected}"


def test_detection_row_to_pyarrow_record_minimal():
    row = DetectionRow(
        image_id="inat-1", source="inaturalist",
        variant="v1_dino_insectsam",
        img_w=4000, img_h=3000, subject_state="wild",
        n_raw_detections=2, n_distinct_detections=1,
        bbox_x=0.25, bbox_y=0.30, bbox_w=0.15, bbox_h=0.20,
        confidence=0.87,
        bbox_area_ratio=0.030, offcenter=0.18,
        mask_area_ratio=0.025, mask_iou_score=0.92,
        lab_delta_e=22.5, boundary_sharpness=18.4,
        crop_x=0.10, crop_y=0.15, crop_w=0.45, crop_h=0.50,
        post_crop_subject_area=0.30,
        framing_quality="wide",
        gt_bbox_x=None, gt_bbox_y=None, gt_bbox_w=None, gt_bbox_h=None, gt_iou=None,
        detection_ms=120, segmentation_ms=85,
        detector_model="IDEA-Research/grounding-dino-base",
        segmenter_model="martintomov/InsectSAM",
        processed_at=1747278900_000,
        schema_version=1,
    )
    record = row_to_pyarrow_record(row)
    assert record["image_id"] == "inat-1"
    assert record["gt_iou"] is None


def test_schema_round_trip_in_memory():
    rows = [
        DetectionRow(
            image_id=f"test-{i}", source="inaturalist",
            variant="v1_dino_insectsam",
            img_w=4000, img_h=3000, subject_state="wild",
            n_raw_detections=1, n_distinct_detections=1,
            bbox_x=0.25, bbox_y=0.30, bbox_w=0.15, bbox_h=0.20,
            confidence=0.87,
            bbox_area_ratio=0.030, offcenter=0.18,
            mask_area_ratio=None, mask_iou_score=None,
            lab_delta_e=None, boundary_sharpness=None,
            crop_x=0.10, crop_y=0.15, crop_w=0.45, crop_h=0.50,
            post_crop_subject_area=0.30,
            framing_quality="wide",
            gt_bbox_x=None, gt_bbox_y=None, gt_bbox_w=None, gt_bbox_h=None, gt_iou=None,
            detection_ms=120, segmentation_ms=None,
            detector_model="m", segmenter_model=None,
            processed_at=1747278900_000,
            schema_version=1,
        )
        for i in range(3)
    ]
    records = [row_to_pyarrow_record(r) for r in rows]
    table = pa.Table.from_pylist(records, schema=SCHEMA)
    buf = io.BytesIO()
    pq.write_table(table, buf, compression="snappy")
    buf.seek(0)
    loaded = pq.read_table(buf)
    assert loaded.num_rows == 3
    assert loaded.column("image_id").to_pylist() == ["test-0", "test-1", "test-2"]
