# Phase 2a Baseline

Parquet snapshot captured at start of Phase 2a (post-Phase-2-prep state).
360 rows, variant `grounding_dino__insectsam`, 45 columns.

Regression test compares regenerated parquet against this baseline on columns 2a should preserve:
all detection geometry + features + `text_label` + `text_label_score` + `distinct_subjects`.

Columns expected to change:
- `suggested_labels` — now emits new vocabulary
- `gate_decision` — populated by gate.py wiring
