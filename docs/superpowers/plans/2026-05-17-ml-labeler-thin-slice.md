# Phase 3 ML labeler — Thin Slice 1 (blur_unusable end-to-end) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a working active-learning loop for the `mask_blur_unusable` label end-to-end: scalar-arm TabPFN-v2 classifier → parquet column → validator UI tab with uncertainty-sort and retrain button. User can label, retrain, see predictions, sort by most-uncertain, label more.

**Architecture:** Single-label, single-arm (TabPFN-v2 on 12 hand-engineered scalars). Frozen training script writes per-label probabilities back into `framing_detections.parquet`. Validator UI gains per-label tab. No DoRA, Cleanlab, rule-prior, or gate.py integration yet — those land in Plans 2-4 once this loop is validated.

**Tech Stack:** Python 3.12, polars, scikit-learn 1.8+, tabpfn 2.0+ (pip install required), joblib, pytest, existing label_server.py + validator template.

**Spec:** `docs/superpowers/specs/2026-05-17-ml-labeler-design.md`

---

## File structure

**Create:**
- `scripts/detect_subjects/ml_labeler/__init__.py` — registry + factory
- `scripts/detect_subjects/ml_labeler/features.py` — feature extraction (scalars only for v1)
- `scripts/detect_subjects/ml_labeler/train.py` — per-label TabPFN training with 5×5 CV
- `scripts/detect_subjects/ml_labeler/predict.py` — batch inference → parquet write
- `scripts/detect_subjects/ml_labeler/evaluation.py` — MCC + PR-AUC + Brier reporters
- `scripts/detect_subjects/ml_labeler/models/.gitkeep` — model artifact directory
- `tests/python/test_ml_labeler_features.py`
- `tests/python/test_ml_labeler_train.py`
- `tests/python/test_ml_labeler_predict.py`
- `tests/python/test_ml_labeler_evaluation.py`

**Modify:**
- `scripts/detect_subjects/schema.py` — add `predicted_<label>_p` + `_unreliable` columns (one label for v1)
- `scripts/detect_subjects/config.py` — bump `SCHEMA_VERSION` to 3
- `scripts/detect_subjects/build_html.py` — expose predicted columns in `data_json`
- `tools/validator/templates/index.html.j2` — per-label tab strip + uncertainty sort + per-card prediction display + retrain button
- `requirements.txt` — add `tabpfn>=2.0.0`

---

## Task 1: Add tabpfn dependency + verify import

**Files:**
- Modify: `requirements.txt`
- Verify: `.venv/bin/python -c "import tabpfn"`

- [ ] **Step 1: Add tabpfn to requirements.txt**

Append to `requirements.txt`:
```
tabpfn>=2.0.0
```

- [ ] **Step 2: Install**

```bash
.venv/bin/pip install tabpfn>=2.0.0
```

Expected output: `Successfully installed tabpfn-2.x.x`

- [ ] **Step 3: Smoke-test import**

```bash
.venv/bin/python -c "from tabpfn import TabPFNClassifier; print(TabPFNClassifier())"
```
Expected: prints a `TabPFNClassifier(...)` repr without error.

- [ ] **Step 4: Commit**

```bash
git add requirements.txt
git commit --no-gpg-sign -m "feat(ml_labeler): add tabpfn>=2.0.0 dependency for scalar-arm classifier"
```

---

## Task 2: Package scaffold

**Files:**
- Create: `scripts/detect_subjects/ml_labeler/__init__.py`
- Create: `scripts/detect_subjects/ml_labeler/models/.gitkeep`
- Test: `tests/python/test_ml_labeler_package.py`

- [ ] **Step 1: Write failing import test**

`tests/python/test_ml_labeler_package.py`:
```python
"""Verify ml_labeler package imports and exposes expected surface."""
def test_package_imports():
    from scripts.detect_subjects.ml_labeler import TIER1_LABELS, MODELS_DIR
    assert "mask_blur_unusable" in TIER1_LABELS
    assert MODELS_DIR.name == "models"
    assert MODELS_DIR.exists()
```

- [ ] **Step 2: Run test, expect ImportError**

```bash
.venv/bin/pytest tests/python/test_ml_labeler_package.py -v
```
Expected: `ModuleNotFoundError: No module named 'scripts.detect_subjects.ml_labeler'`

- [ ] **Step 3: Create package**

`scripts/detect_subjects/ml_labeler/__init__.py`:
```python
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
```

Create empty `.gitkeep`:
```bash
mkdir -p scripts/detect_subjects/ml_labeler/models
touch scripts/detect_subjects/ml_labeler/models/.gitkeep
```

- [ ] **Step 4: Run test, expect pass**

```bash
.venv/bin/pytest tests/python/test_ml_labeler_package.py -v
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/detect_subjects/ml_labeler/__init__.py scripts/detect_subjects/ml_labeler/models/.gitkeep tests/python/test_ml_labeler_package.py
git commit --no-gpg-sign -m "feat(ml_labeler): package scaffold with TIER1_LABELS=[blur_unusable]"
```

---

## Task 3: Scalar feature extraction

**Files:**
- Create: `scripts/detect_subjects/ml_labeler/features.py`
- Test: `tests/python/test_ml_labeler_features.py`

- [ ] **Step 1: Write failing test**

