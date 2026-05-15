"""PyArrow schema + DetectionRow dataclass for the framing detector parquet."""
from __future__ import annotations
from dataclasses import asdict, dataclass
from typing import Optional

import pyarrow as pa


@dataclass(slots=True)
class DetectionRow:
    image_id: str
    source: str
    variant: str
    img_w: int
    img_h: int
    subject_state: str
    n_raw_detections: int
    n_distinct_detections: int
    bbox_x: Optional[float]
    bbox_y: Optional[float]
    bbox_w: Optional[float]
    bbox_h: Optional[float]
    confidence: Optional[float]
    bbox_area_ratio: Optional[float]
    offcenter: Optional[float]
    mask_area_ratio: Optional[float]
    mask_iou_score: Optional[float]
    lab_delta_e: Optional[float]
    boundary_sharpness: Optional[float]
    subject_sharpness: Optional[float]
    bbox_min_edge_px: Optional[float]
    bbox_long_edge_px: Optional[float]
    bbox_touches_edge: Optional[bool]
    crop_x: Optional[float]
    crop_y: Optional[float]
    crop_w: Optional[float]
    crop_h: Optional[float]
    post_crop_subject_area: Optional[float]
    framing_quality: str
    suggested_labels: list[str]
    gt_bbox_x: Optional[float]
    gt_bbox_y: Optional[float]
    gt_bbox_w: Optional[float]
    gt_bbox_h: Optional[float]
    gt_iou: Optional[float]
    detection_ms: Optional[int]
    segmentation_ms: Optional[int]
    detector_model: str
    segmenter_model: Optional[str]
    processed_at: int  # unix epoch milliseconds
    schema_version: int


SCHEMA = pa.schema([
    ("image_id", pa.string()),
    ("source", pa.string()),
    ("variant", pa.string()),
    ("img_w", pa.int32()),
    ("img_h", pa.int32()),
    ("subject_state", pa.string()),
    ("n_raw_detections", pa.int16()),
    ("n_distinct_detections", pa.int16()),
    ("bbox_x", pa.float32()),
    ("bbox_y", pa.float32()),
    ("bbox_w", pa.float32()),
    ("bbox_h", pa.float32()),
    ("confidence", pa.float32()),
    ("bbox_area_ratio", pa.float32()),
    ("offcenter", pa.float32()),
    ("mask_area_ratio", pa.float32()),
    ("mask_iou_score", pa.float32()),
    ("lab_delta_e", pa.float32()),
    ("boundary_sharpness", pa.float32()),
    ("subject_sharpness", pa.float32()),
    ("bbox_min_edge_px", pa.float32()),
    ("bbox_long_edge_px", pa.float32()),
    ("bbox_touches_edge", pa.bool_()),
    ("crop_x", pa.float32()),
    ("crop_y", pa.float32()),
    ("crop_w", pa.float32()),
    ("crop_h", pa.float32()),
    ("post_crop_subject_area", pa.float32()),
    ("framing_quality", pa.string()),
    ("suggested_labels", pa.list_(pa.string())),
    ("gt_bbox_x", pa.float32()),
    ("gt_bbox_y", pa.float32()),
    ("gt_bbox_w", pa.float32()),
    ("gt_bbox_h", pa.float32()),
    ("gt_iou", pa.float32()),
    ("detection_ms", pa.int32()),
    ("segmentation_ms", pa.int32()),
    ("detector_model", pa.string()),
    ("segmenter_model", pa.string()),
    ("processed_at", pa.timestamp("ms")),
    ("schema_version", pa.int8()),
])


def row_to_pyarrow_record(row: DetectionRow) -> dict:
    return asdict(row)
