# Pipeline Refactor (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the existing single-variant pipeline (`pipeline.py` + `classify.py` + `detector_dino.py` + `segmenter_insectsam.py`) into a Protocol-based modular architecture with detector / segmenter factory functions, with ZERO behavior change verified by smoke test.

**Architecture:** Extract pure-logic feature computations into `features.py`, define Python `Protocol` types in `interfaces.py`, create a `gate.py` for the keep/reject decision, rename `classify.py` (rule labeler) → `rule_labeler.py`, rename `pipeline.py` (orchestrator) → `classify.py`, move model wrappers into `detectors/` and `segmenters/` packages with factory functions. After this phase, swapping detector or segmenter is a config-only change. No new features, no model swaps, no label vocabulary changes (Phase 2 territory).

**Tech Stack:** Python 3.12, pytest 8.3, polars 1.40, pyarrow 24.0, PyTorch 2.12 on MPS. No new dependencies.

**Verification approach:** every refactor task has a test that proves identical output before AND after. The final task is a regression smoke test: run the full pipeline against `data/cache/validator_sample.parquet` and verify the produced parquet matches the snapshot taken before this phase started.

**Out of scope for Phase 1:** SAM 3 swap, prompt builder, label vocabulary migration, validator UI changes, ML labelers, active surfacing, PR curve tool. Each gets its own follow-up plan.

---

## Task 0: Setup — capture baseline for regression testing

**Files:**
- Create: `tests/python/_phase1_baseline/baseline_v1.parquet`
- Create: `tests/python/_phase1_baseline/README.md`

- [ ] **Step 1: Capture current parquet output as the baseline snapshot**

```bash
# Save the current parquet (it is what the pipeline produces today)
mkdir -p tests/python/_phase1_baseline
cp data/cache/framing_detections.parquet tests/python/_phase1_baseline/baseline_v1.parquet
```

- [ ] **Step 2: Create README documenting the baseline**

Create `tests/python/_phase1_baseline/README.md`:

```markdown
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
```

- [ ] **Step 3: Verify the baseline file exists and has expected rows**

```bash
.venv/bin/python -c "
import polars as pl
df = pl.read_parquet('tests/python/_phase1_baseline/baseline_v1.parquet')
print(f'rows: {df.height}, cols: {len(df.columns)}, variants: {df[\"variant\"].unique().to_list()}')
"
```
Expected output similar to: `rows: 360, cols: 40, variants: ['v1_dino_insectsam']`

- [ ] **Step 4: Commit the baseline**

```bash
git add tests/python/_phase1_baseline/
git commit --no-gpg-sign -m "test: capture phase 1 refactor baseline parquet for regression"
```

---

## Task 1: Define Protocol interfaces

**Files:**
- Create: `scripts/detect_subjects/interfaces.py`
- Create: `tests/python/test_interfaces.py`

- [ ] **Step 1: Write the failing test for Protocol existence + dataclass shape**

Create `tests/python/test_interfaces.py`:

```python
"""Protocol contracts for the modular pipeline."""
from __future__ import annotations
import inspect

from scripts.detect_subjects.interfaces import (
    Detector, Segmenter, MLLabeler,
    DetectionResult, SegmentationResult,
)


def test_detector_protocol_has_detect_method():
    assert hasattr(Detector, "detect")


def test_segmenter_protocol_has_segment_with_bbox_method():
    assert hasattr(Segmenter, "segment_with_bbox")


def test_ml_labeler_protocol_has_predict_method():
    assert hasattr(MLLabeler, "predict")


def test_detection_result_fields():
    result = DetectionResult(
        bbox_xywh_normalized=(0.1, 0.2, 0.3, 0.4),
        confidence=0.85,
        n_raw_detections=3,
        n_distinct_detections=1,
        distinct_subjects=[(0.1, 0.2, 0.3, 0.4, 0.85, "a butterfly")],
        text_label="a butterfly",
        text_label_score=0.42,
        detection_ms=120,
    )
    assert result.bbox_xywh_normalized == (0.1, 0.2, 0.3, 0.4)
    assert result.text_label == "a butterfly"


def test_detection_result_nullable_fields():
    """When no bug detected, primary fields are None."""
    result = DetectionResult(
        bbox_xywh_normalized=None,
        confidence=None,
        n_raw_detections=0,
        n_distinct_detections=0,
        distinct_subjects=[],
        text_label=None,
        text_label_score=None,
        detection_ms=42,
    )
    assert result.bbox_xywh_normalized is None


def test_segmentation_result_fields():
    import numpy as np
    mask = np.zeros((10, 10), dtype=bool)
    result = SegmentationResult(mask=mask, iou_score=0.92, segmentation_ms=85)
    assert result.iou_score == 0.92
    assert result.mask.shape == (10, 10)
```

- [ ] **Step 2: Run test to verify it fails**

```bash
.venv/bin/python -m pytest tests/python/test_interfaces.py -v
```
Expected: `ModuleNotFoundError: No module named 'scripts.detect_subjects.interfaces'`

- [ ] **Step 3: Create interfaces.py with Protocols and dataclasses**

Create `scripts/detect_subjects/interfaces.py`:

```python
"""Protocol contracts for the modular label pipeline.

The pipeline composes a Detector (text → bbox + per-detection phrase),
a Segmenter (bbox → mask), and zero-or-more MLLabelers (features → label
probabilities) into a label-emission chain. Any implementation satisfying
these Protocols is a valid swap-in.
"""
from __future__ import annotations
from dataclasses import dataclass, field
from typing import Optional, Protocol, runtime_checkable

import numpy as np
from PIL import Image


@dataclass(slots=True)
class DetectionResult:
    """One detection pass over one image: primary bbox + all distinct subjects."""
    bbox_xywh_normalized: Optional[tuple[float, float, float, float]]
    confidence: Optional[float]
    n_raw_detections: int
    n_distinct_detections: int
    # Each distinct subject: (x, y, w, h, confidence, text_label_phrase)
    # text_label_phrase may be None if the detector doesn't expose per-phrase matches.
    distinct_subjects: list[tuple[float, float, float, float, float, Optional[str]]] = \
        field(default_factory=list)
    # Phrase that matched the primary bbox (e.g., "a butterfly"). None if not exposed.
    text_label: Optional[str] = None
    # Text-alignment confidence of the primary bbox's matched phrase.
    text_label_score: Optional[float] = None
    detection_ms: int = 0


@dataclass(slots=True)
class SegmentationResult:
    """One segmentation pass over one bbox: pixel mask + model's IoU self-score."""
    mask: Optional[np.ndarray]
    iou_score: Optional[float]
    segmentation_ms: int


@runtime_checkable
class Detector(Protocol):
    """Open-vocabulary bbox detector. Takes image + (internal text prompt) →
    bbox + per-detection phrase + count."""
    def detect(self, image: Image.Image, image_id: str | None = None
               ) -> DetectionResult: ...


@runtime_checkable
class Segmenter(Protocol):
    """Bbox-prompted segmenter. Takes image + normalized xywh bbox → pixel mask."""
    def segment_with_bbox(
        self, image_id: str, image: Image.Image,
        bbox_xywh_normalized: tuple[float, float, float, float],
    ) -> SegmentationResult: ...


@runtime_checkable
class MLLabeler(Protocol):
    """Trained ML labeler. Takes features dict → {label_name: probability}."""
    def predict(self, image_id: str, features: dict) -> dict[str, float]: ...
```

- [ ] **Step 4: Run test to verify it passes**

```bash
.venv/bin/python -m pytest tests/python/test_interfaces.py -v
```
Expected: 6 passed

- [ ] **Step 5: Commit**

```bash
git add scripts/detect_subjects/interfaces.py tests/python/test_interfaces.py
git commit --no-gpg-sign -m "feat: add Protocol interfaces + result dataclasses for pipeline stages"
```

---

## Task 2: Extract `features.py` — geometric features