`tests/python/test_ml_labeler_features.py`:
```python
"""Verify scalar feature extraction from a polars row dict."""
import numpy as np

def test_scalar_features_from_row_dict():
    from scripts.detect_subjects.ml_labeler.features import (
        SCALAR_FEATURE_NAMES, scalar_feature_vector,
    )
    # 12 named features per spec §architecture
    assert len(SCALAR_FEATURE_NAMES) == 12
    row = {name: float(i) for i, name in enumerate(SCALAR_FEATURE_NAMES)}
    vec = scalar_feature_vector(row)
    assert vec.shape == (12,)
    assert vec.dtype == np.float32
    np.testing.assert_array_equal(vec, np.arange(12, dtype=np.float32))

def test_scalar_features_handles_none_as_nan():
    from scripts.detect_subjects.ml_labeler.features import scalar_feature_vector, SCALAR_FEATURE_NAMES
    row = {name: None for name in SCALAR_FEATURE_NAMES}
    vec = scalar_feature_vector(row)
    assert vec.shape == (12,)
    assert np.isnan(vec).all()
```

- [ ] **Step 2: Run test, expect fail**

```bash
.venv/bin/pytest tests/python/test_ml_labeler_features.py -v
```
Expected: `ModuleNotFoundError: ml_labeler.features`

- [ ] **Step 3: Implement features.py**

`scripts/detect_subjects/ml_labeler/features.py`:
```python
"""Scalar feature extraction for the ML labeler.

V1: 12 hand-engineered scalars already present in framing_detections.parquet.
Future: image-arm features (DINOv3 embeddings) go through a parallel module.
"""
from __future__ import annotations
import numpy as np

# Order matters — TabPFN trained columns must match prediction columns.
# These are all schema columns in framing_detections.parquet.
SCALAR_FEATURE_NAMES: list[str] = [
    "bbox_area_ratio",
    "offcenter",
    "bbox_min_edge_px",
    "bbox_long_edge_px",
    "mask_area_ratio",
    "lab_delta_e",
    "boundary_sharpness",
    "subject_sharpness",
    "top10pct_lap_mask",
    "edge_density_mask_vs_bg",
    "confidence",
    "n_distinct_detections",
]


def scalar_feature_vector(row: dict) -> np.ndarray:
    """Extract the 12-dim scalar feature vector from a polars-row dict.

    Missing/None values become NaN. TabPFN handles NaN natively; for sklearn
    consumers, downstream caller is responsible for imputation.
    """
    vals = []
    for name in SCALAR_FEATURE_NAMES:
        v = row.get(name)
        vals.append(float("nan") if v is None else float(v))
    return np.asarray(vals, dtype=np.float32)
```

- [ ] **Step 4: Run test, expect pass**

```bash
.venv/bin/pytest tests/python/test_ml_labeler_features.py -v
```
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add scripts/detect_subjects/ml_labeler/features.py tests/python/test_ml_labeler_features.py
git commit --no-gpg-sign -m "feat(ml_labeler): 12-scalar feature extraction with NaN-on-None semantics"
```

---

## Task 4: 5×5 stratified CV evaluator

**Files:**
- Create: `scripts/detect_subjects/ml_labeler/evaluation.py`
- Test: `tests/python/test_ml_labeler_evaluation.py`

- [ ] **Step 1: Write failing test**

`tests/python/test_ml_labeler_evaluation.py`:
```python
"""Verify 5x5 stratified CV produces MCC + PR-AUC + Brier metrics."""
import numpy as np

def test_cv_reports_three_metrics():
    from scripts.detect_subjects.ml_labeler.evaluation import cv_evaluate
    from sklearn.linear_model import LogisticRegression
    rng = np.random.default_rng(42)
    # 200 examples, 5 features, balanced binary target
    X = rng.standard_normal((200, 5)).astype(np.float32)
    y = (X[:, 0] > 0).astype(np.int8)
    result = cv_evaluate(
        clf_factory=lambda: LogisticRegression(max_iter=1000),
        X=X, y=y, n_splits=5, n_repeats=2, random_state=42,
    )
    assert set(result.keys()) == {"mcc_mean", "mcc_std", "pr_auc_mean", "brier_mean", "n_folds"}
    assert result["mcc_mean"] > 0.5  # easy linearly-separable task
    assert result["n_folds"] == 10
```

- [ ] **Step 2: Run test, expect fail**

```bash
.venv/bin/pytest tests/python/test_ml_labeler_evaluation.py -v
```
Expected: `ModuleNotFoundError: evaluation`

- [ ] **Step 3: Implement evaluation.py**

`scripts/detect_subjects/ml_labeler/evaluation.py`:
```python
"""5x5 stratified k-fold CV with MCC, PR-AUC, and Brier metrics per spec §6.

Why MCC over F1: Chicco & Jurman 2020 — F1 over-rewards trivial classifiers on
imbalanced data. MCC penalizes both classes symmetrically.
Why PR-AUC: ranking quality matters for the active-learning uncertainty sort.
Why Brier: calibration sanity for gate.py probability thresholds.
"""
from __future__ import annotations
from typing import Callable
import numpy as np
from sklearn.metrics import matthews_corrcoef, average_precision_score, brier_score_loss
from sklearn.model_selection import RepeatedStratifiedKFold


def cv_evaluate(
    clf_factory: Callable, X: np.ndarray, y: np.ndarray,
    n_splits: int = 5, n_repeats: int = 5, random_state: int = 42,
) -> dict:
    """5x5 stratified CV. clf_factory must produce a fresh fitted classifier
    with predict_proba support (sklearn-style) per call.

    Returns dict with mcc_mean, mcc_std, pr_auc_mean, brier_mean, n_folds.
    """
    rskf = RepeatedStratifiedKFold(
        n_splits=n_splits, n_repeats=n_repeats, random_state=random_state,
    )
    mccs, prs, briers = [], [], []
    for train_idx, test_idx in rskf.split(X, y):
        X_tr, X_te = X[train_idx], X[test_idx]
        y_tr, y_te = y[train_idx], y[test_idx]
        clf = clf_factory()
        clf.fit(X_tr, y_tr)
        prob_pos = clf.predict_proba(X_te)[:, 1]
        pred = (prob_pos >= 0.5).astype(np.int8)
        mccs.append(matthews_corrcoef(y_te, pred))
        # PR-AUC only meaningful when both classes present in test fold
        if len(np.unique(y_te)) == 2:
            prs.append(average_precision_score(y_te, prob_pos))
        briers.append(brier_score_loss(y_te, prob_pos))
    return {
        "mcc_mean": float(np.mean(mccs)),
        "mcc_std": float(np.std(mccs)),
        "pr_auc_mean": float(np.mean(prs)) if prs else float("nan"),
        "brier_mean": float(np.mean(briers)),
        "n_folds": n_splits * n_repeats,
    }
