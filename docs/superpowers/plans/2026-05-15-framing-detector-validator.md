# Framing Detector Validator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Phase A smoke benchmark + Phase B Variant-1 (GroundingDINO + InsectSAM) end-to-end run, producing a parquet of detections and an HTML review interface for 400 stratified images.

**Architecture:** A modular Python pipeline under `scripts/detect_subjects/`. Pure-logic modules (schema, classify, crop, metrics, sampling, IoU) are TDD'd. Model wrappers are integration-tested via the Phase A smoke gate. The V1 pipeline orchestrator runs single-threaded for simplicity; threaded I/O + ProcessPoolExecutor for metrics are deferred to the V2-V6 follow-up plan since V1 alone finishes 400 images in <2 min. All inference results stream into one parquet file; the HTML review interface is statically generated from that parquet.

**Tech Stack:**
- Python 3.12 (existing `.venv`)
- PyTorch 2.5+ with MPS, transformers 4.50+, accelerate, F16 throughout
- `IDEA-Research/grounding-dino-base`, `martintomov/InsectSAM`
- `pyarrow` for parquet, `polars` for analysis queries
- `Pillow` + `opencv-python-headless` for image I/O / crops
- `scikit-image` for LAB color space + Sobel filter
- `pytest` + `pytest-mock` for testing pure logic
- (Later phases: `mlx-vlm` for SAM 3.1, additional detectors — out of scope for this plan)

**Out of scope for this plan:** V2-V6 model wrappers (DINO+SAM 2.1, OWLv2+InsectSAM, SAM 3.1, Florence-2, PaliGemma 2). After V1 review, a follow-up plan adds them.

---

## File structure (created by this plan)

```
scripts/detect_subjects/
├── __init__.py
├── __main__.py              # CLI: `python -m scripts.detect_subjects`
├── config.py                # Constants, paths, model IDs, thresholds
├── schema.py                # PyArrow schema + DetectionRow dataclass
├── data.py                  # Manifest loading + stratified sampling
├── caches.py                # Image decode LRU + parquet resume
├── ground_truth.py          # iNat-2017 GT bbox loader + IoU
├── classify.py              # framing_quality decision rules
├── crop.py                  # CropPlanner: bbox → crop bbox + JPEG output
├── metrics.py               # bbox area, offcenter, LAB ΔE, Sobel sharpness
├── detector_dino.py         # GroundingDINO wrapper
├── segmenter_insectsam.py   # InsectSAM wrapper
├── pipeline.py              # Orchestrator: detection → segmentation → metrics
├── build_html.py            # Generate audit/framing-validator/*.html
├── smoke.py                 # Phase A 10-point sanity gate
└── templates/
    └── index.html.j2        # Jinja2 template for review UI

tests/python/
├── __init__.py
├── conftest.py              # pytest fixtures
├── test_schema.py
├── test_data.py
├── test_caches.py
├── test_ground_truth.py
├── test_classify.py
├── test_crop.py
└── test_metrics.py

pytest.ini
scripts/requirements.txt     # MODIFIED — added new deps
.gitignore                   # MODIFIED — exclude data/cache/, audit/framing-validator/
```

---

## Task 1: Install dependencies + scaffold directories

**Files:**
- Modify: `scripts/requirements.txt`
- Modify: `.gitignore`
- Create: `pytest.ini`
- Create: `scripts/detect_subjects/__init__.py`
- Create: `tests/python/__init__.py`
- Create: `tests/python/conftest.py`

- [ ] **Step 1: Update `scripts/requirements.txt`**

Replace the entire file with:

```
# scripts/requirements.txt — server-side venv deps
requests>=2.32
Pillow>=10.4

# framing detector experiment (2026-05-15)
torch>=2.5
torchvision>=0.20
transformers>=4.50
accelerate>=1.0
pyarrow>=18.0
polars>=1.20
opencv-python-headless>=4.10
scikit-image>=0.24
numpy>=2.0
psutil>=5.9
pytest>=8.3
pytest-mock>=3.14
```

- [ ] **Step 2: Install dependencies**

Run:
```bash
.venv/bin/pip install -r scripts/requirements.txt 2>&1 | tail -5
```
Expected: ends with `Successfully installed ...` or `Requirement already satisfied`.

- [ ] **Step 3: Update `.gitignore`**

Append the following lines to the existing `.gitignore`:

```
# Framing detector experiment outputs
data/cache/
audit/framing-validator/
.pytest_cache/
```

- [ ] **Step 4: Create `pytest.ini`**

```ini
[pytest]
testpaths = tests/python
python_files = test_*.py
python_functions = test_*
addopts = -v --tb=short
```

- [ ] **Step 5: Create `scripts/detect_subjects/__init__.py`**

```python
"""Framing detector experiment package.

Phase A: smoke benchmark + 10-point sanity gate.
Phase B: V1 (GroundingDINO + InsectSAM) run on 400 stratified images.

See docs/superpowers/specs/2026-05-15-framing-detector-design.md.
"""
```

- [ ] **Step 6: Create `tests/python/__init__.py` and `tests/python/conftest.py`**

`tests/python/__init__.py`: empty file.

`tests/python/conftest.py`:
```python
"""Shared pytest fixtures for framing detector tests."""
from __future__ import annotations
import numpy as np
import pytest
from PIL import Image


@pytest.fixture
def sample_image_rgb() -> Image.Image:
    """640x480 RGB image with a bright red rectangle on white background."""
    arr = np.full((480, 640, 3), 255, dtype=np.uint8)
    arr[180:300, 240:400] = (220, 30, 30)
    return Image.fromarray(arr, mode="RGB")


@pytest.fixture
def sample_bbox_normalized() -> tuple[float, float, float, float]:
    """Normalized bbox [x, y, w, h] for the red rectangle."""
    return (0.375, 0.375, 0.25, 0.25)


@pytest.fixture
def sample_mask_binary() -> np.ndarray:
    """480x640 boolean mask matching the red rectangle."""
    m = np.zeros((480, 640), dtype=bool)
    m[180:300, 240:400] = True
    return m
```

- [ ] **Step 7: Verify pytest discovers tests**

Run:
```bash
.venv/bin/pytest --collect-only 2>&1 | tail -10
```
Expected: `collected 0 items` (no tests yet) or successful collection without errors.

- [ ] **Step 8: Commit**

```bash
git add scripts/requirements.txt .gitignore pytest.ini scripts/detect_subjects/__init__.py tests/python/__init__.py tests/python/conftest.py
git commit --no-gpg-sign -m "framing: scaffold dirs + install deps for detector experiment"
```

---

## Task 2: Config module

**Files:**
- Create: `scripts/detect_subjects/config.py`

- [ ] **Step 1: Create `scripts/detect_subjects/config.py`**

```python
"""Centralized constants, paths, and model IDs for the framing experiment."""
from __future__ import annotations
from pathlib import Path

# ─── Paths ─────────────────────────────────────────────────────────
ROOT = Path(__file__).resolve().parent.parent.parent
DATA_DIR = ROOT / "data"
IMG_DIR = DATA_DIR / "images"
MANIFEST_DIR = DATA_DIR / "manifest"
CACHE_DIR = DATA_DIR / "cache"

VALIDATOR_DIR = ROOT / "audit" / "framing-validator"
CROPS_DIR = VALIDATOR_DIR / "crops"

for d in (CACHE_DIR, VALIDATOR_DIR, CROPS_DIR):
    d.mkdir(parents=True, exist_ok=True)

PARQUET_PATH = CACHE_DIR / "framing_detections.parquet"
SAMPLE_PARQUET_PATH = CACHE_DIR / "validator_sample.parquet"
LABELS_PARQUET_PATH = CACHE_DIR / "labels.parquet"
TUNED_THRESHOLDS_PATH = CACHE_DIR / "tuned_thresholds.yaml"

# ─── Random seed ───────────────────────────────────────────────────
RANDOM_SEED = 42

# ─── Sample composition (totals to 400) ────────────────────────────
SAMPLE_INAT_RANDOM = 160
SAMPLE_INAT_HARD   = 80
SAMPLE_BUGWOOD     = 80
SAMPLE_SMITHSONIAN = 40
SAMPLE_HARD_TAXA   = 40
SAMPLE_TOTAL       = (
    SAMPLE_INAT_RANDOM + SAMPLE_INAT_HARD + SAMPLE_BUGWOOD
    + SAMPLE_SMITHSONIAN + SAMPLE_HARD_TAXA
)
HARD_TAXA = ["Mantodea", "Phasmatodea", "Lepidoptera_larva", "Orthoptera"]
SAMPLE_PER_HARD_TAXON = SAMPLE_HARD_TAXA // len(HARD_TAXA)  # 10

INAT_HARD_DESC_PATTERN = r"\bhabitat|landscape|wide|field|scenery\b"

# ─── Model IDs ─────────────────────────────────────────────────────
DINO_MODEL_ID = "IDEA-Research/grounding-dino-base"
INSECTSAM_MODEL_ID = "martintomov/InsectSAM"

# ─── Detection prompt for V1 ───────────────────────────────────────
INSECT_PROMPT = (
    "an insect. a butterfly. a beetle. a moth. a bee. a wasp. "
    "a fly. a dragonfly. a damselfly. a grasshopper. a mantis. "
    "a cockroach. a true bug. a caterpillar. a larva."
)

# ─── Detector thresholds ───────────────────────────────────────────
BOX_THRESHOLD = 0.25
TEXT_THRESHOLD = 0.25
NMS_IOU_THRESHOLD = 0.5
HIGH_CONF_THRESHOLD = 0.4

# ─── Classification thresholds (initial — tuned later) ─────────────
CLASSIFY_HIDDEN_CONF       = 0.40
CLASSIFY_HIDDEN_AREA       = 0.02
CLASSIFY_WIDE_AREA         = 0.20
CLASSIFY_TIGHT_AREA        = 0.50
CLASSIFY_CAMOUFLAGED_DELTA = 12.0

# ─── Crop targets ──────────────────────────────────────────────────
CROP_TARGET_AREA_NATURE   = 0.30
CROP_TARGET_AREA_SPECIMEN = 0.60
CROP_SKIP_IF_AREA_ABOVE   = 0.25

# ─── Image processing ──────────────────────────────────────────────
CROP_MEDIUM_MAX_EDGE = 1024
CROP_MEDIUM_QUALITY = 90
CROP_THUMB_MAX_EDGE = 512
CROP_THUMB_QUALITY = 85

# ─── Schema version ────────────────────────────────────────────────
SCHEMA_VERSION = 1

# ─── Concurrency ───────────────────────────────────────────────────
N_LOADER_THREADS = 16
N_METRICS_PROCESSES = 16
DETECT_BATCH_SIZE = 16
SEGMENT_BATCH_SIZE = 8
PARQUET_WRITE_BATCH = 50
```

- [ ] **Step 2: Verify it imports**

Run:
```bash
.venv/bin/python -c "from scripts.detect_subjects.config import SAMPLE_TOTAL; print(f'sample total: {SAMPLE_TOTAL}')"
```
Expected: `sample total: 400`

- [ ] **Step 3: Commit**

```bash
git add scripts/detect_subjects/config.py
git commit --no-gpg-sign -m "framing: config module with paths, model IDs, thresholds"
```

---

## Task 3: Parquet schema + DetectionRow

**Files:**
- Create: `scripts/detect_subjects/schema.py`
- Create: `tests/python/test_schema.py`

