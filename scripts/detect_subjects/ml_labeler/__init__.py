"""Phase 3 ML labeler — frozen-feature classifiers per label.

V1 (this slice): scalar-arm only, mask_blur_unusable only.
See docs/superpowers/specs/2026-05-17-ml-labeler-design.md.
"""
from __future__ import annotations
from pathlib import Path

# Labels with >=30 positives in current labels.json — gate-consumable
TIER1_LABELS: list[str] = ["mask_blur_unusable"]

# Labels with <30 positives — train+report only, do not gate
TIER2_LABELS: list[str] = []

MODELS_DIR = Path(__file__).resolve().parent / "models"
MODELS_DIR.mkdir(parents=True, exist_ok=True)