```

- [ ] **Step 4: Run test, expect pass**

```bash
.venv/bin/pytest tests/python/test_ml_labeler_evaluation.py -v
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/detect_subjects/ml_labeler/evaluation.py tests/python/test_ml_labeler_evaluation.py
git commit --no-gpg-sign -m "feat(ml_labeler): 5x5 stratified CV with MCC/PR-AUC/Brier reporters"
```

---

## Task 5: Training script — TabPFN on blur_unusable

**Files:**
- Create: `scripts/detect_subjects/ml_labeler/train.py`
- Test: `tests/python/test_ml_labeler_train.py`

- [ ] **Step 1: Write failing test**

`tests/python/test_ml_labeler_train.py`:
```python
"""Verify training script persists a fitted classifier with metrics."""
import json, tempfile
from pathlib import Path
import numpy as np
import polars as pl

def _fake_parquet_and_labels(tmpdir: Path):
    """Build a tiny synthetic parquet + labels.json with blur_unusable positives."""
    rng = np.random.default_rng(0)
    n = 80
    image_ids = [f"img-{i:03d}" for i in range(n)]
    # Make subject_sharpness predictive: positives have low sharpness
    sharpness = rng.uniform(100, 500, n)
    # First 40 are positives (blur_unusable) with lower sharpness
    sharpness[:40] -= 200
    df = pl.DataFrame({
        "image_id": image_ids,
        "variant": ["sam3__sam3"] * n,
        "bbox_x": [0.4] * n, "bbox_y": [0.4] * n,
        "bbox_w": [0.2] * n, "bbox_h": [0.2] * n,
        "bbox_area_ratio": [0.04] * n,
        "offcenter": [0.1] * n,
        "bbox_min_edge_px": [200.0] * n,
        "bbox_long_edge_px": [300.0] * n,
        "mask_area_ratio": [0.03] * n,
        "lab_delta_e": [15.0] * n,
        "boundary_sharpness": [5.0] * n,
        "subject_sharpness": sharpness.tolist(),
        "top10pct_lap_mask": [50.0] * n,
        "edge_density_mask_vs_bg": [1.5] * n,
        "confidence": [0.9] * n,
        "n_distinct_detections": [1] * n,
    })
    parquet_path = tmpdir / "test.parquet"
    df.write_parquet(parquet_path)
    labels = {}
    for i, iid in enumerate(image_ids):
        labels[iid] = {
            "col1": "bbox_correct-subject_not-clipped",
            "col2_count": "bbox-content_single",
            "col2_flags": [], "col4": [],
            "col3": ["mask_blur_unusable"] if i < 40 else [],
            "reviewed_at": 1, "user_edited": True,
            "variant_tag": "sam3__sam3", "unsure": False,
        }
    labels_path = tmpdir / "labels.json"
    labels_path.write_text(json.dumps(labels))
    return parquet_path, labels_path

def test_train_blur_unusable_persists_model_and_metrics(tmp_path):
    from scripts.detect_subjects.ml_labeler.train import train_label
    parquet_path, labels_path = _fake_parquet_and_labels(tmp_path)
    out_dir = tmp_path / "models" / "mask_blur_unusable"
    metrics = train_label(
        label="mask_blur_unusable",
        parquet_path=parquet_path, labels_path=labels_path,
        out_dir=out_dir, random_state=42,
    )
    assert (out_dir / "arm_scalar_latest.joblib").exists()
    assert (out_dir / "metrics.json").exists()
    assert metrics["arm_scalar"]["mcc_mean"] > 0.3  # easy synthetic task
    assert metrics["n_positives"] == 40
    assert metrics["n_total"] == 80
```

- [ ] **Step 2: Run test, expect fail**

```bash
.venv/bin/pytest tests/python/test_ml_labeler_train.py -v
```
Expected: `ModuleNotFoundError: train`

- [ ] **Step 3: Implement train.py**

`scripts/detect_subjects/ml_labeler/train.py`:
```python
"""Per-label training — V1: scalar-arm TabPFN-v2 for mask_blur_unusable.

Loads framing_detections.parquet + labels.json, builds (X, y) for one label,
runs 5x5 stratified CV, fits a final model on all data, persists joblib + metrics.

Future (Plan 2+): adds image arm (DINOv3+DoRA), runs both arms, picks winner.
"""
from __future__ import annotations
import json
import time
from pathlib import Path
from typing import Optional

import joblib
import numpy as np
import polars as pl

from scripts.detect_subjects.ml_labeler.features import (
    SCALAR_FEATURE_NAMES, scalar_feature_vector,
)
from scripts.detect_subjects.ml_labeler.evaluation import cv_evaluate