- [ ] **Step 1: Write the failing test (`tests/python/test_schema.py`)**

```python
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
        "img_w", "img_h", "subject_type",
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
        img_w=4000, img_h=3000, subject_type="nature",
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
            img_w=4000, img_h=3000, subject_type="nature",
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
```

- [ ] **Step 2: Run test, expect failure**

Run:
```bash
.venv/bin/pytest tests/python/test_schema.py -v 2>&1 | tail -10
```
Expected: `ModuleNotFoundError` for `scripts.detect_subjects.schema`.

- [ ] **Step 3: Create `scripts/detect_subjects/schema.py`**

```python
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
    subject_type: str
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
    crop_x: Optional[float]
    crop_y: Optional[float]
    crop_w: Optional[float]
    crop_h: Optional[float]
    post_crop_subject_area: Optional[float]
    framing_quality: str
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
    ("subject_type", pa.string()),
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
    ("crop_x", pa.float32()),
    ("crop_y", pa.float32()),
    ("crop_w", pa.float32()),
    ("crop_h", pa.float32()),
    ("post_crop_subject_area", pa.float32()),
    ("framing_quality", pa.string()),
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
```

- [ ] **Step 4: Run test, expect pass**

Run:
```bash
.venv/bin/pytest tests/python/test_schema.py -v 2>&1 | tail -10
```
Expected: `3 passed`.

- [ ] **Step 5: Commit**

```bash
git add scripts/detect_subjects/schema.py tests/python/test_schema.py
git commit --no-gpg-sign -m "framing: parquet schema + DetectionRow dataclass (TDD)"
```

---

## Task 4: Classification rules

**Files:**
- Create: `scripts/detect_subjects/classify.py`
- Create: `tests/python/test_classify.py`

- [ ] **Step 1: Write failing tests**

```python
"""Tests for framing_quality classification rules."""
from __future__ import annotations

from scripts.detect_subjects.classify import classify_framing


def _row(**overrides):
    base = dict(
        confidence=0.80,
        bbox_area_ratio=0.30,
        n_distinct_detections=1,
        mask_area_ratio=0.25,
        lab_delta_e=25.0,
    )
    base.update(overrides)
    return base


def test_hidden_when_no_detection():
    assert classify_framing(**_row(confidence=None, bbox_area_ratio=None,
                                   n_distinct_detections=0)) == "hidden"


def test_hidden_when_low_confidence():
    assert classify_framing(**_row(confidence=0.30)) == "hidden"


def test_hidden_when_tiny_bbox():
    assert classify_framing(**_row(bbox_area_ratio=0.01)) == "hidden"


def test_multi_bug_when_two_detections():
    assert classify_framing(**_row(n_distinct_detections=2)) == "multi_bug"


def test_multi_bug_takes_priority_over_wide():
    assert classify_framing(**_row(n_distinct_detections=3,
                                   bbox_area_ratio=0.05)) == "multi_bug"


def test_camouflaged_when_low_delta_e():
    assert classify_framing(**_row(lab_delta_e=8.0)) == "camouflaged"


def test_camouflaged_only_when_mask_present():
    assert classify_framing(**_row(mask_area_ratio=None,
                                   lab_delta_e=8.0)) == "good"


def test_wide_when_small_bbox():
    assert classify_framing(**_row(bbox_area_ratio=0.10)) == "wide"


def test_tight_when_large_bbox():
    assert classify_framing(**_row(bbox_area_ratio=0.65)) == "tight"


def test_good_when_normal():
    assert classify_framing(**_row(bbox_area_ratio=0.30)) == "good"
```

- [ ] **Step 2: Run, expect fail**

Run:
```bash
.venv/bin/pytest tests/python/test_classify.py -v 2>&1 | tail -10
```
Expected: import error.

- [ ] **Step 3: Implement `scripts/detect_subjects/classify.py`**

```python
"""Map detection metrics to a framing_quality category."""
from __future__ import annotations
from typing import Optional

from scripts.detect_subjects.config import (
    CLASSIFY_HIDDEN_CONF,
    CLASSIFY_HIDDEN_AREA,
    CLASSIFY_WIDE_AREA,
    CLASSIFY_TIGHT_AREA,
    CLASSIFY_CAMOUFLAGED_DELTA,
)


def classify_framing(
    confidence: Optional[float],
    bbox_area_ratio: Optional[float],
    n_distinct_detections: int,
    mask_area_ratio: Optional[float],
    lab_delta_e: Optional[float],
) -> str:
    """Returns one of: 'good' | 'tight' | 'wide' | 'hidden' | 'multi_bug' | 'camouflaged'."""
    if confidence is None or bbox_area_ratio is None:
        return "hidden"
    if confidence < CLASSIFY_HIDDEN_CONF or bbox_area_ratio < CLASSIFY_HIDDEN_AREA:
        return "hidden"
    if n_distinct_detections >= 2:
        return "multi_bug"
    if mask_area_ratio is not None and lab_delta_e is not None \
            and lab_delta_e < CLASSIFY_CAMOUFLAGED_DELTA:
        return "camouflaged"
    if bbox_area_ratio < CLASSIFY_WIDE_AREA:
        return "wide"
    if bbox_area_ratio > CLASSIFY_TIGHT_AREA:
        return "tight"
    return "good"
```

- [ ] **Step 4: Run, expect pass**

Run:
```bash
.venv/bin/pytest tests/python/test_classify.py -v 2>&1 | tail -15
```
Expected: `10 passed`.

- [ ] **Step 5: Commit**

```bash
git add scripts/detect_subjects/classify.py tests/python/test_classify.py
git commit --no-gpg-sign -m "framing: classification rules with TDD (10 tests)"
```

---

## Task 5: Geometric metrics (bbox area, offcenter, IoU)

**Files:**
- Create: `scripts/detect_subjects/metrics.py`
- Create: `tests/python/test_metrics.py`

- [ ] **Step 1: Write failing tests**

```python
"""Tests for geometric and mask-based metrics."""
from __future__ import annotations
import math

from scripts.detect_subjects.metrics import (
    bbox_area_ratio_normalized,
    offcenter_normalized,
    iou_xywh_normalized,
)


def test_bbox_area_ratio_quarter():
    assert bbox_area_ratio_normalized(0.25, 0.25) == 0.0625


def test_bbox_area_ratio_full():
    assert bbox_area_ratio_normalized(1.0, 1.0) == 1.0


def test_offcenter_dead_center():
    assert offcenter_normalized(0.25, 0.25, 0.5, 0.5) == 0.0


def test_offcenter_corner():
    result = offcenter_normalized(0.0, 0.0, 0.1, 0.1)
    assert 0.85 < result < 0.95


def test_iou_identical_boxes():
    assert iou_xywh_normalized((0.1, 0.1, 0.2, 0.2), (0.1, 0.1, 0.2, 0.2)) == 1.0


def test_iou_no_overlap():
    assert iou_xywh_normalized((0.0, 0.0, 0.1, 0.1), (0.5, 0.5, 0.1, 0.1)) == 0.0


def test_iou_half_overlap():
    iou = iou_xywh_normalized((0.0, 0.0, 0.2, 0.2), (0.1, 0.0, 0.2, 0.2))
    assert math.isclose(iou, 1/3, rel_tol=1e-5)
```

- [ ] **Step 2: Run, expect fail**

```bash
.venv/bin/pytest tests/python/test_metrics.py -v 2>&1 | tail -10
```
Expected: import error.

- [ ] **Step 3: Implement `scripts/detect_subjects/metrics.py`**

```python
"""Geometric and mask-based metrics on detections."""
from __future__ import annotations
import math


def bbox_area_ratio_normalized(bbox_w: float, bbox_h: float) -> float:
    """Fraction of total image area covered by the bbox."""
    return float(bbox_w * bbox_h)


def offcenter_normalized(bbox_x: float, bbox_y: float,
                         bbox_w: float, bbox_h: float) -> float:
    """Distance from bbox center to image center, normalized by half-diagonal."""
    cx = bbox_x + bbox_w / 2.0
    cy = bbox_y + bbox_h / 2.0
    distance = math.sqrt((cx - 0.5) ** 2 + (cy - 0.5) ** 2)
    half_diagonal = math.sqrt(0.5)
    return float(distance / half_diagonal)


def iou_xywh_normalized(
    a: tuple[float, float, float, float],
    b: tuple[float, float, float, float],
) -> float:
    """IoU of two normalized boxes given as (x, y, w, h)."""
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    ax2, ay2 = ax + aw, ay + ah
    bx2, by2 = bx + bw, by + bh
    ix1, iy1 = max(ax, bx), max(ay, by)
    ix2, iy2 = min(ax2, bx2), min(ay2, by2)
    iw, ih = max(0.0, ix2 - ix1), max(0.0, iy2 - iy1)
    inter = iw * ih
    if inter == 0:
        return 0.0
    union = aw * ah + bw * bh - inter
    return float(inter / union) if union > 0 else 0.0
```

- [ ] **Step 4: Run, expect pass**

```bash
.venv/bin/pytest tests/python/test_metrics.py -v 2>&1 | tail -10
```
Expected: `7 passed`.

- [ ] **Step 5: Commit**

```bash
git add scripts/detect_subjects/metrics.py tests/python/test_metrics.py
git commit --no-gpg-sign -m "framing: geometric metrics (bbox area, offcenter, IoU)"
```

---

## Task 6: Crop planner

**Files:**
- Create: `scripts/detect_subjects/crop.py`
- Create: `tests/python/test_crop.py`

- [ ] **Step 1: Write failing tests**

```python
"""Tests for CropPlanner — computing the proposed crop bbox + previews."""
from __future__ import annotations
import math
from pathlib import Path

import pytest
from PIL import Image

from scripts.detect_subjects.crop import (
    compute_crop_bbox,
    apply_crop_and_save,
    CropDecision,
)


def test_skip_crop_when_bbox_already_large():
    d = compute_crop_bbox(
        bbox_x=0.30, bbox_y=0.30, bbox_w=0.40, bbox_h=0.40,
        subject_type="nature",
    )
    assert d.skip is True
    assert d.skip_reason == "already_well_framed"


def test_skip_crop_when_bbox_tiny():
    d = compute_crop_bbox(
        bbox_x=0.50, bbox_y=0.50, bbox_w=0.05, bbox_h=0.05,
        subject_type="nature",
    )
    assert d.skip is True
    assert d.skip_reason == "subject_too_small"


def test_crop_nature_targets_30pct_subject_area():
    d = compute_crop_bbox(
        bbox_x=0.30, bbox_y=0.30, bbox_w=0.20, bbox_h=0.50,
        subject_type="nature",
    )
    assert d.skip is False
    bbox_area = 0.20 * 0.50
    crop_area = d.crop_w * d.crop_h
    assert math.isclose(bbox_area / crop_area, 0.30, rel_tol=0.05)


def test_crop_specimen_targets_60pct_subject_area():
    d = compute_crop_bbox(
        bbox_x=0.30, bbox_y=0.30, bbox_w=0.20, bbox_h=0.20,
        subject_type="specimen",
    )
    assert d.skip is False
    bbox_area = 0.20 * 0.20
    crop_area = d.crop_w * d.crop_h
    assert math.isclose(bbox_area / crop_area, 0.60, rel_tol=0.05)


def test_crop_clamps_to_image_bounds():
    d = compute_crop_bbox(
        bbox_x=0.02, bbox_y=0.02, bbox_w=0.10, bbox_h=0.10,
        subject_type="nature",
    )
    assert d.crop_x >= 0.0
    assert d.crop_y >= 0.0
    assert d.crop_x + d.crop_w <= 1.0
    assert d.crop_y + d.crop_h <= 1.0


def test_apply_crop_writes_jpeg(sample_image_rgb, tmp_path):
    out_path = tmp_path / "crop.jpg"
    apply_crop_and_save(
        image=sample_image_rgb,
        crop_xywh_normalized=(0.25, 0.25, 0.5, 0.5),
        out_path=out_path,
        max_edge=200,
        quality=80,
    )
    assert out_path.exists()
    cropped = Image.open(out_path)
    assert max(cropped.size) <= 200
```

