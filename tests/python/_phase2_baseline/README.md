# Phase 2-prep Baseline

Parquet snapshot captured at the start of Phase 2-prep (2026-05-16).
Source: `data/cache/framing_detections.parquet` at HEAD before any Phase 2 changes.

360 rows, variant `v1_dino_insectsam`, 41 columns.

The regression smoke test (Task 13) re-runs the pipeline over
`data/cache/validator_sample.parquet` and diffs the output against this
baseline on the columns that pre-work must NOT change:
`bbox_x`, `bbox_y`, `bbox_w`, `bbox_h`, `confidence`, `bbox_area_ratio`,
`offcenter`, `mask_area_ratio`, `mask_iou_score`, `lab_delta_e`,
`boundary_sharpness`, `subject_sharpness`, `bbox_min_edge_px`,
`bbox_long_edge_px`, `bbox_touches_edge`, `crop_x`, `crop_y`, `crop_w`,
`crop_h`, `post_crop_subject_area`, `framing_quality`, `suggested_labels`,
`n_raw_detections`, `n_distinct_detections`.

Columns that ARE expected to change after pre-work:
- `variant`: re-tagged from `v1_dino_insectsam` → `grounding_dino__insectsam`
- `text_label`, `text_label_score`: newly populated from DINO output
- `distinct_subjects`: populated from `det.distinct_subjects`
- `gate_decision`: new column, None for all rows (gate.py wired in 2a)

Do not modify. Delete after Phase 2 completes if desired.