def _load_xy_for_label(
    parquet_path: Path, labels_path: Path, label: str,
) -> tuple[np.ndarray, np.ndarray, list[str]]:
    """Return X (n,12), y (n,), image_ids list. Only sam3__sam3 rows with a
    reviewed labels.json entry are included."""
    labels = json.loads(labels_path.read_text())
    df = pl.read_parquet(parquet_path).filter(pl.col("variant") == "sam3__sam3")
    X_rows, y_rows, ids = [], [], []
    for row in df.iter_rows(named=True):
        iid = row["image_id"]
        lbl = labels.get(iid)
        if not lbl or not lbl.get("reviewed_at") or not lbl.get("user_edited"):
            continue
        # Determine label class
        if label in (lbl.get("col3") or []):
            y_rows.append(1)
        elif lbl.get("col1") is not None or lbl.get("col2_count") is not None:
            # User looked at this card and chose not to mark this label.
            y_rows.append(0)
        else:
            continue  # truly empty label = unclear; skip
        X_rows.append(scalar_feature_vector(row))
        ids.append(iid)
    X = np.asarray(X_rows, dtype=np.float32)
    y = np.asarray(y_rows, dtype=np.int8)
    return X, y, ids


def _tabpfn_factory():
    """Fresh TabPFNClassifier per CV fold (in-context, no shared state)."""
    from tabpfn import TabPFNClassifier
    return TabPFNClassifier(device="cpu", n_jobs=1, ignore_pretraining_limits=True)


def train_label(
    label: str,
    parquet_path: Path = Path("data/cache/framing_detections.parquet"),
    labels_path: Path = Path("data/cache/labels.json"),
    out_dir: Optional[Path] = None,
    random_state: int = 42,
) -> dict:
    """Train scalar-arm TabPFN classifier for `label`. Returns metrics dict."""
    if out_dir is None:
        from scripts.detect_subjects.ml_labeler import MODELS_DIR
        out_dir = MODELS_DIR / label
    out_dir.mkdir(parents=True, exist_ok=True)

    X, y, ids = _load_xy_for_label(parquet_path, labels_path, label)
    n_pos = int(y.sum())
    n_total = len(y)
    print(f"[train:{label}] n_total={n_total}, n_positives={n_pos}")

    if n_pos < 5 or n_total - n_pos < 5:
        raise ValueError(
            f"Label {label!r} too imbalanced: {n_pos} pos / {n_total-n_pos} neg. "
            "Need >=5 of each class."
        )

    t0 = time.perf_counter()
    cv_metrics = cv_evaluate(_tabpfn_factory, X, y, n_splits=5, n_repeats=5,
                             random_state=random_state)
    cv_elapsed = time.perf_counter() - t0
    print(f"[train:{label}] CV ({cv_metrics['n_folds']} folds) in {cv_elapsed:.1f}s: "
          f"MCC={cv_metrics['mcc_mean']:.3f}±{cv_metrics['mcc_std']:.3f}, "
          f"PR-AUC={cv_metrics['pr_auc_mean']:.3f}, Brier={cv_metrics['brier_mean']:.3f}")

    # Final model on all data
    final_clf = _tabpfn_factory()
    final_clf.fit(X, y)
    model_path = out_dir / "arm_scalar_latest.joblib"
    joblib.dump({
        "label": label,
        "arm": "scalar",
        "clf": final_clf,
        "feature_names": SCALAR_FEATURE_NAMES,
        "n_train": n_total,
        "n_positives": n_pos,
        "trained_at": int(time.time()),
    }, model_path)
    print(f"[train:{label}] persisted → {model_path}")

    metrics = {
        "label": label,
        "n_total": n_total,
        "n_positives": n_pos,
        "arm_scalar": cv_metrics,
        "trained_at": int(time.time()),
        "cv_elapsed_s": round(cv_elapsed, 1),
    }
    (out_dir / "metrics.json").write_text(json.dumps(metrics, indent=2))
    return metrics


if __name__ == "__main__":
    import sys
    label = sys.argv[1] if len(sys.argv) > 1 else "mask_blur_unusable"
    train_label(label)
```

- [ ] **Step 4: Run test, expect pass**

```bash
.venv/bin/pytest tests/python/test_ml_labeler_train.py -v
```
Expected: PASS (may take 30-60s due to TabPFN warm-up).

- [ ] **Step 5: Train on real data and verify**

```bash
.venv/bin/python -m scripts.detect_subjects.ml_labeler.train mask_blur_unusable
```
Expected stdout:
```
[train:mask_blur_unusable] n_total=~238, n_positives=~91
[train:mask_blur_unusable] CV (25 folds) in ~Ns: MCC=0.X±0.X, PR-AUC=0.X, Brier=0.X
[train:mask_blur_unusable] persisted → .../arm_scalar_latest.joblib
```
Expected: MCC >= 0.40 (per research baseline F1≈0.70).

- [ ] **Step 6: Commit**

```bash
git add scripts/detect_subjects/ml_labeler/train.py tests/python/test_ml_labeler_train.py
git commit --no-gpg-sign -m "feat(ml_labeler): TabPFN-v2 training for mask_blur_unusable with 5x5 CV metrics"
```

---

## Task 6: Schema bump — predicted_<label>_p columns

**Files:**
- Modify: `scripts/detect_subjects/schema.py`
- Modify: `scripts/detect_subjects/config.py:83` (bump SCHEMA_VERSION 2→3)
- Test: `tests/python/test_ml_labeler_schema.py`

- [ ] **Step 1: Write failing test**

`tests/python/test_ml_labeler_schema.py`:
```python
"""Schema v3: predicted_mask_blur_unusable_p column exists in DetectionRow."""
def test_predicted_column_in_schema():
    from scripts.detect_subjects.schema import SCHEMA, DetectionRow
    field_names = {f.name for f in SCHEMA}
    assert "predicted_mask_blur_unusable_p" in field_names
    assert "predicted_mask_blur_unusable_unreliable" in field_names

def test_schema_version_3():
    from scripts.detect_subjects.config import SCHEMA_VERSION
    assert SCHEMA_VERSION == 3