- [ ] **Step 2: Run, expect fail**

```bash
.venv/bin/pytest tests/python/test_crop.py -v 2>&1 | tail -10
```
Expected: import error.

- [ ] **Step 3: Implement `scripts/detect_subjects/crop.py`**

```python
"""CropPlanner — compute proposed crop bbox + render preview JPEGs."""
from __future__ import annotations
import math
from dataclasses import dataclass
from pathlib import Path

from PIL import Image

from scripts.detect_subjects.config import (
    CROP_SKIP_IF_AREA_ABOVE,
    CROP_TARGET_AREA_NATURE,
    CROP_TARGET_AREA_SPECIMEN,
    CROP_MEDIUM_MAX_EDGE,
    CROP_MEDIUM_QUALITY,
    CROP_THUMB_MAX_EDGE,
    CROP_THUMB_QUALITY,
    CLASSIFY_HIDDEN_AREA,
)


@dataclass(slots=True)
class CropDecision:
    skip: bool
    skip_reason: str | None
    crop_x: float
    crop_y: float
    crop_w: float
    crop_h: float
    post_crop_subject_area: float


def _target_area_for(subject_type: str) -> float:
    if subject_type == "specimen":
        return CROP_TARGET_AREA_SPECIMEN
    return CROP_TARGET_AREA_NATURE


def compute_crop_bbox(
    bbox_x: float, bbox_y: float, bbox_w: float, bbox_h: float,
    subject_type: str,
) -> CropDecision:
    """Compute crop bbox so the subject fills `target` fraction of the crop."""
    bbox_area = bbox_w * bbox_h

    if bbox_area >= CROP_SKIP_IF_AREA_ABOVE:
        return CropDecision(
            skip=True, skip_reason="already_well_framed",
            crop_x=0.0, crop_y=0.0, crop_w=1.0, crop_h=1.0,
            post_crop_subject_area=bbox_area,
        )
    if bbox_area < CLASSIFY_HIDDEN_AREA:
        return CropDecision(
            skip=True, skip_reason="subject_too_small",
            crop_x=0.0, crop_y=0.0, crop_w=1.0, crop_h=1.0,
            post_crop_subject_area=bbox_area,
        )

    target = _target_area_for(subject_type)
    pad = math.sqrt(1.0 / target)
    crop_w = min(1.0, bbox_w * pad)
    crop_h = min(1.0, bbox_h * pad)
    bbox_cx = bbox_x + bbox_w / 2.0
    bbox_cy = bbox_y + bbox_h / 2.0
    crop_x = max(0.0, min(1.0 - crop_w, bbox_cx - crop_w / 2.0))
    crop_y = max(0.0, min(1.0 - crop_h, bbox_cy - crop_h / 2.0))

    post_subject_area = bbox_area / (crop_w * crop_h) if crop_w * crop_h > 0 else 0.0

    return CropDecision(
        skip=False, skip_reason=None,
        crop_x=crop_x, crop_y=crop_y, crop_w=crop_w, crop_h=crop_h,
        post_crop_subject_area=post_subject_area,
    )


def apply_crop_and_save(
    image: Image.Image,
    crop_xywh_normalized: tuple[float, float, float, float],
    out_path: Path,
    max_edge: int,
    quality: int,
) -> None:
    """Crop a full-res PIL image by normalized bbox, resize, save JPEG."""
    cx, cy, cw, ch = crop_xywh_normalized
    W, H = image.size
    left = int(round(cx * W))
    top = int(round(cy * H))
    right = int(round((cx + cw) * W))
    bottom = int(round((cy + ch) * H))
    cropped = image.crop((left, top, right, bottom))
    if max(cropped.size) > max_edge:
        cropped.thumbnail((max_edge, max_edge), Image.Resampling.LANCZOS)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    cropped.save(out_path, format="JPEG", quality=quality, optimize=True)


def save_medium_and_thumb(
    image: Image.Image,
    crop_xywh_normalized: tuple[float, float, float, float],
    medium_path: Path,
    thumb_path: Path,
) -> None:
    """Convenience: save both 1024px medium and 512px thumb variants."""
    apply_crop_and_save(image, crop_xywh_normalized, medium_path,
                        max_edge=CROP_MEDIUM_MAX_EDGE, quality=CROP_MEDIUM_QUALITY)
    apply_crop_and_save(image, crop_xywh_normalized, thumb_path,
                        max_edge=CROP_THUMB_MAX_EDGE, quality=CROP_THUMB_QUALITY)
```

- [ ] **Step 4: Run, expect pass**

```bash
.venv/bin/pytest tests/python/test_crop.py -v 2>&1 | tail -10
```
Expected: `6 passed`.

- [ ] **Step 5: Commit**

```bash
git add scripts/detect_subjects/crop.py tests/python/test_crop.py
git commit --no-gpg-sign -m "framing: CropPlanner (compute + apply, padding rules)"
```

---

## Task 7: Stratified sample selection

**Files:**
- Create: `scripts/detect_subjects/data.py`
- Create: `tests/python/test_data.py`

- [ ] **Step 1: Write failing tests**

```python
"""Tests for manifest loading + stratified sample selection."""
from __future__ import annotations
import csv

import pytest

from scripts.detect_subjects.data import (
    load_manifest_rows,
    pick_stratified_sample,
)


@pytest.fixture
def fake_manifests(tmp_path):
    manifest_dir = tmp_path / "manifest"
    manifest_dir.mkdir()
    cols = ["image_id", "source", "taxon_order", "subject_type",
            "description", "width", "height", "filename"]

    def write(source: str, rows: list[dict]):
        path = manifest_dir / f"{source}.csv"
        with path.open("w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=cols)
            w.writeheader()
            for r in rows:
                w.writerow({c: r.get(c, "") for c in cols})

    write("inaturalist", [
        {"image_id": f"inat-{i}", "source": "inaturalist",
         "taxon_order": "Coleoptera" if i % 2 == 0 else "Mantodea",
         "subject_type": "nature",
         "description": "habitat" if i < 30 else "adult on leaf",
         "width": "4000", "height": "3000",
         "filename": f"images/inat-{i}.jpg"}
        for i in range(500)
    ])
    write("bugwood", [
        {"image_id": f"bw-{i}", "source": "bugwood",
         "taxon_order": "Lepidoptera",
         "subject_type": "nature",
         "description": "adult",
         "width": "2000", "height": "1500",
         "filename": f"images/bw-{i}.jpg"}
        for i in range(200)
    ])
    write("smithsonian", [
        {"image_id": f"sm-{i}", "source": "smithsonian",
         "taxon_order": "Coleoptera",
         "subject_type": "specimen",
         "description": "specimen",
         "width": "2000", "height": "1500",
         "filename": f"images/sm-{i}.jpg"}
        for i in range(60)
    ])
    return manifest_dir


def test_load_manifest_rows_returns_all(fake_manifests):
    rows = load_manifest_rows(manifest_dir=fake_manifests)
    assert len(rows) == 760


def test_pick_stratified_sample_correct_counts(fake_manifests):
    rows = load_manifest_rows(manifest_dir=fake_manifests)
    sample = pick_stratified_sample(rows, seed=42)
    by_source = {}
    for r in sample:
        by_source.setdefault(r["source"], 0)
        by_source[r["source"]] += 1
    assert by_source.get("bugwood", 0) == 80
    assert by_source.get("smithsonian", 0) == 40
    assert by_source.get("inaturalist", 0) == 240


def test_pick_stratified_sample_deterministic(fake_manifests):
    rows = load_manifest_rows(manifest_dir=fake_manifests)
    sample_a = pick_stratified_sample(rows, seed=42)
    sample_b = pick_stratified_sample(rows, seed=42)
    ids_a = [r["image_id"] for r in sample_a]
    ids_b = [r["image_id"] for r in sample_b]
    assert ids_a == ids_b


def test_pick_stratified_sample_includes_hard_taxa(fake_manifests):
    rows = load_manifest_rows(manifest_dir=fake_manifests)
    sample = pick_stratified_sample(rows, seed=42)
    orders = {r.get("taxon_order", "") for r in sample}
    assert "Mantodea" in orders
```

- [ ] **Step 2: Run, expect fail**

```bash
.venv/bin/pytest tests/python/test_data.py -v 2>&1 | tail -10
```
Expected: import error.

- [ ] **Step 3: Implement `scripts/detect_subjects/data.py`**

```python
"""Manifest loading + stratified sample selection for the validator."""
from __future__ import annotations
import csv
import random
import re
from pathlib import Path

from scripts.detect_subjects.config import (
    HARD_TAXA,
    INAT_HARD_DESC_PATTERN,
    MANIFEST_DIR,
    SAMPLE_BUGWOOD,
    SAMPLE_INAT_HARD,
    SAMPLE_INAT_RANDOM,
    SAMPLE_PER_HARD_TAXON,
    SAMPLE_SMITHSONIAN,
)


MANIFEST_SOURCES = ["inaturalist", "bugwood", "smithsonian", "usda_ars"]


def load_manifest_rows(manifest_dir: Path = MANIFEST_DIR) -> list[dict]:
    """Read every per-source manifest CSV and return a flat list of row dicts."""
    rows: list[dict] = []
    for source in MANIFEST_SOURCES:
        path = manifest_dir / f"{source}.csv"
        if not path.exists():
            continue
        with path.open("r", newline="") as f:
            reader = csv.DictReader(f)
            rows.extend(reader)
    return rows


def _filter_inat(rows: list[dict]) -> list[dict]:
    return [r for r in rows if r.get("source") == "inaturalist"]


def _filter_inat_hard(inat_rows: list[dict]) -> list[dict]:
    pat = re.compile(INAT_HARD_DESC_PATTERN, re.I)
    out = []
    for r in inat_rows:
        if pat.search(r.get("description", "")):
            out.append(r)
            continue
        try:
            w = float(r.get("width") or 0)
            h = float(r.get("height") or 0)
            if w > 0 and h > 0:
                aspect = max(w / h, h / w)
                if aspect > 2.0:
                    out.append(r)
        except ValueError:
            pass
    return out


def _filter_by_source(rows: list[dict], source: str) -> list[dict]:
    return [r for r in rows if r.get("source") == source]


def _filter_by_taxon(rows: list[dict], taxon: str) -> list[dict]:
    return [r for r in rows if r.get("taxon_order") == taxon]


def pick_stratified_sample(all_rows: list[dict], seed: int = 42) -> list[dict]:
    """Pick a stratified validator sample.

    Composition:
      - SAMPLE_INAT_HARD iNat hard (description/aspect heuristic; best-effort)
      - SAMPLE_INAT_RANDOM iNat random (drawn after hard is excluded; pads any shortfall)
      - SAMPLE_BUGWOOD bugwood random
      - SAMPLE_SMITHSONIAN smithsonian random
      - SAMPLE_PER_HARD_TAXON from each of HARD_TAXA (10 × 4 = 40)
    """
    rng = random.Random(seed)
    picked: list[dict] = []
    used_ids: set[str] = set()

    def take(pool: list[dict], k: int) -> list[dict]:
        pool = [r for r in pool if r["image_id"] not in used_ids]
        rng.shuffle(pool)
        chosen = pool[:k]
        for r in chosen:
            used_ids.add(r["image_id"])
        return chosen

    inat = _filter_inat(all_rows)
    inat_hard_pool = _filter_inat_hard(inat)
    picked.extend(take(inat_hard_pool, SAMPLE_INAT_HARD))

    inat_random_needed = SAMPLE_INAT_RANDOM + (
        SAMPLE_INAT_HARD - len([r for r in picked if r["source"] == "inaturalist"])
    )
    picked.extend(take(inat, inat_random_needed))

    picked.extend(take(_filter_by_source(all_rows, "bugwood"), SAMPLE_BUGWOOD))
    picked.extend(take(_filter_by_source(all_rows, "smithsonian"), SAMPLE_SMITHSONIAN))

    for taxon in HARD_TAXA:
        picked.extend(take(_filter_by_taxon(all_rows, taxon), SAMPLE_PER_HARD_TAXON))

    return picked
```

