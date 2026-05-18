"""Verify classify.py passes new Phase 2 fields through to DetectionRow."""
from __future__ import annotations
import dataclasses

from scripts.detect_subjects.schema import DetectionRow, row_to_pyarrow_record


def test_detection_row_accepts_distinct_subjects_as_list_of_dicts():
    """distinct_subjects field is list[dict] in the DetectionRow dataclass."""
    field_names = {f.name for f in dataclasses.fields(DetectionRow)}
    assert "distinct_subjects" in field_names
    assert "text_label" in field_names
    assert "text_label_score" in field_names
    assert "gate_decision" in field_names


def test_row_to_pyarrow_record_includes_phase2_fields():
    """row_to_pyarrow_record emits the four new fields."""
    row = DetectionRow(
        image_id="x", source="inaturalist", variant="grounding_dino__insectsam",
        img_w=640, img_h=480, subject_state="wild",
        n_raw_detections=1, n_distinct_detections=1,
        bbox_x=0.1, bbox_y=0.1, bbox_w=0.2, bbox_h=0.2,
        confidence=0.8, bbox_area_ratio=0.04, offcenter=0.05,
        mask_area_ratio=None, mask_iou_score=None,
        lab_delta_e=None, lab_delta_e_p80=None,
        boundary_sharpness=None, subject_sharpness=None,
        top10pct_lap_mask=None, edge_density_mask_vs_bg=None,
        bbox_min_edge_px=None, bbox_long_edge_px=None, bbox_touches_edge=None,
        crop_x=None, crop_y=None, crop_w=None, crop_h=None,
        post_crop_subject_area=None,
        framing_quality="cropped", suggested_labels=[],
        gt_bbox_x=None, gt_bbox_y=None, gt_bbox_w=None, gt_bbox_h=None, gt_iou=None,
        detection_ms=50, segmentation_ms=None,
        detector_model="m", segmenter_model=None,
        processed_at=1000000, schema_version=1,
        text_label="a beetle",
        text_label_score=0.62,
        gate_decision=None,
        distinct_subjects=[{"x": 0.1, "y": 0.1, "w": 0.2, "h": 0.2, "conf": 0.8, "phrase": "a beetle"}],
    )
    record = row_to_pyarrow_record(row)
    assert record["text_label"] == "a beetle"
    assert abs(record["text_label_score"] - 0.62) < 1e-6
    assert record["gate_decision"] is None
    assert len(record["distinct_subjects"]) == 1
    assert record["distinct_subjects"][0]["phrase"] == "a beetle"