```

- [ ] **Step 2: Run, expect fail**

```bash
.venv/bin/pytest tests/python/test_ml_labeler_schema.py -v
```
Expected: AssertionError on field membership.

- [ ] **Step 3: Modify schema.py**

In `scripts/detect_subjects/schema.py`, after the `edge_density_mask_vs_bg` field in BOTH `DetectionRow` dataclass and `SCHEMA` definition, add the new fields.

Add to `DetectionRow` after line declaring `edge_density_mask_vs_bg`:
```python
    predicted_mask_blur_unusable_p: Optional[float] = None
    predicted_mask_blur_unusable_unreliable: Optional[bool] = None
```

Add to `SCHEMA` pa.schema list after `("edge_density_mask_vs_bg", pa.float32()),`:
```python
    ("predicted_mask_blur_unusable_p", pa.float32()),
    ("predicted_mask_blur_unusable_unreliable", pa.bool_()),
```

- [ ] **Step 4: Bump SCHEMA_VERSION**

In `scripts/detect_subjects/config.py:83`:
```python
# v3 (2026-05-17): Phase 3 ML labeler — predicted_<label>_p + _unreliable columns
SCHEMA_VERSION = 3
```

- [ ] **Step 5: Run test, expect pass**

```bash
.venv/bin/pytest tests/python/test_ml_labeler_schema.py -v
```
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add scripts/detect_subjects/schema.py scripts/detect_subjects/config.py tests/python/test_ml_labeler_schema.py
git commit --no-gpg-sign -m "feat(schema): v3 adds predicted_mask_blur_unusable_p + _unreliable cols"
```

---

## Task 7: Batch predict + parquet write

**Files:**
- Create: `scripts/detect_subjects/ml_labeler/predict.py`
- Test: `tests/python/test_ml_labeler_predict.py`

- [ ] **Step 1: Write failing test**

`tests/python/test_ml_labeler_predict.py`:
```python
"""Verify batch predict writes probability columns to parquet."""
import json
from pathlib import Path
import numpy as np
import polars as pl

def _setup(tmp_path: Path):
    # Re-use the fake parquet + labels generator from test_ml_labeler_train.py
    from tests.python.test_ml_labeler_train import _fake_parquet_and_labels
    from scripts.detect_subjects.ml_labeler.train import train_label
    parquet_path, labels_path = _fake_parquet_and_labels(tmp_path)
    out_dir = tmp_path / "models" / "mask_blur_unusable"
    train_label("mask_blur_unusable", parquet_path, labels_path, out_dir, random_state=42)
    return parquet_path, out_dir

def test_predict_writes_columns(tmp_path):
    from scripts.detect_subjects.ml_labeler.predict import predict_label_into_parquet
    parquet_path, model_dir = _setup(tmp_path)
    n_updated = predict_label_into_parquet(
        label="mask_blur_unusable",
        parquet_path=parquet_path,
        model_path=model_dir / "arm_scalar_latest.joblib",
    )
    assert n_updated == 80
    df = pl.read_parquet(parquet_path)
    assert "predicted_mask_blur_unusable_p" in df.columns
    assert "predicted_mask_blur_unusable_unreliable" in df.columns
    probs = df["predicted_mask_blur_unusable_p"].to_numpy()
    assert (probs >= 0).all() and (probs <= 1).all()
    # First 40 are positives — mean prob should be higher than last 40
    assert probs[:40].mean() > probs[40:].mean()
```

- [ ] **Step 2: Run, expect fail**

```bash
.venv/bin/pytest tests/python/test_ml_labeler_predict.py -v
```
Expected: `ModuleNotFoundError: predict`

- [ ] **Step 3: Implement predict.py**

`scripts/detect_subjects/ml_labeler/predict.py`:
```python
"""Batch inference: load joblib classifier, predict probabilities for every
sam3__sam3 row in the parquet, write predicted_<label>_p and _unreliable cols.

V1: scalar-arm only. Future: image-arm and per-label winner-arm selection.
"""
from __future__ import annotations
from pathlib import Path
from typing import Optional

import joblib
import numpy as np
import polars as pl

from scripts.detect_subjects.ml_labeler.features import (
    SCALAR_FEATURE_NAMES, scalar_feature_vector,
)


def predict_label_into_parquet(
    label: str,
    parquet_path: Path = Path("data/cache/framing_detections.parquet"),
    model_path: Optional[Path] = None,
    unreliable_threshold: int = 30,
) -> int:
    """Run inference for `label` on all sam3 rows. Writes:
       predicted_<label>_p (float32), predicted_<label>_unreliable (bool).
    Returns count of rows updated."""
    if model_path is None:
        from scripts.detect_subjects.ml_labeler import MODELS_DIR
        model_path = MODELS_DIR / label / "arm_scalar_latest.joblib"
    bundle = joblib.load(model_path)
    clf = bundle["clf"]
    unreliable = bundle["n_positives"] < unreliable_threshold

    df = pl.read_parquet(parquet_path)
    sam3_mask = df["variant"] == "sam3__sam3"

    # Build feature matrix for sam3 rows only
    sam3_rows = df.filter(sam3_mask)
    X = np.stack([scalar_feature_vector(row) for row in sam3_rows.iter_rows(named=True)])

    probs = clf.predict_proba(X)[:, 1].astype(np.float32)

    # Build a mapping image_id → prob for sam3 rows, then join back
    sam3_ids = sam3_rows["image_id"].to_list()
    prob_map = dict(zip(sam3_ids, probs))

    p_col = f"predicted_{label}_p"
    u_col = f"predicted_{label}_unreliable"
    new_p = df["image_id"].map_elements(
        lambda i: float(prob_map.get(i, float("nan"))), return_dtype=pl.Float64
    ).cast(pl.Float32)
    new_u = df["image_id"].map_elements(
        lambda i: bool(unreliable) if i in prob_map else None, return_dtype=pl.Boolean
    )
    df = df.with_columns([new_p.alias(p_col), new_u.alias(u_col)])

    df.write_parquet(parquet_path)
    n = len(prob_map)
    print(f"[predict:{label}] updated {n} rows with prob+unreliable cols")
    return n


if __name__ == "__main__":
    import sys
    label = sys.argv[1] if len(sys.argv) > 1 else "mask_blur_unusable"
    predict_label_into_parquet(label)
```