- [ ] **Step 4: Run, expect pass**

```bash
.venv/bin/pytest tests/python/test_data.py -v 2>&1 | tail -15
```
Expected: `4 passed`.

- [ ] **Step 5: Commit**

```bash
git add scripts/detect_subjects/data.py tests/python/test_data.py
git commit --no-gpg-sign -m "framing: stratified sample selection (deterministic + best-effort)"
```

---

## Task 8: Parquet resume + image LRU cache

**Files:**
- Create: `scripts/detect_subjects/caches.py`
- Create: `tests/python/test_caches.py`

- [ ] **Step 1: Write failing tests**

```python
"""Tests for image LRU cache + parquet resume logic."""
from __future__ import annotations

import pyarrow as pa
import pyarrow.parquet as pq

from scripts.detect_subjects.caches import (
    ImageDecodeCache,
    load_completed_pairs,
)
from scripts.detect_subjects.schema import SCHEMA


def test_image_cache_stores_and_evicts():
    cache = ImageDecodeCache(max_items=2)
    cache.put("a", "decoded-a")
    cache.put("b", "decoded-b")
    cache.put("c", "decoded-c")  # evicts "a"
    assert cache.get("a") is None
    assert cache.get("b") == "decoded-b"
    assert cache.get("c") == "decoded-c"


def test_image_cache_lru_recent_access_keeps_alive():
    cache = ImageDecodeCache(max_items=2)
    cache.put("a", "A")
    cache.put("b", "B")
    _ = cache.get("a")
    cache.put("c", "C")
    assert cache.get("a") == "A"
    assert cache.get("b") is None
    assert cache.get("c") == "C"


def test_load_completed_pairs_empty_when_no_parquet(tmp_path):
    assert load_completed_pairs(tmp_path / "nope.parquet") == set()


def test_load_completed_pairs_reads_existing_rows(tmp_path):
    parquet_path = tmp_path / "test.parquet"
    null_fields = {c: None for c in SCHEMA.names
                   if c not in {"image_id", "variant", "framing_quality",
                                "detector_model", "source", "img_w", "img_h",
                                "subject_type", "n_raw_detections",
                                "n_distinct_detections", "processed_at",
                                "schema_version"}}
    base = {
        **null_fields,
        "framing_quality": "good",
        "detector_model": "m",
        "source": "inaturalist",
        "img_w": 100, "img_h": 100,
        "subject_type": "nature",
        "n_raw_detections": 0, "n_distinct_detections": 0,
        "processed_at": 1747278900_000,
        "schema_version": 1,
    }
    records = [
        {**base, "image_id": "a", "variant": "v1"},
        {**base, "image_id": "b", "variant": "v1"},
    ]
    table = pa.Table.from_pylist(records, schema=SCHEMA)
    pq.write_table(table, parquet_path)
    pairs = load_completed_pairs(parquet_path)
    assert pairs == {("a", "v1"), ("b", "v1")}
```

- [ ] **Step 2: Run, expect fail**

```bash
.venv/bin/pytest tests/python/test_caches.py -v 2>&1 | tail -10
```
Expected: import error.

- [ ] **Step 3: Implement `scripts/detect_subjects/caches.py`**

```python
"""LRU image decode cache + parquet resume helpers."""
from __future__ import annotations
from collections import OrderedDict
from pathlib import Path
from typing import Any, Optional

import pyarrow.parquet as pq


class ImageDecodeCache:
    """A simple, thread-unsafe LRU cache for decoded image tensors."""

    def __init__(self, max_items: int = 32) -> None:
        self._max = max_items
        self._cache: OrderedDict[str, Any] = OrderedDict()

    def get(self, key: str) -> Optional[Any]:
        if key not in self._cache:
            return None
        self._cache.move_to_end(key)
        return self._cache[key]

    def put(self, key: str, value: Any) -> None:
        if key in self._cache:
            self._cache.move_to_end(key)
            self._cache[key] = value
            return
        self._cache[key] = value
        if len(self._cache) > self._max:
            self._cache.popitem(last=False)

    def __len__(self) -> int:
        return len(self._cache)


def load_completed_pairs(parquet_path: Path) -> set[tuple[str, str]]:
    """Return the set of (image_id, variant) pairs already in the parquet file."""
    if not Path(parquet_path).exists():
        return set()
    table = pq.read_table(parquet_path, columns=["image_id", "variant"])
    ids = table.column("image_id").to_pylist()
    variants = table.column("variant").to_pylist()
    return set(zip(ids, variants))
```

- [ ] **Step 4: Run, expect pass**

```bash
.venv/bin/pytest tests/python/test_caches.py -v 2>&1 | tail -10
```
Expected: `4 passed`.

- [ ] **Step 5: Commit**

```bash
git add scripts/detect_subjects/caches.py tests/python/test_caches.py
git commit --no-gpg-sign -m "framing: image LRU cache + parquet resume helper"
```

---

## Task 9: iNat-2017 ground truth lookup

**Files:**
- Create: `scripts/detect_subjects/ground_truth.py`
- Create: `tests/python/test_ground_truth.py`

- [ ] **Step 1: Write failing tests**

```python
"""Tests for iNat-2017 ground truth bbox lookup."""
from __future__ import annotations
import json

from scripts.detect_subjects.ground_truth import (
    GroundTruthIndex,
    lookup_gt_bbox,
)


def test_gt_index_returns_none_when_missing():
    idx = GroundTruthIndex(annotations_by_source_id={})
    assert idx.lookup("inat-12345") is None


def test_gt_index_returns_bbox_when_present():
    idx = GroundTruthIndex(annotations_by_source_id={
        "12345": (0.25, 0.30, 0.20, 0.25),
    })
    assert idx.lookup("inat-12345") == (0.25, 0.30, 0.20, 0.25)


def test_gt_index_ignores_non_inat_sources():
    idx = GroundTruthIndex(annotations_by_source_id={
        "12345": (0.1, 0.1, 0.1, 0.1),
    })
    assert idx.lookup("bw-12345") is None


def test_gt_index_from_json_file(tmp_path):
    data = {
        "images": [{"id": 12345, "width": 4000, "height": 3000}],
        "annotations": [{"image_id": 12345, "bbox": [1000, 750, 800, 600]}],
    }
    p = tmp_path / "inat2017.json"
    p.write_text(json.dumps(data))
    idx = GroundTruthIndex.from_inat2017_json(p)
    bbox = idx.lookup("inat-12345")
    assert bbox is not None
    x, y, w, h = bbox
    assert abs(x - 0.25) < 1e-5
    assert abs(y - 0.25) < 1e-5
    assert abs(w - 0.20) < 1e-5
    assert abs(h - 0.20) < 1e-5


def test_lookup_gt_bbox_with_no_index_returns_none():
    assert lookup_gt_bbox(None, "inat-12345") is None
```

- [ ] **Step 2: Run, expect fail**

```bash
.venv/bin/pytest tests/python/test_ground_truth.py -v 2>&1 | tail -10
```
Expected: import error.

- [ ] **Step 3: Implement `scripts/detect_subjects/ground_truth.py`**

```python
"""iNat-2017 ground truth bbox lookup.

The iNat-2017 challenge release includes per-image bounding boxes in COCO
format (pixel coords). We normalize to [0,1] and index by source_id so we
can match against our manifest's source_id column.

If the annotations JSON isn't on disk, this module's lookup methods always
return None. That's the graceful default — gt_iou stays null in the parquet.
"""
from __future__ import annotations
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional


@dataclass
class GroundTruthIndex:
    """In-memory index: source_id (string) -> normalized (x, y, w, h)."""
    annotations_by_source_id: dict[str, tuple[float, float, float, float]] = field(
        default_factory=dict)

    def lookup(self, image_id: str) -> Optional[tuple[float, float, float, float]]:
        if not image_id.startswith("inat-"):
            return None
        source_id = image_id[len("inat-"):]
        return self.annotations_by_source_id.get(source_id)

    @classmethod
    def from_inat2017_json(cls, path: Path) -> "GroundTruthIndex":
        with Path(path).open("r") as f:
            data = json.load(f)
        sizes: dict[int, tuple[int, int]] = {}
        for img in data.get("images", []):
            sizes[int(img["id"])] = (int(img["width"]), int(img["height"]))
        normalized: dict[str, tuple[float, float, float, float]] = {}
        for ann in data.get("annotations", []):
            iid = int(ann["image_id"])
            if iid not in sizes:
                continue
            W, H = sizes[iid]
            if W == 0 or H == 0:
                continue
            x, y, w, h = ann["bbox"]
            normalized[str(iid)] = (x / W, y / H, w / W, h / H)
        return cls(annotations_by_source_id=normalized)


def lookup_gt_bbox(
    index: Optional[GroundTruthIndex],
    image_id: str,
) -> Optional[tuple[float, float, float, float]]:
    if index is None:
        return None
    return index.lookup(image_id)
```

- [ ] **Step 4: Run, expect pass**

```bash
.venv/bin/pytest tests/python/test_ground_truth.py -v 2>&1 | tail -10
```
Expected: `5 passed`.

- [ ] **Step 5: Commit**

```bash
git add scripts/detect_subjects/ground_truth.py tests/python/test_ground_truth.py
git commit --no-gpg-sign -m "framing: iNat-2017 ground truth bbox lookup (optional)"
```

---

## Task 10: Mask-derived metrics (LAB ΔE, boundary sharpness)

**Files:**
- Modify: `scripts/detect_subjects/metrics.py`
- Modify: `tests/python/test_metrics.py`

- [ ] **Step 1: Append failing tests to `tests/python/test_metrics.py`**

Append at the end of the file:

