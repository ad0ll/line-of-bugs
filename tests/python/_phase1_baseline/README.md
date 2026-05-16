# Phase 1 Refactor Baseline

This directory contains the parquet snapshot captured at the start of the Phase 1
refactor. The final task in the Phase 1 plan runs the refactored pipeline against
the same input data and verifies the output matches this baseline.

If anything other than `subject_sharpness` (which is rounded differently in
different code paths) differs, the refactor changed behavior — which is a bug
under Phase 1's "no behavior change" contract.

Captured: 2026-05-16
Source: `data/cache/framing_detections.parquet` at HEAD before Phase 1 refactor.

Do not modify this file. Delete after Phase 1 completes if you want — it's a one-time
regression artifact.