- [ ] **Step 4: Run test, expect pass**

```bash
.venv/bin/pytest tests/python/test_ml_labeler_predict.py -v
```
Expected: PASS (may take 30-60s due to TabPFN re-fit in setup).

- [ ] **Step 5: Predict on real parquet**

```bash
.venv/bin/python -m scripts.detect_subjects.ml_labeler.predict mask_blur_unusable
```
Expected stdout:
```
[predict:mask_blur_unusable] updated 299 rows with prob+unreliable cols
```

Verify columns exist:
```bash
.venv/bin/python -c "import polars as pl; df = pl.read_parquet('data/cache/framing_detections.parquet'); print(df.select(['image_id', 'predicted_mask_blur_unusable_p', 'predicted_mask_blur_unusable_unreliable']).head(5))"
```
Expected: 5-row preview with non-null probability values.

- [ ] **Step 6: Commit**

```bash
git add scripts/detect_subjects/ml_labeler/predict.py tests/python/test_ml_labeler_predict.py
git commit --no-gpg-sign -m "feat(ml_labeler): batch predict writes predicted_<label>_p+unreliable to parquet"
```

---

## Task 8: build_html exposes predicted columns

**Files:**
- Modify: `scripts/detect_subjects/build_html.py` — add the two new columns to `data_json` output

- [ ] **Step 1: Inspect current data_json columns**

Read `scripts/detect_subjects/build_html.py` and locate where row-level columns are selected for the `data_json` payload (look for a polars select or dict comprehension that picks columns).

- [ ] **Step 2: Add the two predicted columns to the select list**

In `build_html.py`, find the column-projection block. Add to the projected columns:
```python
"predicted_mask_blur_unusable_p",
"predicted_mask_blur_unusable_unreliable",
```

- [ ] **Step 3: Rebuild HTML and verify**

```bash
.venv/bin/python -m scripts.detect_subjects.build_html sam3__sam3 2>&1 | tail -2
```
Expected: `wrote /Users/adoll/projects/line-of-bugs/tools/validator/sam3__sam3.html`

Verify column appears in generated HTML data:
```bash
grep -c "predicted_mask_blur_unusable_p" tools/validator/sam3__sam3.html
```
Expected: ≥299 (one per row in data_json).

- [ ] **Step 4: Commit**

```bash
git add scripts/detect_subjects/build_html.py
git commit --no-gpg-sign -m "feat(build_html): expose predicted_mask_blur_unusable_p+unreliable in data_json"
```

---

## Task 9: Validator UI — per-label tab strip

**Files:**
- Modify: `tools/validator/templates/index.html.j2`
  - Add tab strip HTML in `<header>`
  - Add JS state: `activeLabel` (null or label id)
  - Add tab CSS

- [ ] **Step 1: Add CSS for tab strip**

In `tools/validator/templates/index.html.j2`, in the `<style>` block (near the other header styles around line 8-18), add:
```css
  .tab-strip { display: flex; gap: 4px; flex-wrap: wrap; padding: 4px 24px; background: #16141a; border-bottom: 1px solid #28252e; }
  .tab-strip button {
    background: #1a1820; color: #aaa; border: 1px solid #444;
    border-radius: 4px; padding: 4px 10px; font-size: 12px; cursor: pointer;
    font-family: 'JetBrains Mono', monospace;
  }
  .tab-strip button.active { background: #4ac64a; color: #0d0c10; border-color: #4ac64a; font-weight: 600; }
  .tab-strip button:hover { color: #f5f5f5; border-color: #666; }
```

- [ ] **Step 2: Add tab strip HTML below `<header>`**

Find the closing `</header>` tag in the template. After it, before the `<div class="help">` block, insert:
```html
<div class="tab-strip" id="tabStrip">
  <button data-label="" class="active">all</button>
  <button data-label="mask_blur_unusable">blur_unusable</button>
</div>
```

- [ ] **Step 3: Add JS state + handler**

After `let MASK_CONTOURS = {};` (around line 240), add:
```js
// Active label tab — null shows all cards; otherwise filters + sorts by
// uncertainty (|predicted_p - 0.5| ascending = most-uncertain first).
let activeLabel = null;
```

In the startup wiring block (where `Promise.all([loadLabelsFromServer(), loadMaskContours()])` is), append the tab handler:
```js
document.getElementById('tabStrip').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-label]');
  if (!btn) return;
  activeLabel = btn.dataset.label || null;
  for (const b of document.querySelectorAll('#tabStrip button')) {
    b.classList.toggle('active', b === btn);
  }
  render();
});
```

- [ ] **Step 4: Rebuild + visual verify (playwright)**

```bash
.venv/bin/python -m scripts.detect_subjects.build_html sam3__sam3 2>&1 | tail -2
```

Then via browser: refresh http://localhost:8765/tools/validator/sam3__sam3.html. The tab strip should appear under the header with `[all]` and `[blur_unusable]` buttons.

- [ ] **Step 5: Commit**

```bash
git add tools/validator/templates/index.html.j2
git commit --no-gpg-sign -m "feat(validator-ui): per-label tab strip with all/blur_unusable buttons"
```

---

## Task 10: Validator UI — sort by uncertainty when a label tab is active

**Files:**
- Modify: `tools/validator/templates/index.html.j2` — update the `render()` sort logic to respect `activeLabel`