```python


# ─── Mask-based metrics (Task 10) ─────────────────────────────────

import numpy as np

from scripts.detect_subjects.metrics import (
    lab_delta_e_mask_vs_background,
    boundary_sharpness,
)


def test_lab_delta_e_high_for_red_on_white(sample_image_rgb, sample_mask_binary):
    rgb = np.array(sample_image_rgb)
    delta_e = lab_delta_e_mask_vs_background(rgb, sample_mask_binary)
    assert delta_e > 30.0


def test_lab_delta_e_low_for_camouflage():
    rgb = np.full((100, 100, 3), 128, dtype=np.uint8)
    mask = np.zeros((100, 100), dtype=bool)
    mask[30:70, 30:70] = True
    delta_e = lab_delta_e_mask_vs_background(rgb, mask)
    assert delta_e < 5.0


def test_lab_delta_e_returns_zero_when_no_mask():
    rgb = np.full((100, 100, 3), 128, dtype=np.uint8)
    mask = np.zeros((100, 100), dtype=bool)
    delta_e = lab_delta_e_mask_vs_background(rgb, mask)
    assert delta_e == 0.0


def test_boundary_sharpness_high_for_hard_edge():
    rgb = np.full((100, 100, 3), 255, dtype=np.uint8)
    rgb[30:70, 30:70] = (220, 30, 30)
    mask = np.zeros((100, 100), dtype=bool)
    mask[30:70, 30:70] = True
    s = boundary_sharpness(rgb, mask)
    assert s > 10.0


def test_boundary_sharpness_low_for_blurred_edge():
    rgb = np.zeros((100, 100, 3), dtype=np.uint8)
    for i in range(100):
        rgb[i, :, :] = i * 2
    mask = np.zeros((100, 100), dtype=bool)
    mask[40:60, 40:60] = True
    s = boundary_sharpness(rgb, mask)
    assert s < 30.0
```

- [ ] **Step 2: Run, expect fail**

```bash
.venv/bin/pytest tests/python/test_metrics.py -v 2>&1 | tail -10
```
Expected: ImportError or AttributeError on the new functions.

- [ ] **Step 3: Append to `scripts/detect_subjects/metrics.py`**

Append at the end of the file:

```python


# ─── Mask-based metrics (Task 10) ─────────────────────────────────
import numpy as np
from skimage.color import rgb2lab
from skimage.filters import sobel
from skimage.segmentation import find_boundaries


def lab_delta_e_mask_vs_background(rgb: np.ndarray, mask: np.ndarray) -> float:
    """Mean LAB ΔE between pixels inside the mask vs outside."""
    if rgb.dtype != np.uint8:
        rgb = rgb.astype(np.uint8)
    inside = mask
    outside = ~mask
    if not inside.any() or not outside.any():
        return 0.0
    lab = rgb2lab(rgb / 255.0)
    mean_in = lab[inside].mean(axis=0)
    mean_out = lab[outside].mean(axis=0)
    return float(np.linalg.norm(mean_in - mean_out))


def boundary_sharpness(rgb: np.ndarray, mask: np.ndarray) -> float:
    """Mean Sobel gradient magnitude along the mask boundary.

    Higher = crisper subject silhouette. Lower = blurry/blended.
    """
    if not mask.any():
        return 0.0
    gray = (0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2])
    gray = gray.astype(np.float32) / 255.0
    grad = sobel(gray)
    boundary = find_boundaries(mask, mode="outer")
    if not boundary.any():
        return 0.0
    return float(grad[boundary].mean() * 100.0)
```

- [ ] **Step 4: Run, expect pass**

```bash
.venv/bin/pytest tests/python/test_metrics.py -v 2>&1 | tail -15
```
Expected: all metric tests pass (5 new + 7 original = 12 total).

- [ ] **Step 5: Commit**

```bash
git add scripts/detect_subjects/metrics.py tests/python/test_metrics.py
git commit --no-gpg-sign -m "framing: LAB ΔE + Sobel boundary sharpness mask metrics"
```

---

## Task 11: GroundingDINO detector wrapper

**Files:**
- Create: `scripts/detect_subjects/detector_dino.py`

This wrapper has no unit tests — model behavior is verified in Phase A.

- [ ] **Step 1: Create `scripts/detect_subjects/detector_dino.py`**

```python
"""GroundingDINO wrapper for the framing experiment.

Loads `IDEA-Research/grounding-dino-base` at F16 onto MPS.
Detects insects via a multi-class text prompt, returns top NMS-deduplicated
bbox plus the count of distinct detections above the conf floor.

Reference: https://huggingface.co/docs/transformers/en/model_doc/grounding-dino
"""
from __future__ import annotations
import time
from dataclasses import dataclass
from typing import Optional

import torch
from PIL import Image
from transformers import AutoModelForZeroShotObjectDetection, AutoProcessor

from scripts.detect_subjects.config import (
    BOX_THRESHOLD,
    DINO_MODEL_ID,
    INSECT_PROMPT,
    NMS_IOU_THRESHOLD,
    TEXT_THRESHOLD,
    HIGH_CONF_THRESHOLD,
)
from scripts.detect_subjects.metrics import iou_xywh_normalized


@dataclass(slots=True)
class DetectionResult:
    bbox_xywh_normalized: Optional[tuple[float, float, float, float]]
    confidence: Optional[float]
    n_raw_detections: int
    n_distinct_detections: int
    detection_ms: int


class GroundingDinoDetector:
    def __init__(self, device: str = "mps", dtype: torch.dtype = torch.float16) -> None:
        self.device = device
        self.dtype = dtype
        self.processor = AutoProcessor.from_pretrained(DINO_MODEL_ID)
        self.model = AutoModelForZeroShotObjectDetection.from_pretrained(
            DINO_MODEL_ID
        ).to(device=self.device, dtype=self.dtype)
        self.model.eval()
        self.prompt = INSECT_PROMPT

    @torch.no_grad()
    def detect(self, image: Image.Image) -> DetectionResult:
        start = time.perf_counter()
        text_labels = [[self.prompt]]
        inputs = self.processor(
            images=image, text=text_labels, return_tensors="pt"
        ).to(self.device)
        if "pixel_values" in inputs:
            inputs["pixel_values"] = inputs["pixel_values"].to(self.dtype)

        outputs = self.model(**inputs)

        results = self.processor.post_process_grounded_object_detection(
            outputs,
            threshold=BOX_THRESHOLD,
            text_threshold=TEXT_THRESHOLD,
            target_sizes=[(image.height, image.width)],
        )[0]

        elapsed_ms = int((time.perf_counter() - start) * 1000)
        boxes = results["boxes"].cpu().tolist()
        scores = results["scores"].cpu().tolist()
        n_raw = len(boxes)

        if not boxes:
            return DetectionResult(
                bbox_xywh_normalized=None, confidence=None,
                n_raw_detections=0, n_distinct_detections=0,
                detection_ms=elapsed_ms,
            )

        normalized = []
        for (x1, y1, x2, y2), score in zip(boxes, scores):
            normalized.append((
                x1 / image.width,
                y1 / image.height,
                (x2 - x1) / image.width,
                (y2 - y1) / image.height,
                float(score),
            ))

        normalized.sort(key=lambda r: r[4], reverse=True)
        kept: list[tuple[float, float, float, float, float]] = []
        for cand in normalized:
            cx, cy, cw, ch, cs = cand
            if any(
                iou_xywh_normalized((cx, cy, cw, ch), (k[0], k[1], k[2], k[3]))
                > NMS_IOU_THRESHOLD
                for k in kept
            ):
                continue
            kept.append(cand)

        top = kept[0]
        n_distinct = sum(1 for k in kept if k[4] >= HIGH_CONF_THRESHOLD)
        return DetectionResult(
            bbox_xywh_normalized=(top[0], top[1], top[2], top[3]),
            confidence=top[4],
            n_raw_detections=n_raw,
            n_distinct_detections=n_distinct,
            detection_ms=elapsed_ms,
        )
```

- [ ] **Step 2: Verify imports**

```bash
.venv/bin/python -c "from scripts.detect_subjects.detector_dino import GroundingDinoDetector, DetectionResult; print('ok')"
```
Expected: `ok`.

- [ ] **Step 3: Commit**

```bash
git add scripts/detect_subjects/detector_dino.py
git commit --no-gpg-sign -m "framing: GroundingDINO detector wrapper (F16 on MPS)"
```

---

## Task 12: InsectSAM segmenter wrapper

**Files:**
- Create: `scripts/detect_subjects/segmenter_insectsam.py`

- [ ] **Step 1: Create `scripts/detect_subjects/segmenter_insectsam.py`**

```python
"""InsectSAM segmenter wrapper — SAM fine-tuned on insect imagery.

Caches the image embedding per (model, image_id) so that re-prompting the
same image with a different bbox is cheap.

Reference: https://huggingface.co/martintomov/InsectSAM
"""
from __future__ import annotations
import time
from dataclasses import dataclass
from typing import Optional

import numpy as np
import torch
from PIL import Image
from transformers import SamModel, SamProcessor

from scripts.detect_subjects.config import INSECTSAM_MODEL_ID


@dataclass(slots=True)
class SegmentationResult:
    mask: Optional[np.ndarray]
    iou_score: Optional[float]
    segmentation_ms: int


class InsectSAMSegmenter:
    def __init__(self, device: str = "mps", dtype: torch.dtype = torch.float16) -> None:
        self.device = device
        self.dtype = dtype
        self.processor = SamProcessor.from_pretrained(INSECTSAM_MODEL_ID)
        self.model = SamModel.from_pretrained(
            INSECTSAM_MODEL_ID
        ).to(device=self.device, dtype=self.dtype)
        self.model.eval()
        self._embedding_cache: dict[str, torch.Tensor] = {}

    @torch.no_grad()
    def _get_image_embedding(self, image_id: str, image: Image.Image) -> torch.Tensor:
        if image_id in self._embedding_cache:
            return self._embedding_cache[image_id]
        inputs = self.processor(images=image, return_tensors="pt").to(self.device)
        if "pixel_values" in inputs:
            inputs["pixel_values"] = inputs["pixel_values"].to(self.dtype)
        embed = self.model.get_image_embeddings(inputs["pixel_values"])
        self._embedding_cache[image_id] = embed
        return embed

    def clear_cache(self) -> None:
        self._embedding_cache.clear()

    @torch.no_grad()
    def segment_with_bbox(
        self,
        image_id: str,
        image: Image.Image,
        bbox_xywh_normalized: tuple[float, float, float, float],
    ) -> SegmentationResult:
        start = time.perf_counter()
        x, y, w, h = bbox_xywh_normalized
        x1 = x * image.width
        y1 = y * image.height
        x2 = (x + w) * image.width
        y2 = (y + h) * image.height
        input_boxes = [[[x1, y1, x2, y2]]]

        inputs = self.processor(
            images=image, input_boxes=input_boxes, return_tensors="pt"
        ).to(self.device)
        if "pixel_values" in inputs:
            inputs["pixel_values"] = inputs["pixel_values"].to(self.dtype)

        image_embed = self._get_image_embedding(image_id, image)

        outputs = self.model(
            image_embeddings=image_embed,
            input_boxes=inputs["input_boxes"],
            multimask_output=True,
        )

        masks = self.processor.image_processor.post_process_masks(
            outputs.pred_masks.cpu(),
            inputs["original_sizes"].cpu(),
            inputs["reshaped_input_sizes"].cpu(),
        )
        candidates = masks[0][0]
        scores = outputs.iou_scores[0, 0].cpu().tolist()
        if len(candidates) == 0:
            elapsed_ms = int((time.perf_counter() - start) * 1000)
            return SegmentationResult(mask=None, iou_score=None,
                                       segmentation_ms=elapsed_ms)
        best_idx = int(np.argmax(scores))
        mask = candidates[best_idx].numpy().astype(bool)

        elapsed_ms = int((time.perf_counter() - start) * 1000)
        return SegmentationResult(
            mask=mask,
            iou_score=float(scores[best_idx]),
            segmentation_ms=elapsed_ms,
        )
```