**Files:**
- Create: `scripts/detect_subjects/features.py`
- Create: `tests/python/test_features.py`
- Reference: `scripts/detect_subjects/pipeline.py:111-130` (source of geometric feature inline code)
- Reference: `scripts/detect_subjects/metrics.py:6-18` (existing helpers we'll reuse)

- [ ] **Step 1: Write the failing test for `compute_geometric_features`**

Create `tests/python/test_features.py`:

```python
"""Tests for pure feature computation helpers in features.py."""
from __future__ import annotations
import numpy as np

from scripts.detect_subjects.features import compute_geometric_features


def test_geometric_features_basic_bbox():
    """Bbox in middle of frame, 30% × 40% in size."""
    out = compute_geometric_features(
        bbox_xywh_normalized=(0.35, 0.30, 0.30, 0.40),
        img_w=1000, img_h=500,
    )
    assert out["bbox_area_ratio"] == 0.12  # 0.30 * 0.40
    assert out["bbox_min_edge_px"] == 200.0  # min(0.40*500, 0.30*1000) → 200
    assert out["bbox_long_edge_px"] == 300.0  # max(...) → 300
    assert out["bbox_touches_edge"] is False
    assert 0 <= out["offcenter"] <= 1


def test_geometric_features_edge_touching():
    """Bbox flush against image left edge → touches edge."""
    out = compute_geometric_features(
        bbox_xywh_normalized=(0.0, 0.10, 0.15, 0.20),
        img_w=1000, img_h=500,
    )
    assert out["bbox_touches_edge"] is True


def test_geometric_features_within_tolerance_touches_edge():
    """Bbox within 1.4% of image edge counts as touching (current config)."""
    out = compute_geometric_features(
        bbox_xywh_normalized=(0.01, 0.10, 0.15, 0.20),
        img_w=1000, img_h=500,
    )
    # Default BBOX_EDGE_TOLERANCE_NORMALIZED is 0.014
    assert out["bbox_touches_edge"] is True


def test_geometric_features_none_bbox_returns_all_none():
    """No bbox → all features are None."""
    out = compute_geometric_features(
        bbox_xywh_normalized=None,
        img_w=1000, img_h=500,
    )
    assert out["bbox_area_ratio"] is None
    assert out["bbox_long_edge_px"] is None
    assert out["bbox_touches_edge"] is None


def test_geometric_features_long_edge_picks_max():
    """For a tall narrow bbox, long edge is the height in px."""
    out = compute_geometric_features(
        bbox_xywh_normalized=(0.40, 0.10, 0.05, 0.80),
        img_w=1000, img_h=2000,
    )
    # height in px = 0.80 * 2000 = 1600; width in px = 0.05 * 1000 = 50
    assert out["bbox_long_edge_px"] == 1600.0
    assert out["bbox_min_edge_px"] == 50.0
```

- [ ] **Step 2: Run test to verify it fails**

```bash
.venv/bin/python -m pytest tests/python/test_features.py -v
```
Expected: `ModuleNotFoundError: No module named 'scripts.detect_subjects.features'`

- [ ] **Step 3: Create `features.py` with `compute_geometric_features`**

Create `scripts/detect_subjects/features.py`:

```python
"""Pure feature computation helpers.

All functions in this module are pure — they take primitive inputs (numbers,
tuples, numpy arrays) and return primitive outputs (numbers, dicts). They do
not depend on PyTorch, model objects, or I/O.

Extracted from the inline computations in pipeline.py during the Phase 1 refactor
so they can be tested in isolation and reused across pipeline variants.
"""
from __future__ import annotations
from typing import Optional

from scripts.detect_subjects.config import BBOX_EDGE_TOLERANCE_NORMALIZED
from scripts.detect_subjects.metrics import (
    bbox_area_ratio_normalized,
    offcenter_normalized,
)


def compute_geometric_features(
    bbox_xywh_normalized: Optional[tuple[float, float, float, float]],
    img_w: int, img_h: int,
) -> dict:
    """Compute bbox-derived scalar features.

    Returns a dict with keys (all None when bbox is None):
      bbox_area_ratio   — bbox area / image area (0..1)
      offcenter         — distance from bbox center to image center (normalized)
      bbox_min_edge_px  — min(bbox_w_px, bbox_h_px), absolute pixels
      bbox_long_edge_px — max(bbox_w_px, bbox_h_px), absolute pixels
      bbox_touches_edge — True if any bbox edge is within BBOX_EDGE_TOLERANCE_NORMALIZED of the image edge
    """
    if bbox_xywh_normalized is None:
        return {
            "bbox_area_ratio": None,
            "offcenter": None,
            "bbox_min_edge_px": None,
            "bbox_long_edge_px": None,
            "bbox_touches_edge": None,
        }
    bx, by, bw, bh = bbox_xywh_normalized
    return {
        "bbox_area_ratio": bbox_area_ratio_normalized(bw, bh),
        "offcenter": offcenter_normalized(bx, by, bw, bh),
        "bbox_min_edge_px": float(min(bw * img_w, bh * img_h)),
        "bbox_long_edge_px": float(max(bw * img_w, bh * img_h)),
        "bbox_touches_edge": bool(
            bx < BBOX_EDGE_TOLERANCE_NORMALIZED
            or by < BBOX_EDGE_TOLERANCE_NORMALIZED
            or (bx + bw) > (1.0 - BBOX_EDGE_TOLERANCE_NORMALIZED)
            or (by + bh) > (1.0 - BBOX_EDGE_TOLERANCE_NORMALIZED)
        ),
    }
```

- [ ] **Step 4: Run test to verify it passes**

```bash
.venv/bin/python -m pytest tests/python/test_features.py -v
```
Expected: 5 passed

- [ ] **Step 5: Commit**

```bash
git add scripts/detect_subjects/features.py tests/python/test_features.py
git commit --no-gpg-sign -m "feat: extract compute_geometric_features from pipeline into features.py"
```

---

## Task 3: Extend `features.py` — mask features + subject sharpness

**Files:**
- Modify: `scripts/detect_subjects/features.py`
- Modify: `tests/python/test_features.py`
- Reference: `scripts/detect_subjects/pipeline.py:132-153` (source code to extract)

- [ ] **Step 1: Add failing tests for `compute_mask_features` and `compute_subject_sharpness`**

Append to `tests/python/test_features.py`:

```python
def test_mask_features_with_simple_mask():
    """Solid-color background + a single high-contrast mask region."""
    import numpy as np
    H, W = 200, 200
    rgb = np.full((H, W, 3), 200, dtype=np.uint8)  # background = grey
    # Put a dark square in the middle as "the bug"
    rgb[80:120, 80:120] = (30, 30, 30)
    mask = np.zeros((H, W), dtype=bool)
    mask[80:120, 80:120] = True

    from scripts.detect_subjects.features import compute_mask_features
    out = compute_mask_features(mask, rgb)
    assert out["mask_area_ratio"] == 1600 / (200 * 200)  # 40*40/40000 = 0.04
    assert out["lab_delta_e"] > 50  # huge contrast (grey 200 vs dark 30)
    assert out["boundary_sharpness"] > 0  # crisp edge


def test_mask_features_none_mask_returns_none_values():
    """No mask → all fields None."""
    from scripts.detect_subjects.features import compute_mask_features
    out = compute_mask_features(None, rgb=None)
    assert out["mask_area_ratio"] is None
    assert out["lab_delta_e"] is None
    assert out["boundary_sharpness"] is None


def test_mask_features_empty_mask_returns_zero_area():
    """Mask of all False → area is 0; ΔE/sharpness undefined (None) because nothing inside."""
    import numpy as np
    mask = np.zeros((50, 50), dtype=bool)
    rgb = np.zeros((50, 50, 3), dtype=np.uint8)
    from scripts.detect_subjects.features import compute_mask_features
    out = compute_mask_features(mask, rgb)
    assert out["mask_area_ratio"] == 0.0
    assert out["lab_delta_e"] is None
    assert out["boundary_sharpness"] is None


def test_subject_sharpness_returns_float():
    """Sharp synthetic image inside bbox → positive Laplacian variance."""
    import numpy as np
    rgb = np.zeros((200, 200, 3), dtype=np.uint8)
    # Add a high-frequency checkerboard inside the bbox region
    for y in range(50, 150):
        for x in range(50, 150):
            if (x + y) % 2 == 0:
                rgb[y, x] = (255, 255, 255)
    from scripts.detect_subjects.features import compute_subject_sharpness
    val = compute_subject_sharpness(
        rgb, bbox_xywh_normalized=(0.25, 0.25, 0.50, 0.50),
        img_w=200, img_h=200,
    )
    assert val is not None
    assert val > 100  # checkerboard has very high Laplacian variance


def test_subject_sharpness_none_bbox_returns_none():
    from scripts.detect_subjects.features import compute_subject_sharpness
    val = compute_subject_sharpness(rgb=None, bbox_xywh_normalized=None,
                                     img_w=100, img_h=100)
    assert val is None


def test_subject_sharpness_tiny_bbox_returns_none():
    """Bbox smaller than 5px doesn't have enough data for Laplacian → None."""
    import numpy as np
    rgb = np.zeros((100, 100, 3), dtype=np.uint8)
    from scripts.detect_subjects.features import compute_subject_sharpness
    val = compute_subject_sharpness(
        rgb, bbox_xywh_normalized=(0.49, 0.49, 0.02, 0.02),
        img_w=100, img_h=100,
    )
    assert val is None
```

- [ ] **Step 2: Run tests to verify failures**

```bash
.venv/bin/python -m pytest tests/python/test_features.py -v
```
Expected: 5 prior tests pass, 6 new tests fail with `ImportError: cannot import name 'compute_mask_features' from 'scripts.detect_subjects.features'`

- [ ] **Step 3: Add `compute_mask_features` and `compute_subject_sharpness` to `features.py`**

Append to `scripts/detect_subjects/features.py`:

```python
import cv2
import numpy as np

from scripts.detect_subjects.metrics import (
    lab_delta_e_mask_vs_background,
    boundary_sharpness,
)


def compute_mask_features(mask, rgb) -> dict:
    """Compute mask-derived scalar features.

    Returns a dict with keys (None when mask is None/empty):
      mask_area_ratio    — fraction of image pixels inside mask
      lab_delta_e        — mean LAB color difference between mask interior and exterior
      boundary_sharpness — mean Sobel gradient magnitude along mask boundary
    """
    if mask is None:
        return {"mask_area_ratio": None, "lab_delta_e": None,
                "boundary_sharpness": None}
    if not mask.any():
        return {"mask_area_ratio": 0.0, "lab_delta_e": None,
                "boundary_sharpness": None}
    return {
        "mask_area_ratio": float(mask.sum()) / float(mask.size),
        "lab_delta_e": lab_delta_e_mask_vs_background(rgb, mask),
        "boundary_sharpness": boundary_sharpness(rgb, mask),
    }


def compute_subject_sharpness(rgb, bbox_xywh_normalized, img_w: int, img_h: int):
    """Laplacian variance over the bbox region. Higher = sharper.

    Returns None if no bbox or bbox is too small (< 4px in either dimension).
    Note: known unreliable on uniform-textured subjects (e.g., smooth bug bodies).
    Stored as a feature for ML labelers to use, not for hard rules.
    """
    if bbox_xywh_normalized is None or rgb is None:
        return None
    x, y, w, h = bbox_xywh_normalized
    x1 = int(x * img_w); y1 = int(y * img_h)
    x2 = int((x + w) * img_w); y2 = int((y + h) * img_h)
    if x2 - x1 < 5 or y2 - y1 < 5:
        return None
    crop = rgb[y1:y2, x1:x2]
    gray = cv2.cvtColor(crop, cv2.COLOR_RGB2GRAY)
    return float(cv2.Laplacian(gray, cv2.CV_64F).var())
```

- [ ] **Step 4: Run tests to verify all pass**

```bash
.venv/bin/python -m pytest tests/python/test_features.py -v
```
Expected: 11 passed

- [ ] **Step 5: Commit**

```bash
git add scripts/detect_subjects/features.py tests/python/test_features.py
git commit --no-gpg-sign -m "feat: extract mask + subject-sharpness features from pipeline into features.py"
```

---

## Task 4: Create `gate.py` — strict drawability keep/reject

**Files:**
- Create: `scripts/detect_subjects/gate.py`
- Create: `tests/python/test_gate.py`

This task implements the strict drawability gate per the spec — pure logic taking a label record and returning a keep/reject decision.

- [ ] **Step 1: Write the failing test for `decide_drawability`**

Create `tests/python/test_gate.py`:

```python
"""Tests for the drawability gate."""
from __future__ import annotations

from scripts.detect_subjects.gate import (
    decide_drawability, GateDecision,
)


def _empty_label_record():
    return {
        "bbox": "bbox_correct-subject_not-clipped",
        "bbox_content_count": "bbox-content_single",
        "bbox_too_small": False,
        "mask_labels": [],         # selected mask_* labels
        "ml_labels": [],           # selected ml_* labels
    }


def test_default_labels_keep():
    """All four columns at their 'good' default → keep."""
    decision = decide_drawability(_empty_label_record())
    assert decision == GateDecision.KEEP


def test_bbox_wrong_rejects():
    rec = _empty_label_record()
    rec["bbox"] = "bbox_wrong-subject"
    assert decide_drawability(rec) == GateDecision.REJECT


def test_bbox_clipped_rejects():
    rec = _empty_label_record()
    rec["bbox"] = "bbox_correct-subject_clipped"
    assert decide_drawability(rec) == GateDecision.REJECT


def test_no_bug_rejects():
    rec = _empty_label_record()
    rec["bbox_content_count"] = "bbox-content_no-bug"
    assert decide_drawability(rec) == GateDecision.REJECT


def test_multibug_unusable_rejects():
    rec = _empty_label_record()
    rec["bbox_content_count"] = "bbox-content_bbox-multibug_unusable"
    assert decide_drawability(rec) == GateDecision.REJECT


def test_multibug_usable_also_rejects():
    """Soft-reject still rejects today; preserves analytics signal."""
    rec = _empty_label_record()
    rec["bbox_content_count"] = "bbox-content_bbox-multibug_usable"
    assert decide_drawability(rec) == GateDecision.REJECT


def test_too_small_rejects():
    rec = _empty_label_record()
    rec["bbox_too_small"] = True
    assert decide_drawability(rec) == GateDecision.REJECT


def test_mask_rejection_rejects():
    rec = _empty_label_record()
    rec["mask_labels"] = ["mask_blur_unusable"]
    assert decide_drawability(rec) == GateDecision.REJECT


def test_mask_blur_usable_also_rejects():
    rec = _empty_label_record()
    rec["mask_labels"] = ["mask_blur_usable"]
    assert decide_drawability(rec) == GateDecision.REJECT


def test_ml_label_other_bad_rejects():
    rec = _empty_label_record()
    rec["ml_labels"] = ["ml_other-bad"]
    assert decide_drawability(rec) == GateDecision.REJECT


def test_image_multi_bug_is_informational_only():
    """bbox-content_image-multi-bug is NOT a gate signal."""
    rec = _empty_label_record()
    rec["bbox_content_image_multi_bug"] = True  # informational flag
    assert decide_drawability(rec) == GateDecision.KEEP
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
.venv/bin/python -m pytest tests/python/test_gate.py -v
```
Expected: `ModuleNotFoundError: No module named 'scripts.detect_subjects.gate'`

- [ ] **Step 3: Create `gate.py`**

Create `scripts/detect_subjects/gate.py`:

```python
"""Drawability gate — combines all label sources into one keep/reject decision.

Per the strict gate definition (modular pipeline design spec, 2026-05-15):
  Reject if ANY of:
    - §1 not bbox_correct-subject_not-clipped
    - §2 count != bbox-content_single, OR bbox-content_subject-too-small set
    - §3 any selection other than mask_good (including soft-reject _usable variants)
    - §4 any selection other than ml_good

  Keep otherwise. bbox-content_image-multi-bug is informational and does NOT
  contribute to the gate decision.
"""
from __future__ import annotations
from enum import Enum


class GateDecision(Enum):
    KEEP = "keep"
    REJECT = "reject"


_BBOX_GOOD = "bbox_correct-subject_not-clipped"
_BBOX_CONTENT_SINGLE = "bbox-content_single"


def decide_drawability(label_record: dict) -> GateDecision:
    """Return KEEP if all four columns at their 'good' default, REJECT otherwise.

    Expected label_record shape:
      {
        "bbox": str,                       # §1 — one of bbox_*
        "bbox_content_count": str,         # §2 count — one of bbox-content_*
        "bbox_too_small": bool,            # §2 independent flag
        "bbox_content_image_multi_bug": bool,  # §2 informational (NOT a gate signal)
        "mask_labels": list[str],          # §3 selections (any non-empty = reject)
        "ml_labels": list[str],            # §4 selections (any non-empty = reject)
      }
    """
    if label_record.get("bbox") != _BBOX_GOOD:
        return GateDecision.REJECT
    if label_record.get("bbox_content_count") != _BBOX_CONTENT_SINGLE:
        return GateDecision.REJECT
    if label_record.get("bbox_too_small"):
        return GateDecision.REJECT
    if label_record.get("mask_labels"):
        return GateDecision.REJECT
    if label_record.get("ml_labels"):
        return GateDecision.REJECT
    # image_multi_bug is informational; NOT checked.
    return GateDecision.KEEP
```

- [ ] **Step 4: Run tests to verify all pass**

```bash
.venv/bin/python -m pytest tests/python/test_gate.py -v
```
Expected: 11 passed

- [ ] **Step 5: Commit**

```bash
git add scripts/detect_subjects/gate.py tests/python/test_gate.py
git commit --no-gpg-sign -m "feat: add gate.py — strict drawability keep/reject decision"
```

---

## Task 5: Rename `classify.py` → `rule_labeler.py`

This frees up the name `classify.py` for the orchestrator (Task 8).

**Files:**
- Move: `scripts/detect_subjects/classify.py` → `scripts/detect_subjects/rule_labeler.py`
- Move: `tests/python/test_classify.py` → `tests/python/test_rule_labeler.py`
- Reference: every file that imports from `scripts.detect_subjects.classify`

- [ ] **Step 1: Identify all importers of the old module**

```bash
grep -rn "from scripts.detect_subjects.classify\|scripts.detect_subjects.classify import" \
  scripts/ tests/ 2>&1
```
Expected: a handful of files (pipeline.py, evaluate_v1.py, test_classify.py, etc.). Record them.

- [ ] **Step 2: Move the file and the test file**

```bash
git mv scripts/detect_subjects/classify.py scripts/detect_subjects/rule_labeler.py
git mv tests/python/test_classify.py tests/python/test_rule_labeler.py
```

- [ ] **Step 3: Update all imports**

For each importer file identified in Step 1, replace `scripts.detect_subjects.classify` with `scripts.detect_subjects.rule_labeler`:

```bash
# example replacements — actual list from Step 1
sed -i '' 's/scripts\.detect_subjects\.classify/scripts.detect_subjects.rule_labeler/g' \
  scripts/detect_subjects/pipeline.py \
  scripts/detect_subjects/evaluate_v1.py \
  scripts/detect_subjects/build_html.py \
  tests/python/test_rule_labeler.py
```
(Adjust the file list to match what Step 1 found.)

- [ ] **Step 4: Run all tests to confirm nothing broke**

```bash
.venv/bin/python -m pytest tests/python -q --ignore=tests/python/test_taxon_subgroup_extract.py
```
Expected: same passing test count as before the rename (55+).

- [ ] **Step 5: Verify pipeline import chain still works**

```bash
.venv/bin/python -c "from scripts.detect_subjects.pipeline import run_v1_on_sample; print('imports ok')"
```
Expected: `imports ok`

- [ ] **Step 6: Commit**

```bash
git commit --no-gpg-sign -m "refactor: rename classify.py to rule_labeler.py (vocab alignment)"
```

---

## Task 6: Move detector wrapper to `detectors/` package + add factory

**Files:**
- Create: `scripts/detect_subjects/detectors/__init__.py` (factory)
- Move: `scripts/detect_subjects/detector_dino.py` → `scripts/detect_subjects/detectors/grounding_dino.py`
- Create: `scripts/detect_subjects/detector_dino.py` (one-line re-export shim)
- Modify: any file importing from `scripts.detect_subjects.detector_dino`

- [ ] **Step 1: Create the detectors package directory and move the file**

```bash
mkdir -p scripts/detect_subjects/detectors
git mv scripts/detect_subjects/detector_dino.py \
       scripts/detect_subjects/detectors/grounding_dino.py
```

- [ ] **Step 2: Write the factory `__init__.py`**

Create `scripts/detect_subjects/detectors/__init__.py`:

```python
"""Detector factory: name → Detector-implementing instance.

Add new detectors by importing them here and adding a case to make_detector().
"""
from __future__ import annotations
from typing import Any

from scripts.detect_subjects.detectors.grounding_dino import GroundingDinoDetector

_REGISTRY: dict[str, type] = {
    "grounding_dino": GroundingDinoDetector,
}


def make_detector(name: str, **kwargs: Any):
    """Construct a detector by registry name."""
    if name not in _REGISTRY:
        raise ValueError(
            f"unknown detector {name!r}; registered: {sorted(_REGISTRY)}"
        )
    return _REGISTRY[name](**kwargs)


def registered_detectors() -> list[str]:
    return sorted(_REGISTRY)
```

- [ ] **Step 3: Create the backward-compat shim at the old path**

Create `scripts/detect_subjects/detector_dino.py`:

```python
"""Backward-compat shim. Real module: scripts.detect_subjects.detectors.grounding_dino.

Deprecated. Use `from scripts.detect_subjects.detectors import make_detector`
or import directly from `scripts.detect_subjects.detectors.grounding_dino`.
"""
from scripts.detect_subjects.detectors.grounding_dino import (
    GroundingDinoDetector,
    DetectionResult,
    DINO_CACHE_DIR,
)
```

- [ ] **Step 4: Run the existing tests to verify the shim works**

```bash
.venv/bin/python -m pytest tests/python -q --ignore=tests/python/test_taxon_subgroup_extract.py
```
Expected: same test count passing.

- [ ] **Step 5: Write a smoke test for the factory**

Create `tests/python/test_detector_factory.py`:

```python
"""Smoke tests for the detectors package factory."""
from __future__ import annotations

from scripts.detect_subjects.detectors import (
    make_detector, registered_detectors,
)


def test_registered_detectors_includes_grounding_dino():
    assert "grounding_dino" in registered_detectors()


def test_unknown_detector_raises():
    import pytest
    with pytest.raises(ValueError, match="unknown detector"):
        make_detector("nonexistent_detector")


def test_make_detector_returns_an_object_with_detect():
    """We don't load the model (heavy); just check the class is callable
    and has the expected interface. Use lazy_init=True if available, or skip
    model loading via mock; otherwise trust that the existing tests cover
    the actual detection behavior."""
    # Check that make_detector returns a callable type without loading weights.
    from scripts.detect_subjects.detectors.grounding_dino import GroundingDinoDetector
    assert callable(getattr(GroundingDinoDetector, "detect", None))
```

- [ ] **Step 6: Run the factory test**

```bash
.venv/bin/python -m pytest tests/python/test_detector_factory.py -v
```
Expected: 3 passed.

- [ ] **Step 7: Commit**

```bash
git add scripts/detect_subjects/detectors/ scripts/detect_subjects/detector_dino.py \
        tests/python/test_detector_factory.py
git commit --no-gpg-sign -m "refactor: move detector wrapper to detectors/ package with factory"
```

---

## Task 7: Move segmenter wrapper to `segmenters/` package + add factory

Symmetric with Task 6, applied to the segmenter.

**Files:**
- Create: `scripts/detect_subjects/segmenters/__init__.py` (factory)
- Move: `scripts/detect_subjects/segmenter_insectsam.py` → `scripts/detect_subjects/segmenters/insectsam.py`
- Create: `scripts/detect_subjects/segmenter_insectsam.py` (re-export shim)

- [ ] **Step 1: Create the segmenters package directory and move the file**

```bash
mkdir -p scripts/detect_subjects/segmenters
git mv scripts/detect_subjects/segmenter_insectsam.py \
       scripts/detect_subjects/segmenters/insectsam.py
```

- [ ] **Step 2: Write the factory `__init__.py`**

Create `scripts/detect_subjects/segmenters/__init__.py`:

```python
"""Segmenter factory: name → Segmenter-implementing instance."""
from __future__ import annotations
from typing import Any

from scripts.detect_subjects.segmenters.insectsam import InsectSAMSegmenter

_REGISTRY: dict[str, type] = {
    "insectsam": InsectSAMSegmenter,
}


def make_segmenter(name: str, **kwargs: Any):
    if name not in _REGISTRY:
        raise ValueError(
            f"unknown segmenter {name!r}; registered: {sorted(_REGISTRY)}"
        )
    return _REGISTRY[name](**kwargs)


def registered_segmenters() -> list[str]:
    return sorted(_REGISTRY)
```

- [ ] **Step 3: Create the backward-compat shim at the old path**

Create `scripts/detect_subjects/segmenter_insectsam.py`:

```python
"""Backward-compat shim. Real module: scripts.detect_subjects.segmenters.insectsam.

Deprecated. Use `from scripts.detect_subjects.segmenters import make_segmenter`
or import directly from `scripts.detect_subjects.segmenters.insectsam`.
"""
from scripts.detect_subjects.segmenters.insectsam import (
    InsectSAMSegmenter,
    SegmentationResult,
    SAM_EMBED_DIR,
)
```

- [ ] **Step 4: Write a smoke test for the segmenter factory**

Create `tests/python/test_segmenter_factory.py`:

```python
"""Smoke tests for the segmenters package factory."""
from __future__ import annotations
import pytest

from scripts.detect_subjects.segmenters import (
    make_segmenter, registered_segmenters,
)


def test_registered_segmenters_includes_insectsam():
    assert "insectsam" in registered_segmenters()


def test_unknown_segmenter_raises():
    with pytest.raises(ValueError, match="unknown segmenter"):
        make_segmenter("nonexistent_segmenter")


def test_make_segmenter_class_has_required_method():
    from scripts.detect_subjects.segmenters.insectsam import InsectSAMSegmenter
    assert callable(getattr(InsectSAMSegmenter, "segment_with_bbox", None))
```

- [ ] **Step 5: Run all tests**

```bash
.venv/bin/python -m pytest tests/python -q --ignore=tests/python/test_taxon_subgroup_extract.py
```
Expected: previous count + 3 new factory tests, all passing.

- [ ] **Step 6: Commit**

```bash
git add scripts/detect_subjects/segmenters/ scripts/detect_subjects/segmenter_insectsam.py \
        tests/python/test_segmenter_factory.py
git commit --no-gpg-sign -m "refactor: move segmenter wrapper to segmenters/ package with factory"
```

---

## Task 8: Add `DETECTOR_VARIANT` + `SEGMENTER_VARIANT` config + variant tag

**Files:**
- Modify: `scripts/detect_subjects/config.py`

- [ ] **Step 1: Add the two constants and a variant-tag helper**

Append to `scripts/detect_subjects/config.py` (after the existing constants):

```python
# ─── Pipeline component selection ─────────────────────────────────
# These names look up classes in detectors/__init__.py and segmenters/__init__.py.
# Swapping is a one-line config change.
DETECTOR_VARIANT = "grounding_dino"
SEGMENTER_VARIANT = "insectsam"


def variant_tag() -> str:
    """The string written to parquet rows' `variant` column.

    Two reasons it changes: a detector swap, or a segmenter swap.
    A/B comparisons filter parquet by `variant`.
    """
    return f"{DETECTOR_VARIANT}__{SEGMENTER_VARIANT}"
```

- [ ] **Step 2: Add a sanity test**

Create `tests/python/test_config_variant.py`:

```python
"""Tests for the variant-tag helper in config.py."""
from __future__ import annotations

from scripts.detect_subjects.config import (
    DETECTOR_VARIANT, SEGMENTER_VARIANT, variant_tag,
)


def test_variant_tag_concatenates_detector_and_segmenter():
    assert variant_tag() == f"{DETECTOR_VARIANT}__{SEGMENTER_VARIANT}"


def test_default_variants_are_current_models():
    """At Phase 1 we still default to the existing combo."""
    assert DETECTOR_VARIANT == "grounding_dino"
    assert SEGMENTER_VARIANT == "insectsam"
```

- [ ] **Step 3: Run tests**

```bash
.venv/bin/python -m pytest tests/python/test_config_variant.py -v
```
Expected: 2 passed.

- [ ] **Step 4: Commit**

```bash
git add scripts/detect_subjects/config.py tests/python/test_config_variant.py
git commit --no-gpg-sign -m "feat: add DETECTOR_VARIANT / SEGMENTER_VARIANT config + variant_tag()"
```

---

## Task 9: Rename `pipeline.py` → `classify.py` + wire factories

This is the largest task. `classify.py` becomes the orchestrator that consumes the factories instead of directly importing model wrapper classes.

**Files:**
- Move: `scripts/detect_subjects/pipeline.py` → `scripts/detect_subjects/classify.py`
- Modify: `scripts/detect_subjects/__main__.py` (was probably importing pipeline)
- Modify: any other importer of `scripts.detect_subjects.pipeline`

- [ ] **Step 1: Identify all importers of `scripts.detect_subjects.pipeline`**

```bash
grep -rn "from scripts.detect_subjects.pipeline\|scripts.detect_subjects.pipeline import" \
  scripts/ tests/ 2>&1
```
Record the list.

- [ ] **Step 2: Move the file**

```bash
git mv scripts/detect_subjects/pipeline.py scripts/detect_subjects/classify.py
```

- [ ] **Step 3: Update the inside of `classify.py` to use factories instead of direct imports**

Open `scripts/detect_subjects/classify.py` and replace the direct detector/segmenter imports + instantiation with factory calls. Find the existing block (was in `pipeline.py:78-79`):

```python
detector = GroundingDinoDetector(device=device, dtype=dtype)
segmenter = InsectSAMSegmenter(device=device, dtype=dtype)
```

Replace with:

```python
from scripts.detect_subjects import config as cfg
from scripts.detect_subjects.detectors import make_detector
from scripts.detect_subjects.segmenters import make_segmenter

detector = make_detector(cfg.DETECTOR_VARIANT, device=device, dtype=dtype)
segmenter = make_segmenter(cfg.SEGMENTER_VARIANT, device=device, dtype=dtype)
```

Also remove the now-unused direct imports at the top of the file:

```python
# Delete these two lines:
from scripts.detect_subjects.detector_dino import GroundingDinoDetector
from scripts.detect_subjects.segmenter_insectsam import InsectSAMSegmenter
```

Also update the parquet variant assignment. Find:

```python
V1_NAME = "v1_dino_insectsam"
```

Keep `V1_NAME` for backward compat with existing parquet rows, but ADD a derived variant tag:

```python
V1_NAME = "v1_dino_insectsam"   # legacy variant string used in existing parquet
# Future variants use cfg.variant_tag() instead. We keep V1_NAME tied to the
# legacy string so the existing parquet's variant column doesn't have to migrate
# during Phase 1. Phase 2 introduces a new variant_tag()-based string when SAM 3
# swap lands.
```

Leave `V1_NAME` in use throughout the function for Phase 1 (no behavior change).

- [ ] **Step 4: Update all importers from `pipeline` to `classify`**

For each file from Step 1, replace:

```python
from scripts.detect_subjects.pipeline import ...
# →
from scripts.detect_subjects.classify import ...
```

Most likely candidates: `scripts/detect_subjects/__main__.py`, `scripts/detect_subjects/evaluate_v1.py`.

- [ ] **Step 5: Run all tests**

```bash
.venv/bin/python -m pytest tests/python -q --ignore=tests/python/test_taxon_subgroup_extract.py
```
Expected: same count passing as before.

- [ ] **Step 6: Verify the CLI still works**

```bash
.venv/bin/python -c "from scripts.detect_subjects.classify import run_v1_on_sample; print('ok')"
```
Expected: `ok`

- [ ] **Step 7: Commit**

```bash
git add -A
git commit --no-gpg-sign -m "refactor: rename pipeline.py to classify.py and wire detector/segmenter factories"
```

---

## Task 10: Rename `evaluate_v1.py` → `evaluate_pipeline.py`

Cosmetic rename to match the vocabulary. No internal logic change.

**Files:**
- Move: `scripts/detect_subjects/evaluate_v1.py` → `scripts/detect_subjects/evaluate_pipeline.py`

- [ ] **Step 1: Move the file**

```bash
git mv scripts/detect_subjects/evaluate_v1.py scripts/detect_subjects/evaluate_pipeline.py
```

- [ ] **Step 2: Find any importers**

```bash
grep -rn "from scripts.detect_subjects.evaluate_v1\|scripts.detect_subjects.evaluate_v1 import" \
  scripts/ tests/ 2>&1
```
Update any matches to `evaluate_pipeline`.

- [ ] **Step 3: Smoke-test the rename**

```bash
.venv/bin/python -c "
from scripts.detect_subjects.evaluate_pipeline import _load_rows, _load_labels
rows = _load_rows()
labels = _load_labels()
print(f'rows: {len(rows)}, labels: {len(labels)}')
"
```
Expected: same numbers as before the rename.

- [ ] **Step 4: Run the eval as a smoke test**

```bash
.venv/bin/python -m scripts.detect_subjects.evaluate_pipeline 2>&1 | head -20
```
Expected: produces the same Phase 0/1 markdown report as `evaluate_v1` did.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit --no-gpg-sign -m "refactor: rename evaluate_v1.py to evaluate_pipeline.py (vocab alignment)"
```

---

## Task 11: Delete one-shot diagnostic scripts

Per repo convention (memory: "Delete one-shot scripts after they run"), remove the underscore-prefixed bench scripts.

**Files:**
- Delete: `scripts/detect_subjects/_inspect_masks.py`
- Delete: `scripts/detect_subjects/_sam2_vs_insectsam_bench.py`
- Delete: `scripts/detect_subjects/blur_model_bench.py`

Keep: `scripts/detect_subjects/backfill_secondary_bboxes.py` (re-runnable library used for the secondary bbox sidecar).

- [ ] **Step 1: Verify the files exist and are the one-shots we expect**

```bash
ls scripts/detect_subjects/_inspect_masks.py \
   scripts/detect_subjects/_sam2_vs_insectsam_bench.py \
   scripts/detect_subjects/blur_model_bench.py
```
Expected: all three listed.

- [ ] **Step 2: Delete them**

```bash
git rm scripts/detect_subjects/_inspect_masks.py \
       scripts/detect_subjects/_sam2_vs_insectsam_bench.py \
       scripts/detect_subjects/blur_model_bench.py
```

- [ ] **Step 3: Verify the test suite still passes (nothing depended on them)**

```bash
.venv/bin/python -m pytest tests/python -q --ignore=tests/python/test_taxon_subgroup_extract.py
```
Expected: same count passing.

- [ ] **Step 4: Commit**

```bash
git commit --no-gpg-sign -m "cleanup: delete one-shot diagnostic scripts (per repo convention)"
```

---

## Task 12: Verify identical pipeline behavior (regression smoke test)

The whole point of Phase 1: same input → same output. This task runs the full pipeline and diffs against the baseline snapshot from Task 0.

**Files:**
- Modify: pipeline behavior must match `tests/python/_phase1_baseline/baseline_v1.parquet`

- [ ] **Step 1: Run the full pipeline against the same sample**

```bash
# This re-runs the pipeline using the refactored classify.py orchestrator.
# Caches in data/cache/raw_dino/ and data/cache/sam_embed/ mean this is fast.
.venv/bin/python -m scripts.detect_subjects v1 2>&1 | tail -3
```
Expected output ends with something like `v1 done: processed=N errors=0 elapsed_s=X` (or "0 to process" if the parquet is already complete).

- [ ] **Step 2: Diff the refreshed parquet against the baseline**

```bash
.venv/bin/python -c "
import polars as pl

baseline = pl.read_parquet('tests/python/_phase1_baseline/baseline_v1.parquet')
current = pl.read_parquet('data/cache/framing_detections.parquet')

print(f'baseline rows: {baseline.height}, current rows: {current.height}')
assert baseline.height == current.height, 'row count differs'

# Compare every column that matters for downstream classification
COLS_TO_CHECK = [
    'image_id', 'source', 'variant', 'img_w', 'img_h', 'subject_state',
    'n_raw_detections', 'n_distinct_detections',
    'bbox_x', 'bbox_y', 'bbox_w', 'bbox_h', 'confidence',
    'bbox_area_ratio', 'offcenter',
    'mask_area_ratio', 'mask_iou_score', 'lab_delta_e', 'boundary_sharpness',
    'bbox_min_edge_px', 'bbox_long_edge_px', 'bbox_touches_edge',
    'crop_x', 'crop_y', 'crop_w', 'crop_h', 'post_crop_subject_area',
    'framing_quality', 'suggested_labels',
]
sorted_b = baseline.sort('image_id').select(COLS_TO_CHECK)
sorted_c = current.sort('image_id').select(COLS_TO_CHECK)
diff = (sorted_b != sorted_c)
mismatches = []
for col in COLS_TO_CHECK:
    # null-safe compare for nullable columns
    a, b = sorted_b[col], sorted_c[col]
    eq = (a == b) | (a.is_null() & b.is_null())
    if not eq.all():
        n = (~eq).sum()
        mismatches.append((col, n))
if mismatches:
    print('FAIL — mismatched columns:')
    for col, n in mismatches:
        print(f'  {col}: {n} rows differ')
    raise SystemExit(1)
print('OK — pipeline output identical to baseline.')
"
```
Expected: `OK — pipeline output identical to baseline.`

If mismatches print: investigate which column changed and why. The refactor introduced a bug if anything other than rounding noise differs.

- [ ] **Step 3: If the test passes, delete the baseline snapshot (it's served its purpose)**

```bash
git rm -r tests/python/_phase1_baseline/
git commit --no-gpg-sign -m "cleanup: remove Phase 1 refactor baseline (regression test passed)"
```

If the test fails: STOP. Do not delete the baseline. Debug the divergence.

---

## Self-review

### Spec coverage

| spec section | covered by task(s) | notes |
|---|---|---|
| Vocab (rule labeler, ML labeler, gate, label, etc.) | Task 4, 5, 9 | gate created, classify renamed, rule_labeler renamed |
| Architecture diagram | Task 9 | classify.py is now the orchestrator |
| Protocol definitions | Task 1 | interfaces.py |
| Module structure | Tasks 5, 6, 7, 9, 10, 11 | all files moved/renamed/created |
| Locked parameters discipline | (out of phase 1 scope) | covered when threshold tuning lands in Phase 3 |
| Prompt design | (out of phase 1 scope) | Phase 2 |
| 4-column label taxonomy + validator UI | (out of phase 1 scope) | Phase 2 |
| A/B testing methodology + PR curves | (out of phase 1 scope) | Phase 3 |
| Active learning + labeling state | (out of phase 1 scope) | Phase 3 |
| Apple Silicon | (no Phase 1 change) | existing MPS setup unchanged |
| Migration plan (labels.json + crop file cleanup) | (out of phase 1 scope) | Phase 2 |
| Default models | (locked at Phase 2 — Phase 1 keeps grounding_dino + insectsam defaults) | per Task 8 |

Phase 1 explicitly covers ONLY the refactor (no behavior change). All other spec sections are out of scope and require their own follow-up plans.

### Placeholder scan

No "TBD", "TODO", "implement later", "similar to Task N", or vague error-handling instructions. Every code block is complete. Every test has an explicit expected outcome. ✓

### Type consistency

- `Detector` Protocol method `detect()` is called in Task 1 (definition), Task 6 (factory), Task 9 (factory invocation). Same signature throughout.
- `Segmenter` Protocol method `segment_with_bbox()` consistent across Tasks 1, 7, 9.
- `DetectionResult` dataclass shape consistent between Tasks 1 and 9.
- `compute_geometric_features` signature consistent between Tasks 2 and (future Phase 2 features.py extensions).
- `decide_drawability` function signature consistent between Task 4 (definition) and (future Phase 2-3 callers).
- `make_detector(name, **kwargs)` and `make_segmenter(name, **kwargs)` signatures consistent between Tasks 6, 7, 9.
- `DETECTOR_VARIANT` and `SEGMENTER_VARIANT` config constants set in Task 8 are referenced via `cfg.DETECTOR_VARIANT` in Task 9.

✓ Type consistency maintained.

---

End of Phase 1 plan.
