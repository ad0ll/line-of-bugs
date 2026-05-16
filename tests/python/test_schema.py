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
        "subject_sharpness", "bbox_min_edge_px", "bbox_long_edge_px", "bbox_touches_edge",
        "crop_x", "crop_y", "crop_w", "crop_h", "post_crop_subject_area",
        "framing_quality", "suggested_labels",
        "gt_bbox_x", "gt_bbox_y", "gt_bbox_w", "gt_bbox_h", "gt_iou",
        "detection_ms", "segmentation_ms",
        "detector_model", "segmenter_model",
        "processed_at", "schema_version",
        "text_label", "text_label_score", "gate_decision", "distinct_subjects",
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
        subject_sharpness=210.0, bbox_min_edge_px=600.0, bbox_long_edge_px=1100.0, bbox_touches_edge=False,
        crop_x=0.10, crop_y=0.15, crop_w=0.45, crop_h=0.50,
        post_crop_subject_area=0.30,
        framing_quality="wide",
        suggested_labels=["cropped-good"],
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
            subject_sharpness=None, bbox_min_edge_px=None, bbox_long_edge_px=None, bbox_touches_edge=None,
            crop_x=0.10, crop_y=0.15, crop_w=0.45, crop_h=0.50,
            post_crop_subject_area=0.30,
            framing_quality="wide",
            suggested_labels=["cropped-good"],
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


def test_schema_has_phase2_columns():
    """T1: four new Phase 2 columns must be present in SCHEMA and DetectionRow."""
    names = set(SCHEMA.names)
    assert "text_label" in names, "missing text_label"
    assert "text_label_score" in names, "missing text_label_score"
    assert "gate_decision" in names, "missing gate_decision"
    assert "distinct_subjects" in names, "missing distinct_subjects"

    # Verify pyarrow types
    idx = {name: i for i, name in enumerate(SCHEMA.names)}
    assert SCHEMA.field(idx["text_label"]).type == pa.string()
    assert SCHEMA.field(idx["text_label_score"]).type == pa.float32()
    assert SCHEMA.field(idx["gate_decision"]).type == pa.string()
    ds_type = SCHEMA.field(idx["distinct_subjects"]).type
    assert pa.types.is_list(ds_type), f"distinct_subjects should be list, got {ds_type}"
    struct_type = ds_type.value_type
    assert pa.types.is_struct(struct_type)
    field_names = {struct_type.field(i).name for i in range(struct_type.num_fields)}
    assert field_names == {"x", "y", "w", "h", "conf", "phrase"}


def test_detection_row_has_phase2_fields():
    """T1: DetectionRow dataclass has the four new optional fields."""
    import dataclasses
    field_names = {f.name for f in dataclasses.fields(DetectionRow)}
    assert "text_label" in field_names
    assert "text_label_score" in field_names
    assert "gate_decision" in field_names
    assert "distinct_subjects" in field_names


def test_detection_row_phase2_round_trip():
    """T1: new fields survive parquet round-trip."""
    row = DetectionRow(
        image_id="inat-p2", source="inaturalist",
        variant="grounding_dino__insectsam",
        img_w=3000, img_h=2000, subject_state="wild",
        n_raw_detections=2, n_distinct_detections=1,
        bbox_x=0.2, bbox_y=0.3, bbox_w=0.1, bbox_h=0.15,
        confidence=0.72,
        bbox_area_ratio=0.015, offcenter=0.10,
        mask_area_ratio=0.012, mask_iou_score=0.88,
        lab_delta_e=18.5, boundary_sharpness=14.2,
        subject_sharpness=195.0, bbox_min_edge_px=400.0, bbox_long_edge_px=800.0,
        bbox_touches_edge=False,
        crop_x=0.05, crop_y=0.10, crop_w=0.40, crop_h=0.45,
        post_crop_subject_area=0.28,
        framing_quality="cropped",
        suggested_labels=["cropped-good"],
        gt_bbox_x=None, gt_bbox_y=None, gt_bbox_w=None, gt_bbox_h=None, gt_iou=None,
        detection_ms=110, segmentation_ms=90,
        detector_model="IDEA-Research/grounding-dino-base",
        segmenter_model="martintomov/InsectSAM",
        processed_at=1747278900_000,
        schema_version=1,
        text_label="a beetle",
        text_label_score=0.55,
        gate_decision=None,
        distinct_subjects=[{"x": 0.2, "y": 0.3, "w": 0.1, "h": 0.15, "conf": 0.72, "phrase": "a beetle"}],
    )
    import io
    import pyarrow.parquet as pq
    record = row_to_pyarrow_record(row)
    table = pa.Table.from_pylist([record], schema=SCHEMA)
    buf = io.BytesIO()
    pq.write_table(table, buf, compression="snappy")
    buf.seek(0)
    loaded = pq.read_table(buf)
    assert loaded.num_rows == 1
    assert loaded.column("text_label").to_pylist() == ["a beetle"]
    assert loaded.column("gate_decision").to_pylist() == [None]
    ds = loaded.column("distinct_subjects").to_pylist()
    assert len(ds[0]) == 1
    assert ds[0][0]["phrase"] == "a beetle"