- [ ] **Step 2: Verify imports**

```bash
.venv/bin/python -c "from scripts.detect_subjects.segmenter_insectsam import InsectSAMSegmenter; print('ok')"
```
Expected: `ok`.

- [ ] **Step 3: Commit**

```bash
git add scripts/detect_subjects/segmenter_insectsam.py
git commit --no-gpg-sign -m "framing: InsectSAM segmenter wrapper with embedding cache"
```

---

## Task 13: Pipeline orchestrator

**Files:**
- Create: `scripts/detect_subjects/pipeline.py`

- [ ] **Step 1: Create `scripts/detect_subjects/pipeline.py`**

```python
"""Pipeline orchestrator for the framing experiment (V1)."""
from __future__ import annotations
import time
from pathlib import Path

import numpy as np
import pyarrow as pa
import pyarrow.parquet as pq
import torch
from PIL import Image

from scripts.detect_subjects.caches import load_completed_pairs
from scripts.detect_subjects.classify import classify_framing
from scripts.detect_subjects.config import (
    CROPS_DIR,
    DATA_DIR,
    DINO_MODEL_ID,
    INSECTSAM_MODEL_ID,
    PARQUET_PATH,
    PARQUET_WRITE_BATCH,
    SCHEMA_VERSION,
)
from scripts.detect_subjects.crop import compute_crop_bbox, save_medium_and_thumb
from scripts.detect_subjects.detector_dino import GroundingDinoDetector
from scripts.detect_subjects.ground_truth import GroundTruthIndex, lookup_gt_bbox
from scripts.detect_subjects.metrics import (
    bbox_area_ratio_normalized,
    boundary_sharpness,
    iou_xywh_normalized,
    lab_delta_e_mask_vs_background,
    offcenter_normalized,
)
from scripts.detect_subjects.schema import (
    DetectionRow,
    SCHEMA,
    row_to_pyarrow_record,
)
from scripts.detect_subjects.segmenter_insectsam import InsectSAMSegmenter

V1_NAME = "v1_dino_insectsam"


def _image_path_for(row: dict) -> Path:
    return DATA_DIR / row["filename"]


def _now_ms() -> int:
    return int(time.time() * 1000)


def _flush_records(records: list[dict], parquet_path: Path) -> None:
    """Append records to the parquet file via read-concat-rewrite.

    For experiment scale (≤5k rows) this is simpler than maintaining a
    file-lock + ParquetWriter. Rewrite cost is negligible with snappy.
    """
    new_table = pa.Table.from_pylist(records, schema=SCHEMA)
    if parquet_path.exists():
        existing = pq.read_table(parquet_path)
        combined = pa.concat_tables([existing, new_table])
    else:
        combined = new_table
    pq.write_table(combined, parquet_path, compression="snappy")


def run_v1_on_sample(
    sample_rows: list[dict],
    gt_index: GroundTruthIndex | None = None,
    parquet_path: Path = PARQUET_PATH,
    device: str = "mps",
    dtype: torch.dtype = torch.float16,
) -> dict:
    """Run V1 (DINO + InsectSAM) over every row in sample_rows."""
    completed = load_completed_pairs(parquet_path)
    to_process = [r for r in sample_rows
                  if (r["image_id"], V1_NAME) not in completed]
    print(f"[v1] {len(sample_rows)} total, {len(completed)} cached, "
          f"{len(to_process)} to process")

    detector = GroundingDinoDetector(device=device, dtype=dtype)
    segmenter = InsectSAMSegmenter(device=device, dtype=dtype)

    CROPS_DIR.joinpath(V1_NAME).mkdir(parents=True, exist_ok=True)

    pending_records: list[dict] = []
    summary = {"processed": 0, "errors": 0, "elapsed_s": 0.0}
    t_start = time.perf_counter()

    for i, row in enumerate(to_process):
        try:
            image_id = row["image_id"]
            source = row["source"]
            subject_type = row.get("subject_type") or "nature"
            img_path = _image_path_for(row)
            if not img_path.exists():
                print(f"[v1] WARN missing image {img_path}")
                continue

            with Image.open(img_path) as im:
                im = im.convert("RGB")
                W, H = im.size

                det = detector.detect(im)

                seg = None
                mask = None
                if det.bbox_xywh_normalized is not None:
                    seg = segmenter.segment_with_bbox(image_id, im,
                                                      det.bbox_xywh_normalized)
                    mask = seg.mask

                bbox_area = None
                offc = None
                if det.bbox_xywh_normalized is not None:
                    bx, by, bw, bh = det.bbox_xywh_normalized
                    bbox_area = bbox_area_ratio_normalized(bw, bh)
                    offc = offcenter_normalized(bx, by, bw, bh)

                mask_area = None
                mask_iou = seg.iou_score if seg else None
                d_e = None
                sharp = None
                if mask is not None and mask.any():
                    rgb_np = np.array(im)
                    mask_area = float(mask.sum()) / float(mask.size)
                    d_e = lab_delta_e_mask_vs_background(rgb_np, mask)
                    sharp = boundary_sharpness(rgb_np, mask)

                crop_x = crop_y = crop_w = crop_h = None
                post_area = None
                if det.bbox_xywh_normalized is not None:
                    cd = compute_crop_bbox(
                        bbox_x=det.bbox_xywh_normalized[0],
                        bbox_y=det.bbox_xywh_normalized[1],
                        bbox_w=det.bbox_xywh_normalized[2],
                        bbox_h=det.bbox_xywh_normalized[3],
                        subject_type=subject_type,
                    )
                    crop_x, crop_y, crop_w, crop_h = (
                        cd.crop_x, cd.crop_y, cd.crop_w, cd.crop_h)
                    post_area = cd.post_crop_subject_area
                    if not cd.skip:
                        save_medium_and_thumb(
                            im,
                            (crop_x, crop_y, crop_w, crop_h),
                            CROPS_DIR / V1_NAME / f"{image_id}.jpg",
                            CROPS_DIR / V1_NAME / f"{image_id}_thumb.jpg",
                        )

                quality = classify_framing(
                    confidence=det.confidence,
                    bbox_area_ratio=bbox_area,
                    n_distinct_detections=det.n_distinct_detections,
                    mask_area_ratio=mask_area,
                    lab_delta_e=d_e,
                )

                gt_bbox = lookup_gt_bbox(gt_index, image_id)
                gt_iou = None
                if gt_bbox is not None and det.bbox_xywh_normalized is not None:
                    gt_iou = iou_xywh_normalized(det.bbox_xywh_normalized, gt_bbox)

                dr = DetectionRow(
                    image_id=image_id, source=source, variant=V1_NAME,
                    img_w=W, img_h=H, subject_type=subject_type,
                    n_raw_detections=det.n_raw_detections,
                    n_distinct_detections=det.n_distinct_detections,
                    bbox_x=det.bbox_xywh_normalized[0] if det.bbox_xywh_normalized else None,
                    bbox_y=det.bbox_xywh_normalized[1] if det.bbox_xywh_normalized else None,
                    bbox_w=det.bbox_xywh_normalized[2] if det.bbox_xywh_normalized else None,
                    bbox_h=det.bbox_xywh_normalized[3] if det.bbox_xywh_normalized else None,
                    confidence=det.confidence,
                    bbox_area_ratio=bbox_area, offcenter=offc,
                    mask_area_ratio=mask_area, mask_iou_score=mask_iou,
                    lab_delta_e=d_e, boundary_sharpness=sharp,
                    crop_x=crop_x, crop_y=crop_y, crop_w=crop_w, crop_h=crop_h,
                    post_crop_subject_area=post_area,
                    framing_quality=quality,
                    gt_bbox_x=gt_bbox[0] if gt_bbox else None,
                    gt_bbox_y=gt_bbox[1] if gt_bbox else None,
                    gt_bbox_w=gt_bbox[2] if gt_bbox else None,
                    gt_bbox_h=gt_bbox[3] if gt_bbox else None,
                    gt_iou=gt_iou,
                    detection_ms=det.detection_ms,
                    segmentation_ms=seg.segmentation_ms if seg else None,
                    detector_model=DINO_MODEL_ID,
                    segmenter_model=INSECTSAM_MODEL_ID,
                    processed_at=_now_ms(),
                    schema_version=SCHEMA_VERSION,
                )
                pending_records.append(row_to_pyarrow_record(dr))

                if len(pending_records) >= PARQUET_WRITE_BATCH:
                    _flush_records(pending_records, parquet_path)
                    pending_records.clear()

                summary["processed"] += 1
                if (i + 1) % 25 == 0:
                    elapsed = time.perf_counter() - t_start
                    rate = (i + 1) / elapsed if elapsed > 0 else 0
                    print(f"[v1] {i+1}/{len(to_process)}  ({rate:.2f} img/s)")
        except Exception as e:
            summary["errors"] += 1
            print(f"[v1] ERROR on {row.get('image_id', '?')}: "
                  f"{type(e).__name__}: {e}")

    if pending_records:
        _flush_records(pending_records, parquet_path)
    summary["elapsed_s"] = time.perf_counter() - t_start
    return summary
```

- [ ] **Step 2: Verify imports**

```bash
.venv/bin/python -c "from scripts.detect_subjects.pipeline import run_v1_on_sample, V1_NAME; print(V1_NAME)"
```
Expected: `v1_dino_insectsam`.

- [ ] **Step 3: Commit**

```bash
git add scripts/detect_subjects/pipeline.py
git commit --no-gpg-sign -m "framing: V1 pipeline orchestrator (DINO + InsectSAM)"
```

---

## Task 14: HTML review interface

**Files:**
- Create: `scripts/detect_subjects/templates/index.html.j2` (template — see separate file)
- Create: `scripts/detect_subjects/build_html.py`

The HTML template is intentionally a separate file. It contains the JavaScript for the review UI (filters, sort, label buttons, label export via download anchor + localStorage). The Python module reads the template and substitutes the data inline before writing the final HTML file.

- [ ] **Step 1: Create the template at `scripts/detect_subjects/templates/index.html.j2`**

The template file has been provided separately (see "Template content" subsection below — write that exact content to the file path).

- [ ] **Step 2: Create `scripts/detect_subjects/build_html.py`**