- [ ] **Step 1: Modify render() to sort by uncertainty when activeLabel set**

In `render()`, find the sortBy switch block (e.g., `else if (sortBy === "random") rows.sort(...)`). Replace the sort block with:
```js
  if (activeLabel) {
    // Active label: sort by uncertainty (|p - 0.5| ascending = most uncertain first)
    const probKey = "predicted_" + activeLabel + "_p";
    rows.sort((a, b) => {
      const pa = a[probKey] ?? 0.5;
      const pb = b[probKey] ?? 0.5;
      return Math.abs(pa - 0.5) - Math.abs(pb - 0.5);
    });
  } else if (sortBy === "random") rows.sort(() => Math.random() - 0.5);
  else if (sortBy === "bbox_area") rows.sort((a, b) => (a.bbox_area_ratio ?? 0) - (b.bbox_area_ratio ?? 0));
  else if (sortBy === "bbox_long_edge") rows.sort((a, b) => (a.bbox_long_edge_px ?? 0) - (b.bbox_long_edge_px ?? 0));
  else if (sortBy === "bbox_min_edge") rows.sort((a, b) => (a.bbox_min_edge_px ?? 0) - (b.bbox_min_edge_px ?? 0));
  else if (sortBy === "confidence") rows.sort((a, b) => (a.confidence ?? 0) - (b.confidence ?? 0));
  else if (sortBy === "lab_delta_e") rows.sort((a, b) => (a.lab_delta_e ?? 999) - (b.lab_delta_e ?? 999));
  else if (sortBy === "subject_sharpness") rows.sort((a, b) => (a.subject_sharpness ?? 1e9) - (b.subject_sharpness ?? 1e9));
```

- [ ] **Step 2: Rebuild + browser verify**

```bash
.venv/bin/python -m scripts.detect_subjects.build_html sam3__sam3 2>&1 | tail -2
```

Refresh validator. Click `blur_unusable` tab. The most-uncertain cards (predicted_p closest to 0.5) should appear first. Verify by inspecting predicted_p values on first few cards.

- [ ] **Step 3: Commit**

```bash
git add tools/validator/templates/index.html.j2
git commit --no-gpg-sign -m "feat(validator-ui): sort by |predicted_p - 0.5| asc when a label tab is active"
```

---

## Task 11: Validator UI — show predicted_p in each card

**Files:**
- Modify: `tools/validator/templates/index.html.j2` — emit a small `pred: 0.XX` badge near the relevant column header in each card

- [ ] **Step 1: Add CSS for pred badge**

In the `<style>` block, near the col header rules (around line 100), add:
```css
  .pred-badge { font-size: 9px; color: #67D4E6; font-weight: 400; margin-left: 6px; font-family: 'JetBrains Mono', monospace; }
  .pred-badge.unreliable { color: #888; }
```

- [ ] **Step 2: Modify the col3 header rendering to include a pred badge**

In `render()`, find the col3 column header construction (look for `<div class="col col3"><div class="col-header">Mask Rule</div>`). Replace with:
```js
        '<div class="col col3"><div class="col-header">Mask Rule' +
          (r.predicted_mask_blur_unusable_p != null
            ? '<span class="pred-badge' + (r.predicted_mask_blur_unusable_unreliable ? ' unreliable' : '') + '">blur_p=' + r.predicted_mask_blur_unusable_p.toFixed(2) + '</span>'
            : '') +
        '</div>' + col3HTML + '</div>' +
```

- [ ] **Step 3: Rebuild + visual verify**

```bash
.venv/bin/python -m scripts.detect_subjects.build_html sam3__sam3 2>&1 | tail -2
```

Refresh validator. Each card should now show a small cyan `blur_p=0.XX` next to "MASK RULE".

- [ ] **Step 4: Commit**

```bash
git add tools/validator/templates/index.html.j2
git commit --no-gpg-sign -m "feat(validator-ui): show blur_p prediction badge in card MASK RULE header"
```

---

## Task 12: Validator UI — retrain button + label-server endpoint

**Files:**
- Modify: `scripts/detect_subjects/label_server.py` — add POST /api/retrain/<label>
- Modify: `tools/validator/templates/index.html.j2` — add retrain button on each label tab

- [ ] **Step 1: Add /api/retrain endpoint to label_server.py**

After the `do_POST` method in `LabelServerHandler`, but before the `serve(...)` function, find the POST handler block and add a new branch. The do_POST currently only handles /api/labels — extend it to also handle /api/retrain/<label>:

In `do_POST`, before the existing `/api/labels` check, add:
```python
        if self.path.startswith("/api/retrain/"):
            label = self.path.split("/api/retrain/", 1)[1]
            import subprocess
            try:
                # Run training in subprocess so server stays responsive
                proc = subprocess.run(
                    [".venv/bin/python", "-m", "scripts.detect_subjects.ml_labeler.train", label],
                    cwd=str(PROJECT_ROOT), capture_output=True, text=True, timeout=600,
                )
                if proc.returncode != 0:
                    self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {
                        "error": "train failed", "stderr": proc.stderr[-2000:],
                    })
                    return
                # After training, run inference to update parquet
                proc2 = subprocess.run(
                    [".venv/bin/python", "-m", "scripts.detect_subjects.ml_labeler.predict", label],
                    cwd=str(PROJECT_ROOT), capture_output=True, text=True, timeout=300,
                )
                if proc2.returncode != 0:
                    self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {
                        "error": "predict failed", "stderr": proc2.stderr[-2000:],
                    })
                    return
                # Rebuild HTML so updated probabilities surface
                subprocess.run(
                    [".venv/bin/python", "-m", "scripts.detect_subjects.build_html", "sam3__sam3"],
                    cwd=str(PROJECT_ROOT), capture_output=True, text=True, timeout=60,
                )
                self._send_json(HTTPStatus.OK, {"ok": True, "label": label, "stdout": proc.stdout[-500:]})
            except subprocess.TimeoutExpired:
                self._send_json(HTTPStatus.GATEWAY_TIMEOUT, {"error": "training timeout"})
            return
```