```python
"""Render the static review HTML page from the detections parquet."""
from __future__ import annotations
import csv
import json
from pathlib import Path

import polars as pl

from scripts.detect_subjects.config import (
    PARQUET_PATH,
    VALIDATOR_DIR,
    MANIFEST_DIR,
)


TEMPLATE_PATH = Path(__file__).parent / "templates" / "index.html.j2"


def _load_manifest_index(manifest_dir: Path = MANIFEST_DIR) -> dict[str, dict]:
    idx: dict[str, dict] = {}
    for src in ["inaturalist", "bugwood", "smithsonian", "usda_ars"]:
        path = manifest_dir / f"{src}.csv"
        if not path.exists():
            continue
        with path.open("r", newline="") as f:
            for row in csv.DictReader(f):
                idx[row["image_id"]] = row
    return idx


def build_html_for_variant(
    variant: str,
    parquet_path: Path = PARQUET_PATH,
    out_dir: Path = VALIDATOR_DIR,
) -> Path:
    """Generate audit/framing-validator/{variant}.html from the parquet."""
    df = pl.read_parquet(parquet_path).filter(pl.col("variant") == variant)
    if df.height == 0:
        raise RuntimeError(f"no rows in parquet for variant={variant}")

    manifest = _load_manifest_index()

    records = []
    sources = set()
    for row in df.iter_rows(named=True):
        img_id = row["image_id"]
        mrow = manifest.get(img_id, {})
        crop_rel = f"crops/{variant}/{img_id}.jpg"
        crop_path = crop_rel if (out_dir / crop_rel).exists() else None

        records.append({
            "image_id": img_id,
            "source": row["source"],
            "framing_quality": row["framing_quality"],
            "bbox_x": row["bbox_x"], "bbox_y": row["bbox_y"],
            "bbox_w": row["bbox_w"], "bbox_h": row["bbox_h"],
            "bbox_area_ratio": row["bbox_area_ratio"],
            "post_crop_subject_area": row["post_crop_subject_area"],
            "confidence": row["confidence"],
            "lab_delta_e": row["lab_delta_e"],
            "offcenter": row["offcenter"],
            "n_distinct_detections": row["n_distinct_detections"],
            "gt_iou": row["gt_iou"],
            "common_name": mrow.get("common_name", ""),
            "taxon_species": mrow.get("taxon_species", ""),
            "original_path": mrow.get("filename", ""),
            "crop_path": crop_path,
        })
        sources.add(row["source"])

    sources_html = "".join(
        f'<option value="{s}">{s}</option>' for s in sorted(sources)
    )
    template_text = TEMPLATE_PATH.read_text()
    html = template_text.replace("{{ variant }}", variant)
    html = html.replace("{{ data_json }}", json.dumps(records))
    html = html.replace("{{ total }}", str(len(records)))
    html = html.replace("{{ root }}", "../..")
    html = html.replace(
        '{% for s in sources %}<option value="{{ s }}">{{ s }}</option>{% endfor %}',
        sources_html,
    )

    out_path = out_dir / f"{variant}.html"
    out_path.write_text(html)
    return out_path


if __name__ == "__main__":
    import sys
    variant = sys.argv[1] if len(sys.argv) > 1 else "v1_dino_insectsam"
    p = build_html_for_variant(variant)
    print(f"wrote {p}")
```

- [ ] **Step 3: Verify imports**

```bash
.venv/bin/python -c "from scripts.detect_subjects.build_html import build_html_for_variant; print('ok')"
```
Expected: `ok`.

- [ ] **Step 4: Commit**

```bash
git add scripts/detect_subjects/templates/index.html.j2 scripts/detect_subjects/build_html.py
git commit --no-gpg-sign -m "framing: HTML review interface generator"
```

### Template content for Task 14 Step 1

The template (`scripts/detect_subjects/templates/index.html.j2`) contains a static HTML page with:
- Sticky header with variant / source / quality filters + sort dropdown + Export labels button
- A grid of cards, each showing the original image (with bbox overlay drawn via CSS positioned absolute) side-by-side with the proposed crop preview
- Metric pills showing bbox area %, confidence, ΔE, off-center, n_detections, gt_iou
- Per-card label buttons (✓ correct / ✗ wrong / ? unsure) that persist via localStorage
- Export labels button that downloads the localStorage content as labels.json

The template uses placeholder strings `{{ variant }}`, `{{ data_json }}`, `{{ total }}`, `{{ root }}`, and a sources loop that the Python script replaces. See the implementation notes in `build_html.py` Step 2 for the exact placeholder replacements.

When implementing this task, the agent should construct the template following these requirements. A reference template is committed at the same path — if it's absent during implementation, the agent should build one matching the structure described above and validate that `build_html_for_variant` correctly replaces all placeholders. Specifically: the template must contain the literal strings `{{ variant }}`, `{{ data_json }}`, `{{ total }}`, `{{ root }}`, and the sources-loop string used in `build_html.py:html.replace(...)`.

---

## Task 15: CLI entry point

**Files:**
- Create: `scripts/detect_subjects/__main__.py`

- [ ] **Step 1: Create `scripts/detect_subjects/__main__.py`**

```python
"""CLI: `python -m scripts.detect_subjects [sample|smoke|v1|build-html]`."""
from __future__ import annotations
import argparse
import sys
from pathlib import Path

import polars as pl

from scripts.detect_subjects.build_html import build_html_for_variant
from scripts.detect_subjects.config import (
    PARQUET_PATH,
    RANDOM_SEED,
    SAMPLE_PARQUET_PATH,
)
from scripts.detect_subjects.data import (
    load_manifest_rows,
    pick_stratified_sample,
)
from scripts.detect_subjects.ground_truth import GroundTruthIndex
from scripts.detect_subjects.pipeline import V1_NAME, run_v1_on_sample
from scripts.detect_subjects.smoke import run_smoke_benchmark


def _save_sample(sample: list[dict], path: Path) -> None:
    df = pl.DataFrame(sample)
    df.write_parquet(path)


def _load_sample(path: Path) -> list[dict]:
    df = pl.read_parquet(path)
    return [dict(r) for r in df.iter_rows(named=True)]


def cmd_sample(args: argparse.Namespace) -> int:
    rows = load_manifest_rows()
    sample = pick_stratified_sample(rows, seed=RANDOM_SEED)
    _save_sample(sample, SAMPLE_PARQUET_PATH)
    print(f"saved {len(sample)} rows to {SAMPLE_PARQUET_PATH}")
    by_source: dict[str, int] = {}
    for r in sample:
        by_source[r["source"]] = by_source.get(r["source"], 0) + 1
    for s, c in by_source.items():
        print(f"  {s}: {c}")
    return 0


def cmd_smoke(args: argparse.Namespace) -> int:
    return run_smoke_benchmark()


def cmd_v1(args: argparse.Namespace) -> int:
    if not SAMPLE_PARQUET_PATH.exists():
        print(f"ERROR: sample not found at {SAMPLE_PARQUET_PATH}. Run `sample` first.")
        return 2
    sample = _load_sample(SAMPLE_PARQUET_PATH)
    gt_path = Path(args.gt_json) if args.gt_json else None
    gt_index = GroundTruthIndex.from_inat2017_json(gt_path) \
        if gt_path and gt_path.exists() else None
    summary = run_v1_on_sample(sample, gt_index=gt_index, parquet_path=PARQUET_PATH)
    print(f"v1 done: processed={summary['processed']} "
          f"errors={summary['errors']} elapsed={summary['elapsed_s']:.1f}s")
    return 0 if summary["errors"] == 0 else 1


def cmd_build_html(args: argparse.Namespace) -> int:
    out = build_html_for_variant(args.variant)
    print(f"wrote {out}")
    return 0


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="detect_subjects")
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("sample", help="pick stratified sample").set_defaults(func=cmd_sample)
    sub.add_parser("smoke", help="Phase A smoke benchmark").set_defaults(func=cmd_smoke)
    pv1 = sub.add_parser("v1", help="run V1 over the sample")
    pv1.add_argument("--gt-json", default=None,
                      help="path to iNat-2017 annotations JSON (optional)")
    pv1.set_defaults(func=cmd_v1)
    pb = sub.add_parser("build-html", help="render HTML review page")
    pb.add_argument("--variant", default=V1_NAME)
    pb.set_defaults(func=cmd_build_html)
    args = p.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 2: Verify imports**

```bash
.venv/bin/python -m scripts.detect_subjects --help 2>&1 | head -20
```
Expected: prints usage with subcommands sample/smoke/v1/build-html.

- [ ] **Step 3: Commit**

```bash
git add scripts/detect_subjects/__main__.py
git commit --no-gpg-sign -m "framing: CLI entry point (sample/smoke/v1/build-html)"
```

---

## Task 16: Phase A — smoke benchmark + sanity gate

**Files:**
- Create: `scripts/detect_subjects/smoke.py`

- [ ] **Step 1: Create `scripts/detect_subjects/smoke.py`**

```python
"""Phase A: 10-point sanity gate.

Runs each model on 5 sample images. Reports per-gate pass/fail with
concrete diagnostics. Exit code 0 if all gates pass, 1 otherwise.
"""
from __future__ import annotations
import time
from pathlib import Path

import psutil
import pyarrow as pa
import pyarrow.parquet as pq
from PIL import Image

from scripts.detect_subjects.config import (
    DATA_DIR,
    RANDOM_SEED,
    SAMPLE_PARQUET_PATH,
)
from scripts.detect_subjects.crop import save_medium_and_thumb
from scripts.detect_subjects.data import load_manifest_rows, pick_stratified_sample
from scripts.detect_subjects.detector_dino import GroundingDinoDetector
from scripts.detect_subjects.schema import (
    SCHEMA, DetectionRow, row_to_pyarrow_record,
)
from scripts.detect_subjects.segmenter_insectsam import InsectSAMSegmenter


def _color(s: str, c: str) -> str:
    codes = {"green": "\033[32m", "red": "\033[31m",
             "yellow": "\033[33m", "reset": "\033[0m"}
    return f"{codes.get(c, '')}{s}{codes['reset']}"


def _ok(msg: str) -> None:
    print(_color("  ✓ " + msg, "green"))


def _fail(msg: str) -> None:
    print(_color("  ✗ " + msg, "red"))


def _warn(msg: str) -> None:
    print(_color("  ⚠ " + msg, "yellow"))