- [ ] **Step 2: Add retrain button to tab strip**

In the template, modify the tab strip HTML to include a separate retrain button per label tab. Replace the tab strip block from Task 9 with:
```html
<div class="tab-strip" id="tabStrip">
  <button data-label="" class="active">all</button>
  <button data-label="mask_blur_unusable">blur_unusable</button>
  <button id="retrainBtn" style="margin-left:auto;background:#ef4444;color:#fff;border-color:#ef4444;display:none">retrain selected</button>
</div>
```

In the JS tab click handler, after `activeLabel = btn.dataset.label || null;`, add:
```js
  document.getElementById('retrainBtn').style.display = activeLabel ? 'inline-block' : 'none';
```

After the tab handler wiring, add the retrain click handler:
```js
document.getElementById('retrainBtn').addEventListener('click', async () => {
  if (!activeLabel) return;
  const btn = document.getElementById('retrainBtn');
  btn.disabled = true;
  btn.textContent = `retraining ${activeLabel}...`;
  try {
    const res = await fetch(`/api/retrain/${activeLabel}`, { method: 'POST' });
    const body = await res.json();
    if (res.ok) {
      btn.textContent = `done — reload page`;
      setTimeout(() => window.location.reload(), 1500);
    } else {
      btn.textContent = `failed: ${body.error || 'unknown'}`;
      btn.disabled = false;
    }
  } catch (e) {
    btn.textContent = `error: ${e.message}`;
    btn.disabled = false;
  }
});
```

- [ ] **Step 3: Restart label_server**

```bash
pgrep -f label_server | xargs -I{} kill {} 2>&1; sleep 1
nohup .venv/bin/python -m scripts.detect_subjects.label_server > /tmp/label_server.log 2>&1 &
sleep 2 && curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8765/api/labels
```
Expected: `200`

- [ ] **Step 4: Rebuild + click retrain**

```bash
.venv/bin/python -m scripts.detect_subjects.build_html sam3__sam3 2>&1 | tail -2
```

In browser: refresh, click `blur_unusable` tab, click `retrain selected`. After ~30-60s the page should reload with updated predictions.

- [ ] **Step 5: Commit**

```bash
git add scripts/detect_subjects/label_server.py tools/validator/templates/index.html.j2
git commit --no-gpg-sign -m "feat(ml_labeler): /api/retrain/<label> endpoint + retrain button in validator UI"
```

---

## Task 13: End-to-end smoke test

**Files:**
- Verify: full loop works on real data

- [ ] **Step 1: Train baseline**

```bash
.venv/bin/python -m scripts.detect_subjects.ml_labeler.train mask_blur_unusable
```

Record the printed MCC. Expected: >= 0.40 on the n≈238 labeled set.

- [ ] **Step 2: Run inference**

```bash
.venv/bin/python -m scripts.detect_subjects.ml_labeler.predict mask_blur_unusable
```

- [ ] **Step 3: Rebuild HTML**

```bash
.venv/bin/python -m scripts.detect_subjects.build_html sam3__sam3
```

- [ ] **Step 4: Verify visually**

Browser refresh. Click `blur_unusable` tab. Confirm:
- Cards reordered by uncertainty (top cards have predicted_p near 0.5)
- Each card shows `blur_p=0.XX` next to MASK RULE header
- `retrain selected` button visible

- [ ] **Step 5: Read metrics.json**

```bash
cat scripts/detect_subjects/ml_labeler/models/mask_blur_unusable/metrics.json
```

Expected: JSON with `arm_scalar.mcc_mean`, `n_positives ~91`, `cv_elapsed_s`.

---

## Self-review

**Spec coverage:** This thin-slice plan covers a subset of the full spec — by design. Coverage map:

| Spec section | This plan | Future plans |
|---|---|---|
| §architecture (scalar arm, per-label heads) | Tasks 2-7 | Plan 2 (image arm, DoRA, winner selection) |
| §active-learning loop (uncertainty sort, retrain button) | Tasks 9-12 | Plan 3 (k-means cold-start, BADGE) |
| §validator UI (tabs, sort, badges, retrain) | Tasks 9-12 | Plan 3 (per-label MCC display, banner) |
| §storage (predicted_<label>_p, _unreliable) | Task 6 | Plan 2 (extend to all 9 labels) |
| §integration with gate.py | — | Plan 4 |
| §evaluation (5x5 CV, MCC/PR-AUC/Brier) | Task 4 | already complete |
| §drift detection | — | Plan 4 |
| §caching & concurrency | Partial (TabPFN trains serially on 12 scalars; <60s) | Plan 2 (DINOv3 embed cache + ProcessPool) |
| §Cleanlab audit | — | Plan 4 |
| §rule_prior | — | Plan 4 |

**Placeholder scan:** None — every task has executable steps with concrete code.

**Type consistency:** Verified — `scalar_feature_vector`, `TIER1_LABELS`, `MODELS_DIR`, `predicted_<label>_p` used consistently across tasks. `train_label()` signature in Task 5 matches the test fixture call in Task 7.

**Frontend verification:** Tasks 9-12 require browser refresh + visual check via playwright (already wired in this repo). I should add explicit playwright screenshot steps if needed — left as inline notes for the implementer.

**Risk:** Task 12's retrain endpoint runs `subprocess.run` synchronously in the HTTP handler, blocking the server for up to 60 seconds during training. Acceptable for V1 (one user, single training); revisit in Plan 4 (move to a background thread + status polling).