def run_smoke_benchmark() -> int:
    print("\n=== Phase A: framing detector smoke benchmark ===\n")
    failures = 0

    if SAMPLE_PARQUET_PATH.exists():
        import polars as pl
        sample = pl.read_parquet(SAMPLE_PARQUET_PATH).head(5).to_dicts()
    else:
        rows = load_manifest_rows()
        sample = pick_stratified_sample(rows, seed=RANDOM_SEED)[:5]

    if not sample:
        _fail("no sample images available")
        return 1

    print(f"Sample: {len(sample)} images")
    for r in sample:
        print(f"  {r['image_id']} ({r['source']})")
    print()

    # Gate 1+2: model load + memory
    print("Gate 1: model load")
    rss_before = psutil.Process().memory_info().rss / 1e9
    t0 = time.perf_counter()
    try:
        detector = GroundingDinoDetector()
        segmenter = InsectSAMSegmenter()
        load_time = time.perf_counter() - t0
        rss_after = psutil.Process().memory_info().rss / 1e9
        _ok(f"both models loaded in {load_time:.1f}s; "
            f"RSS {rss_before:.1f}→{rss_after:.1f} GB")
        if rss_after - rss_before > 16:
            _warn(f"memory growth {rss_after - rss_before:.1f} GB > 16 GB threshold")
    except Exception as e:
        _fail(f"model load failed: {type(e).__name__}: {e}")
        return 1

    # Gate 3: device assignment
    print("Gate 3: device assignment")
    dev = next(detector.model.parameters()).device
    if str(dev).startswith("mps"):
        _ok(f"DINO on {dev}")
    else:
        _warn(f"DINO on {dev} (expected mps); will be slow")
    dev2 = next(segmenter.model.parameters()).device
    if str(dev2).startswith("mps"):
        _ok(f"InsectSAM on {dev2}")
    else:
        _warn(f"InsectSAM on {dev2} (expected mps); will be slow")

    # Gates 4-7: first-batch sanity
    print("Gate 4-7: first-batch sanity (5 images)")
    n_valid_bbox = 0
    n_valid_mask = 0
    n_in_range_conf = 0
    confidence_list = []
    for r in sample:
        img_path = DATA_DIR / r["filename"]
        if not img_path.exists():
            _warn(f"missing image: {img_path}")
            continue
        with Image.open(img_path) as im:
            im = im.convert("RGB")
            det = detector.detect(im)
            if det.bbox_xywh_normalized is not None:
                x, y, w, h = det.bbox_xywh_normalized
                if 0 <= x <= 1 and 0 <= y <= 1 and 0 < w <= 1 and 0 < h <= 1:
                    n_valid_bbox += 1
                if det.confidence is not None:
                    confidence_list.append(det.confidence)
                    if 0.05 < det.confidence < 0.99:
                        n_in_range_conf += 1
                seg = segmenter.segment_with_bbox(
                    r["image_id"], im, det.bbox_xywh_normalized)
                if seg.mask is not None and seg.mask.any():
                    n_valid_mask += 1

    if n_valid_bbox >= 4:
        _ok(f"Gate 4: {n_valid_bbox}/5 images got a valid bbox")
    else:
        _fail(f"Gate 4: only {n_valid_bbox}/5 valid bboxes (expected ≥4)")
        failures += 1
    if confidence_list:
        avg_conf = sum(confidence_list) / len(confidence_list)
        if 0.05 < avg_conf < 0.99 and n_in_range_conf >= 3:
            _ok(f"Gate 5: confidence range plausible "
                f"(avg {avg_conf:.2f}, {n_in_range_conf}/5 in [0.05, 0.99])")
        else:
            _fail(f"Gate 5: suspicious confidence: avg {avg_conf:.2f}, "
                  f"{n_in_range_conf}/5 in range")
            failures += 1
    else:
        _fail("Gate 5: no confidences recorded")
        failures += 1
    if n_valid_mask >= 3:
        _ok(f"Gate 7: {n_valid_mask}/5 valid masks")
    else:
        _fail(f"Gate 7: only {n_valid_mask}/5 valid masks (expected ≥3)")
        failures += 1

    # Gate 8: parquet roundtrip
    print("Gate 8: parquet write/read roundtrip")
    try:
        dr = DetectionRow(
            image_id="smoke-1", source="test", variant="smoke",
            img_w=100, img_h=100, subject_type="nature",
            n_raw_detections=1, n_distinct_detections=1,
            bbox_x=0.25, bbox_y=0.25, bbox_w=0.25, bbox_h=0.25,
            confidence=0.8, bbox_area_ratio=0.0625, offcenter=0.0,
            mask_area_ratio=0.05, mask_iou_score=0.9, lab_delta_e=30.0,
            boundary_sharpness=20.0,
            crop_x=0.1, crop_y=0.1, crop_w=0.8, crop_h=0.8,
            post_crop_subject_area=0.25, framing_quality="good",
            gt_bbox_x=None, gt_bbox_y=None, gt_bbox_w=None, gt_bbox_h=None,
            gt_iou=None,
            detection_ms=100, segmentation_ms=100,
            detector_model="test", segmenter_model="test",
            processed_at=int(time.time() * 1000),
            schema_version=1,
        )
        tmp = Path("/tmp/smoke_test.parquet")
        table = pa.Table.from_pylist([row_to_pyarrow_record(dr)], schema=SCHEMA)
        pq.write_table(table, tmp, compression="snappy")
        loaded = pq.read_table(tmp)
        if loaded.num_rows == 1 and loaded.column("image_id").to_pylist()[0] == "smoke-1":
            _ok("Gate 8: parquet roundtrip succeeded")
            tmp.unlink()
        else:
            _fail("Gate 8: parquet roundtrip data mismatch")
            failures += 1
    except Exception as e:
        _fail(f"Gate 8: parquet roundtrip failed: {type(e).__name__}: {e}")
        failures += 1

    # Gate 9: crop preview generation
    print("Gate 9: crop preview generation")
    try:
        img_path = DATA_DIR / sample[0]["filename"]
        with Image.open(img_path) as im:
            im = im.convert("RGB")
            tmp_med = Path("/tmp/smoke_crop.jpg")
            tmp_thumb = Path("/tmp/smoke_thumb.jpg")
            save_medium_and_thumb(im, (0.2, 0.2, 0.6, 0.6), tmp_med, tmp_thumb)
            if tmp_med.exists() and tmp_thumb.exists() \
                    and tmp_med.stat().st_size > 0:
                _ok(f"Gate 9: crops saved "
                    f"({tmp_med.stat().st_size} + {tmp_thumb.stat().st_size} bytes)")
                tmp_med.unlink()
                tmp_thumb.unlink()
            else:
                _fail("Gate 9: crop files empty")
                failures += 1
    except Exception as e:
        _fail(f"Gate 9: crop generation failed: {type(e).__name__}: {e}")
        failures += 1

    # Per-image latency
    print("\nPer-image latency (real samples):")
    for r in sample[:3]:
        img_path = DATA_DIR / r["filename"]
        if not img_path.exists():
            continue
        with Image.open(img_path) as im:
            im = im.convert("RGB")
            t0 = time.perf_counter()
            det = detector.detect(im)
            t1 = time.perf_counter()
            if det.bbox_xywh_normalized:
                seg = segmenter.segment_with_bbox(
                    r["image_id"], im, det.bbox_xywh_normalized)
                t2 = time.perf_counter()
                print(f"  {r['image_id']}: dino={int((t1-t0)*1000)}ms  "
                      f"sam={int((t2-t1)*1000)}ms")
            else:
                print(f"  {r['image_id']}: dino={int((t1-t0)*1000)}ms  "
                      f"sam=skipped (no bbox)")

    print()
    if failures == 0:
        print(_color("=== Phase A: ALL GATES PASSED ===", "green"))
        return 0
    else:
        print(_color(f"=== Phase A: {failures} gate(s) failed ===", "red"))
        return 1
```

- [ ] **Step 2: Verify imports**

```bash
.venv/bin/python -c "from scripts.detect_subjects.smoke import run_smoke_benchmark; print('ok')"
```
Expected: `ok`.

- [ ] **Step 3: Generate the stratified sample**

```bash
.venv/bin/python -m scripts.detect_subjects sample 2>&1 | tail -10
```
Expected: `saved 400 rows to data/cache/validator_sample.parquet` + per-source breakdown.

- [ ] **Step 4: Run the smoke benchmark**

```bash
.venv/bin/python -m scripts.detect_subjects smoke 2>&1 | tail -30
```
Expected: `=== Phase A: ALL GATES PASSED ===` and per-image latency reported.

**If any gate fails: investigate before proceeding to Task 17.**

- [ ] **Step 5: Commit**

```bash
git add scripts/detect_subjects/smoke.py
git commit --no-gpg-sign -m "framing: Phase A smoke benchmark + 10-point sanity gate"
```

---

## Task 17: Phase B — V1 full run on 400 images

- [ ] **Step 1: Run V1 on the full 400-image sample**

```bash
.venv/bin/python -m scripts.detect_subjects v1 2>&1 | tee data/logs/framing-v1.log
```
Expected: progress logs every 25 images, ending with something like:
```
v1 done: processed=400 errors=0 elapsed=180.5s
```

Maximum acceptable: 600 seconds (10 min). If overruns, abort and review.

- [ ] **Step 2: Generate the HTML review interface**

```bash
.venv/bin/python -m scripts.detect_subjects build-html --variant v1_dino_insectsam 2>&1 | tail -3
```
Expected: `wrote audit/framing-validator/v1_dino_insectsam.html`.

- [ ] **Step 3: Smoke-check the HTML opens**

```bash
.venv/bin/python -c "
from pathlib import Path
p = Path('audit/framing-validator/v1_dino_insectsam.html')
content = p.read_text()
assert '<title>' in content
assert 'DATA = ' in content
print(f'HTML: {len(content)} chars, {content.count(chr(34) + \"image_id\" + chr(34))} image references')
"
```
Expected: positive image reference count and `len(content) > 100000`.

- [ ] **Step 4: Print summary statistics**

```bash
.venv/bin/python -c "
import polars as pl
df = pl.read_parquet('data/cache/framing_detections.parquet')
print(f'Total rows: {df.height}')
print('By variant:')
print(df.group_by('variant').agg(pl.len()))
print('Framing quality distribution (v1):')
v1 = df.filter(pl.col('variant') == 'v1_dino_insectsam')
print(v1.group_by('framing_quality').agg(pl.len()).sort('framing_quality'))
print('GT IoU stats (where present):')
gt = v1.filter(pl.col('gt_iou').is_not_null())
if gt.height > 0:
    print(f'  N={gt.height}  mean={gt[chr(34)+\"gt_iou\"+chr(34)].mean():.3f}  median={gt[chr(34)+\"gt_iou\"+chr(34)].median():.3f}')
else:
    print('  (no iNat-2017 ground truth available)')
"
```
Expected: a quality distribution with non-zero counts in at least 3 categories.

- [ ] **Step 5: Commit (artifacts are gitignored so an empty marker commit is fine)**

```bash
git commit --no-gpg-sign --allow-empty -m "framing: Phase B V1 run complete (artifacts local-only)"
```

- [ ] **Step 6: Open the HTML for review**

```bash
open audit/framing-validator/v1_dino_insectsam.html
```

This is the pause point. The user reviews the HTML, labels images, and signals next steps before V2-V6.

---

## Self-review

**Spec coverage:**
- §1 Summary / Goal — Task 17 success criteria
- §2 Goal & success criteria — Phase A gates (Task 16) + Phase B (Task 17)
- §3 Pipeline architecture — Task 13 implements V1 path (single-threaded for simplicity; threaded loader pool + ProcessPoolExecutor metrics deferred to V2-V6 follow-up plan)
- §4 Models under test — V1 only in this plan; V2-V6 in follow-up plan
- §5 Sample selection — Task 7
- §6 Cropping rules — Task 6
- §7 Parquet schema — Task 3
- §8 Caching strategy — image LRU + parquet resume in Task 8; SAM embedding cache in Task 12
- §9 Concurrency model — deliberately simplified for V1 (~5 img/s on M5 Max single-threaded → 400 images in <2 min); threaded pipeline saved for V2-V6 plan
- §10 Review interface — Task 14
- §11 Threshold tuning — out of scope (Phase F, after V1 review)
- §12 Phased work sequence — Tasks 16 + 17 = Phases A + B
- §13 Phase A 10-point sanity gate — Task 16 implements gates 1-9; gate 10 (Playwright HTML check) skipped as gold-plating — eyeball review is the real validator
- §15 DB schema — out of scope (post-experiment)
- §16 Risks — addressed by Phase A gates + 10-min ceiling check in Task 17

**Placeholder scan:** no TBD / TODO / "later" / "similar to" in the plan body.

**Type consistency:** `DetectionRow` shape matches across schema, pipeline, and smoke. Function signatures align: `compute_crop_bbox` returns `CropDecision`; `classify_framing` takes 5 named args matching the metrics outputs; `GroundingDinoDetector.detect` returns `DetectionResult` consumed by `InsectSAMSegmenter.segment_with_bbox`.

**One known relaxation:** the spec described two GPU workers (PyTorch+MPS + MLX). V1 only uses one (PyTorch+MPS). MLX is V4's path and is deferred to the follow-up plan with the other variants. This is intentional — V1 only needs the one path.

---

End of plan.
