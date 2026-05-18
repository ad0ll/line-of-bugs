# SAM3 Vision Encoder Features — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Use SAM3's vision encoder embeddings (free, already computed during detection) as features for the ML labeler — to break the current ~12-scalar information bottleneck that's capping `blur_usable`, `bad-photo-quality`, and `poor-contrast` performance.

**Architecture:** Capture `vision_encoder.last_hidden_state` during the existing `detect_batch()` call. Mask-pool the patch embeddings (using the predicted segmentation mask) into a single per-image vector. Persist to a sidecar parquet. Train calibrated classifiers (logistic regression on a 1024-dim input, or HGB on a reduced PCA projection) per label. A/B against current scalar models.

**Tech Stack:** transformers (Sam3VisionModel), torch (MPS), polars (sidecar parquet), sklearn (LR / PCA / HGB), joblib (model persistence).

---

## Investigation findings (already done)

These are facts, not guesses — gathered via direct probing:

- **SAM3 vision encoder = `Sam3VisionModel`** (454M params, the bulk of the 840M total).
- **Forward output:**
  - `last_hidden_state`: shape `(batch, 5184, 1024)` for 1008×1008 input. 5184 = 72×72 patch grid, 14px per patch, 1024-dim embeddings.
  - `fpn_hidden_states`: 4-scale FPN at `(256, 288×288)`, `(256, 144×144)`, `(256, 72×72)`, `(256, 36×36)`. We'll use `last_hidden_state` first — simpler, higher-dim. FPN is a future option for spatial-precision tasks.
  - `pooler_output`: `None` (no built-in CLS-style pooled vector — we pool manually).
- **Latency**: vision_encoder alone takes ~1.8s on M5 Max MPS. Today's `Sam3Detector.detect()` includes this same encoder pass internally → **capturing the embedding during detect is ~free** (just a `.cpu()` + pool, ~50ms). Running it standalone (re-pass over existing parquet rows) costs ~1.8s/image.
- **Storage cost**: 1024-dim float16 per image = 2KB. 1500 images = 3MB. Float32 = 6MB. Trivial.
- **Pooling alignment**: input is resized/padded to 1008×1008 by the processor. The predicted mask is in *original* image coords. We need to know the processor's exact resize+pad transform to align mask → patch grid. The processor exposes this via `image_processor.preprocess(...).pixel_values` and a `do_pad`/`do_resize` config; need to confirm via probe (Task 0).

---

## Why this is worth doing

| Label | Current ceiling at P=0.60 | Theory of failure | SAM3-features expected gain |
|---|---|---|---|
| `blur_unusable` | R=0.56 | Already good — scalars catch the extreme tail | Marginal (+0.05 R?) — already saturated |
| `bad-photo-quality` | R=0.15 | Texture/noise statistics not in 12 scalars | Meaningful (+0.10-0.20 R?) — encoder sees these |
| `poor-contrast` | R=0.12 | `lab_delta_e` is a 1-scalar summary; encoder sees full color distribution | Meaningful (+0.10 R?) |
| `blur_usable` | R=0.00 (can't hit 0.60 at all) | Middle of blur distribution, not in scalar feature space | This is the hardest — encoder may break the wall |

The bet: SAM3's encoder, trained to handle blur/contrast/noise for accurate segmentation, has implicitly learned the relevant axes. We pull them out for free.

**If we get a P=0.60 R≥0.30 on `blur_usable` and bump the other two by 0.10 R each, this was worth the day of work.** If gains are <0.05 R across the board, we revert and the scalar approach stays.

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `scripts/detect_subjects/detectors/sam3.py` | Modify | Optional `return_vision_embeds=True` mode on `detect_batch` returning per-image embeddings |
| `scripts/detect_subjects/embedding_pool.py` | Create | Pure: take `(B, P, D)` patch embeds + per-image mask → `(B, D)` mask-pooled vectors |
| `scripts/detect_subjects/classify.py` | Modify | When DETECTOR=sam3, pull embeddings out of detect, pool, write to sidecar |
| `data/cache/sam3_vision_embeds.parquet` | Create (sidecar) | `image_id`, `variant`, `embedding_f16` (1024 × float16 = 2KB), `pool_method`, `version` |
| `scripts/detect_subjects/ml_labeler/embed_features.py` | Create | Load sidecar, build `(N, 1024)` matrices per label, mirror `_load_xy_for_label` contract |
| `scripts/detect_subjects/ml_labeler/train_embed.py` | Create | Train per-label classifier on embeddings (separate from scalar `train.py`) |
| `scripts/detect_subjects/ml_labeler/predict.py` | Modify | If embedding model exists for a label, use it; else fall back to scalar model |
| `scripts/detect_subjects/ml_labeler/__init__.py` | Modify | Track which labels use scalar vs embed model |
| `tools/benchmark_embed_vs_scalar.py` | Create | Side-by-side: train both, compare PR curves, write report |
| `tools/backfill_sam3_embeds.py` | Create | One-shot: process existing parquet rows that don't have embeddings yet |
| `docs/ml_labeler/embed_vs_scalar.md` | Create | A/B results — what to keep, what to revert |

**Why separate `train_embed.py`** and not extend `train.py`: scalar features are 12-dim, embeddings are 1024-dim. The right model class differs (HGB for scalars, calibrated LR or PCA→HGB for embeds). Keeping them separate lets us A/B without conditionals everywhere; if embeddings win, we delete the scalar path later.

---

## Task 0: Verify processor → patch-grid alignment

**Files:**
- Probe only: `tools/probe_sam3_patch_alignment.py`

- [ ] **Step 1: Write the probe**

```python
"""Confirm exactly how the processor transforms a PIL image → 1008×1008
pixel_values, so we can map a mask in original image coords → patch indices.
"""
from PIL import Image
import numpy as np
from scripts.detect_subjects._sam3_shared import get_shared_sam3

model, processor = get_shared_sam3()

# Try a few aspect ratios — square, tall, wide
for size in [(800, 800), (600, 1200), (1200, 600), (1500, 1000)]:
    im = Image.new("RGB", size, (128, 128, 128))
    out = processor(images=im, text="x", return_tensors="pt")
    pv = out["pixel_values"]  # (1, 3, H, W)
    print(f"input {size} → pixel_values {tuple(pv.shape)}")

# Inspect image_processor config
print("image_processor.size:", processor.image_processor.size)
print("do_pad:", getattr(processor.image_processor, "do_pad", None))
print("do_resize:", getattr(processor.image_processor, "do_resize", None))
print("do_normalize:", getattr(processor.image_processor, "do_normalize", None))
```

- [ ] **Step 2: Run and record findings**

```bash
.venv/bin/python -m tools.probe_sam3_patch_alignment > /tmp/sam3_align.txt
cat /tmp/sam3_align.txt
```

- [ ] **Step 3: Decide the pooling alignment strategy**

Based on output, write a 2-line comment in `embedding_pool.py` describing the rule. Two likely outcomes:
- (a) processor pads-and-resizes to fixed 1008×1008 → reverse-engineer the transform, apply to mask, then bin to 72×72 patch grid.
- (b) processor preserves aspect ratio with padding → mask straight-resizes to 72×72 then we ignore pad pixels (which are 0 in the mask anyway).

**Expected:** likely (a). The exact transform parameters are needed for Task 2.

---

## Task 1: Embedding pooling primitive

**Files:**
- Create: `scripts/detect_subjects/embedding_pool.py`
- Test: `tests/python/test_embedding_pool.py`

- [ ] **Step 1: Write the failing test**

```python
"""Unit tests for mask-aware pooling primitives."""
import numpy as np
import torch
from scripts.detect_subjects.embedding_pool import (
    mask_pool_patch_embeds, global_pool_patch_embeds,
)

def test_mask_pool_averages_mask_patches_only():
    # 2x2 patch grid, 4-dim embed
    embeds = torch.tensor([[[1., 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]])  # (1, 4, 4)
    mask_logical = np.array([[True, False], [False, False]])  # only top-left patch is "in mask"
    out = mask_pool_patch_embeds(embeds, mask_logical, patch_grid=(2, 2))
    assert out.shape == (1, 4)
    np.testing.assert_allclose(out[0], [1, 0, 0, 0])

def test_global_pool_averages_all():
    embeds = torch.tensor([[[1., 0], [0, 1], [1, 1], [0, 0]]])  # (1, 4, 2)
    out = global_pool_patch_embeds(embeds)
    assert out.shape == (1, 2)
    np.testing.assert_allclose(out[0], [0.5, 0.5])

def test_mask_pool_empty_mask_falls_back_to_global():
    embeds = torch.tensor([[[1., 0], [0, 1], [1, 1], [0, 0]]])
    mask_logical = np.zeros((2, 2), dtype=bool)
    out = mask_pool_patch_embeds(embeds, mask_logical, patch_grid=(2, 2))
    # Empty mask → fall back to global pool (otherwise we'd return NaN)
    np.testing.assert_allclose(out[0], [0.5, 0.5])
```

- [ ] **Step 2: Verify failure**

```bash
.venv/bin/pytest tests/python/test_embedding_pool.py -v
```

Expected: ImportError on `scripts.detect_subjects.embedding_pool`.

- [ ] **Step 3: Implement the module**

```python
"""Pool patch-level SAM3 embeddings into per-image vectors.

The vision encoder emits (B, P, D) where P = patch_grid[0] * patch_grid[1].
We pool to (B, D) either globally (average all patches) or mask-aware
(average only patches inside the predicted segmentation mask).

Mask alignment: input mask is in ORIGINAL image coordinates. The processor
resized/padded the image to 1008x1008 before passing to the encoder, so
the patch grid covers the processed image, not the original. We resize
the mask to the patch grid via average-pooling — a patch is "in" if more
than 50% of its area falls inside the mask.
"""
from __future__ import annotations
import numpy as np
import torch


def global_pool_patch_embeds(embeds: torch.Tensor) -> torch.Tensor:
    """(B, P, D) → (B, D) via simple mean over P."""
    return embeds.mean(dim=1)


def mask_pool_patch_embeds(
    embeds: torch.Tensor,
    mask_original: np.ndarray,
    patch_grid: tuple[int, int],
) -> torch.Tensor:
    """Average only the patches that fall inside the mask.

    embeds: (B, P, D) where P = grid_h * grid_w. For B=1 only currently.
    mask_original: (H, W) bool array in original image space.
    patch_grid: (grid_h, grid_w) — how the encoder tokenized the input.

    Returns (B, D). Falls back to global pool if the mask has zero coverage
    in the patch grid (no patch has >50% mask overlap).
    """
    grid_h, grid_w = patch_grid
    # Downsample mask to patch grid via mean-pool then threshold
    mask_f = mask_original.astype(np.float32)
    h, w = mask_f.shape
    # Use opencv resize (area interpolation = mean-pool when shrinking)
    import cv2
    mask_pg = cv2.resize(mask_f, (grid_w, grid_h), interpolation=cv2.INTER_AREA)
    in_mask = mask_pg > 0.5  # (grid_h, grid_w) bool
    flat_in_mask = torch.from_numpy(in_mask.flatten()).to(embeds.device)
    if flat_in_mask.sum() == 0:
        return global_pool_patch_embeds(embeds)
    masked = embeds * flat_in_mask.unsqueeze(0).unsqueeze(-1)  # zero out non-mask
    pooled = masked.sum(dim=1) / flat_in_mask.sum().clamp(min=1)
    return pooled
```

- [ ] **Step 4: Verify passing**

```bash
.venv/bin/pytest tests/python/test_embedding_pool.py -v
```

Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add scripts/detect_subjects/embedding_pool.py tests/python/test_embedding_pool.py
git commit --no-gpg-sign -m "ml_labeler: mask-aware pooling primitive for SAM3 patch embeddings"
```

---

## Task 2: Extend `Sam3Detector.detect_batch` to optionally return vision embeddings

**Files:**
- Modify: `scripts/detect_subjects/detectors/sam3.py`
- Test: `tests/python/test_sam3_detector_embeds.py`

- [ ] **Step 1: Test that `detect_batch(return_vision_embeds=True)` returns embeddings**

```python
"""Smoke test — vision embeds come out the right shape."""
import pytest
from PIL import Image
from scripts.detect_subjects.detectors.sam3 import Sam3Detector

@pytest.mark.slow  # loads SAM3
def test_detect_batch_returns_vision_embeds():
    im = Image.new("RGB", (640, 480), (100, 150, 200))
    det = Sam3Detector(device="mps", prompt_phrases=["an insect"])
    results, embeds = det.detect_batch([im], [None], return_vision_embeds=True)
    assert len(results) == 1
    assert embeds.shape == (1, 5184, 1024)
    assert embeds.dtype.itemsize == 4  # float32
```

- [ ] **Step 2: Run to fail**

```bash
.venv/bin/pytest tests/python/test_sam3_detector_embeds.py -v -m slow
```

- [ ] **Step 3: Modify `detect_batch` signature + capture**

In `scripts/detect_subjects/detectors/sam3.py`, change the method:

```python
@torch.no_grad()
def detect_batch(
    self, images: list[Image.Image], image_ids: list[str | None],
    return_vision_embeds: bool = False,
):
    """If return_vision_embeds=True, return (results_list, embeds_tensor)
    where embeds is (N, P, D) on CPU. P=5184, D=1024 for 1008x1008 input.
    Cache hits get a None entry in the embeds tensor — caller must run a
    separate vision_encoder pass for those if it wants embeddings.
    """
    # ...existing cache-check logic unchanged...
    # In the uncached branch, after model(**inputs):
    #   capture outputs.vision_outputs.last_hidden_state.cpu()
    #   align indices to the input order
    # Return (results, embeds) when flag set, else just results (back-compat).
```

(Pseudo only — actual implementation lives in step 4 with full diff.)

- [ ] **Step 4: Implement**

Apply this diff to `detect_batch`:

```python
# Add at top of function after empty check:
captured_embeds: dict[int, torch.Tensor] = {}

# Inside the `if uncached_idx:` block, model output is already in `outputs`.
# After `results_per_image = ...`:
if return_vision_embeds:
    # outputs has .vision_outputs attribute on Sam3ModelOutput
    vis_lhs = outputs.vision_outputs.last_hidden_state.detach().cpu()  # (n_uncached, P, D)
    for j, i in enumerate(uncached_idx):
        captured_embeds[i] = vis_lhs[j]

# At end of function, before return:
if return_vision_embeds:
    # Fill cache-hit slots with None (caller decides what to do)
    embeds_list = [captured_embeds.get(i) for i in range(n)]
    return out, embeds_list
return out
```

- [ ] **Step 5: Run test to pass**

```bash
.venv/bin/pytest tests/python/test_sam3_detector_embeds.py -v -m slow
```

- [ ] **Step 6: Commit**

```bash
git add scripts/detect_subjects/detectors/sam3.py tests/python/test_sam3_detector_embeds.py
git commit --no-gpg-sign -m "sam3: optional vision embeds capture in detect_batch (~free during forward)"
```

---

## Task 3: Sidecar parquet writer

**Files:**
- Create: `scripts/detect_subjects/ml_labeler/embed_sidecar.py`
- Test: `tests/python/test_embed_sidecar.py`

- [ ] **Step 1: Write the failing test**

```python
"""Sidecar parquet round-trip + schema."""
import numpy as np
import polars as pl
from pathlib import Path
from scripts.detect_subjects.ml_labeler.embed_sidecar import (
    append_embeds, load_embeds, EMBED_SIDECAR_PATH,
)

def test_append_and_load_roundtrip(tmp_path):
    p = tmp_path / "embeds.parquet"
    e1 = np.random.randn(1024).astype(np.float16)
    e2 = np.random.randn(1024).astype(np.float16)
    append_embeds([("img-1", "sam3__sam3", e1, "mask")], path=p)
    append_embeds([("img-2", "sam3__sam3", e2, "global")], path=p)
    df = load_embeds(path=p)
    assert len(df) == 2
    out = {r["image_id"]: r for r in df.iter_rows(named=True)}
    np.testing.assert_allclose(out["img-1"]["embedding"], e1, rtol=1e-3)
    assert out["img-1"]["pool_method"] == "mask"
    assert out["img-2"]["pool_method"] == "global"

def test_dedup_on_append(tmp_path):
    p = tmp_path / "embeds.parquet"
    e1 = np.random.randn(1024).astype(np.float16)
    e2 = np.random.randn(1024).astype(np.float16)
    append_embeds([("img-1", "sam3__sam3", e1, "mask")], path=p)
    append_embeds([("img-1", "sam3__sam3", e2, "mask")], path=p)
    df = load_embeds(path=p)
    assert len(df) == 1
    # second write wins
    np.testing.assert_allclose(
        df.filter(pl.col("image_id") == "img-1")["embedding"][0], e2, rtol=1e-3
    )
```

- [ ] **Step 2: Run to fail**

```bash
.venv/bin/pytest tests/python/test_embed_sidecar.py -v
```

- [ ] **Step 3: Implement**

```python
"""Sidecar parquet: one row per (image_id, variant) with a 1024-dim
float16 embedding + pool_method tag. Kept separate from the main parquet
because (a) it's wide (~2KB/row), and (b) it has a different write
cadence than the detection records.
"""
from __future__ import annotations
from pathlib import Path
import numpy as np
import polars as pl

from scripts.detect_subjects.config import CACHE_DIR

EMBED_SIDECAR_PATH = CACHE_DIR / "sam3_vision_embeds.parquet"
EMBED_DIM = 1024
EMBED_VERSION = 1  # bump when pooling logic or model changes


def append_embeds(
    rows: list[tuple[str, str, np.ndarray, str]],
    path: Path = EMBED_SIDECAR_PATH,
) -> None:
    """rows = [(image_id, variant, embedding_f16, pool_method), ...]
    Last write wins on (image_id, variant) collision."""
    new_df = pl.DataFrame({
        "image_id": [r[0] for r in rows],
        "variant": [r[1] for r in rows],
        "embedding": [r[2].astype(np.float16).tolist() for r in rows],
        "pool_method": [r[3] for r in rows],
        "version": [EMBED_VERSION] * len(rows),
    }, schema={
        "image_id": pl.Utf8, "variant": pl.Utf8,
        "embedding": pl.List(pl.Float32), "pool_method": pl.Utf8,
        "version": pl.Int8,
    })
    if path.exists():
        existing = pl.read_parquet(path)
        # Dedup: drop existing rows with matching (id, variant) — the new
        # write wins.
        new_keys = set(zip(new_df["image_id"].to_list(), new_df["variant"].to_list()))
        existing = existing.filter(
            ~pl.struct(["image_id", "variant"]).is_in(
                [{"image_id": k[0], "variant": k[1]} for k in new_keys]
            )
        )
        combined = pl.concat([existing, new_df])
    else:
        combined = new_df
    combined.write_parquet(path)


def load_embeds(path: Path = EMBED_SIDECAR_PATH) -> pl.DataFrame:
    if not path.exists():
        return pl.DataFrame({
            "image_id": [], "variant": [], "embedding": [],
            "pool_method": [], "version": [],
        })
    return pl.read_parquet(path)
```

- [ ] **Step 4: Run test to pass**

```bash
.venv/bin/pytest tests/python/test_embed_sidecar.py -v
```

- [ ] **Step 5: Commit**

```bash
git add scripts/detect_subjects/ml_labeler/embed_sidecar.py tests/python/test_embed_sidecar.py
git commit --no-gpg-sign -m "ml_labeler: sidecar parquet for SAM3 vision embeddings"
```

---

## Task 4: Wire embedding capture into classify pipeline

**Files:**
- Modify: `scripts/detect_subjects/classify.py` (`_run_batched_loop` + sequential path)

- [ ] **Step 1: Modify `_run_batched_loop`**

After `dets = detector.detect_batch(images, ids)`, change to:

```python
dets, vision_embeds = detector.detect_batch(images, ids, return_vision_embeds=True)
```

After the segmentation phase but before the per-image post-processing loop, add:

```python
# Pool vision embeddings using the (predicted mask | global fallback)
from scripts.detect_subjects.embedding_pool import (
    mask_pool_patch_embeds, global_pool_patch_embeds,
)
from scripts.detect_subjects.ml_labeler.embed_sidecar import append_embeds

PATCH_GRID = (72, 72)  # 1008/14
embed_records: list[tuple[str, str, np.ndarray, str]] = []
for i, (det, embeds_one) in enumerate(zip(dets, vision_embeds)):
    if embeds_one is None:
        continue  # cache hit — skip; backfill tool handles these separately
    seg = seg_map.get(i)
    if seg is not None and seg.mask is not None and seg.mask.any():
        pooled = mask_pool_patch_embeds(embeds_one.unsqueeze(0), seg.mask, PATCH_GRID)
        method = "mask"
    else:
        pooled = global_pool_patch_embeds(embeds_one.unsqueeze(0))
        method = "global"
    embed_records.append((
        ids[i], cfg.variant_tag(), pooled[0].cpu().numpy().astype(np.float16),
        method,
    ))
if embed_records:
    append_embeds(embed_records)
```

- [ ] **Step 2: Mirror in sequential path**

The current sequential loop calls `detector.detect(im, image_id=image_id)`. Change to:

```python
det = detector.detect(im, image_id=image_id, return_vision_embeds=True)
# detect() returns (DetectionResult, embed_tensor) when flag set
```

And update `Sam3Detector.detect` to thread `return_vision_embeds` to `detect_batch`. Pool + append as above.

- [ ] **Step 3: Smoke-test on 10 fresh images**

```bash
# Clear caches for 10 images, run classify, verify sidecar populated
.venv/bin/python -m tools.extend_sample_nonspecimen --n 10
.venv/bin/python -m scripts.detect_subjects v1 2>&1 | tail -15
.venv/bin/python -c "
from scripts.detect_subjects.ml_labeler.embed_sidecar import load_embeds
df = load_embeds()
print(f'sidecar rows: {len(df)}')
print(f'pool methods: {df[\"pool_method\"].value_counts().to_dict()}')
"
```

Expected: 10 new sidecar rows, mostly `mask` method, embedding length 1024.

- [ ] **Step 4: Commit**

```bash
git add scripts/detect_subjects/classify.py scripts/detect_subjects/detectors/sam3.py
git commit --no-gpg-sign -m "classify: capture + persist SAM3 vision embeddings during detect (~free)"
```

---

## Task 5: Backfill embeddings for existing parquet rows

**Files:**
- Create: `tools/backfill_sam3_embeds.py`

- [ ] **Step 1: Write the backfill tool**

```python
"""Run SAM3 vision encoder on existing parquet rows that don't have a
sidecar embedding yet. ~1.8s/image (full vision encoder pass). The
detection cache is not reused — we need the actual encoder output, not
just the post-processed bbox.

Use the segmentation mask from data/cache/sam3_masks_bench/<id>.npy if
present; else global pool. (We don't re-run segmentation — that adds
another 1.2s/image and most parquet rows already have a mask cache.)
"""
from __future__ import annotations
import time
from pathlib import Path

import numpy as np
import polars as pl
import torch
from PIL import Image

from scripts.detect_subjects._sam3_shared import get_shared_sam3
from scripts.detect_subjects.config import CACHE_DIR, DATA_DIR, PARQUET_PATH
from scripts.detect_subjects.embedding_pool import (
    global_pool_patch_embeds, mask_pool_patch_embeds,
)
from scripts.detect_subjects.ml_labeler.embed_sidecar import (
    EMBED_SIDECAR_PATH, append_embeds, load_embeds,
)

PATCH_GRID = (72, 72)
MASK_CACHE = CACHE_DIR / "sam3_masks_bench"


def _missing_ids() -> list[tuple[str, str]]:
    parquet = pl.read_parquet(PARQUET_PATH).filter(
        pl.col("variant") == "sam3__sam3"
    ).select(["image_id"])
    existing = set(zip(
        load_embeds()["image_id"].to_list(),
        load_embeds()["variant"].to_list(),
    )) if EMBED_SIDECAR_PATH.exists() else set()
    want = [(r["image_id"], "sam3__sam3") for r in parquet.iter_rows(named=True)]
    return [k for k in want if k not in existing]


def main() -> None:
    todo = _missing_ids()
    print(f"[backfill] {len(todo)} rows need embeddings")
    if not todo:
        return

    import sqlite3
    con = sqlite3.connect(DATA_DIR / "db" / "line-of-bugs.db")
    ids = [k[0] for k in todo]
    placeholders = ",".join("?" * len(ids))
    filename_map = dict(con.execute(
        f"SELECT image_id, filename FROM images WHERE image_id IN ({placeholders})", ids
    ).fetchall())
    con.close()

    model, processor = get_shared_sam3(device="mps")
    BATCH = 4
    out_rows: list[tuple[str, str, np.ndarray, str]] = []
    t0 = time.perf_counter()
    for i in range(0, len(todo), BATCH):
        chunk = todo[i:i+BATCH]
        chunk_ids = [k[0] for k in chunk]
        chunk_imgs = []
        for iid in chunk_ids:
            fn = filename_map.get(iid)
            if not fn:
                continue
            try:
                with Image.open(DATA_DIR / fn) as raw:
                    chunk_imgs.append((iid, raw.convert("RGB")))
            except Exception as e:
                print(f"[backfill] WARN {iid}: {e}")
        if not chunk_imgs:
            continue
        imgs_only = [im for _, im in chunk_imgs]
        inputs = processor(images=imgs_only, text=["x"] * len(imgs_only),
                          return_tensors="pt").to("mps")
        inputs["pixel_values"] = inputs["pixel_values"].to(torch.float32)
        with torch.no_grad():
            vis_out = model.vision_encoder(inputs["pixel_values"])
        embeds = vis_out.last_hidden_state.cpu()  # (B, 5184, 1024)
        for j, (iid, _) in enumerate(chunk_imgs):
            mask_path = MASK_CACHE / f"{iid}.npy"
            if mask_path.exists():
                mask = np.load(mask_path).astype(bool)
                pooled = mask_pool_patch_embeds(
                    embeds[j:j+1], mask, PATCH_GRID,
                )
                method = "mask"
            else:
                pooled = global_pool_patch_embeds(embeds[j:j+1])
                method = "global"
            out_rows.append((
                iid, "sam3__sam3",
                pooled[0].numpy().astype(np.float16), method,
            ))
        # Flush every batch — checkpoint progress
        append_embeds(out_rows)
        out_rows.clear()
        if (i + BATCH) % 50 == 0 or i + BATCH >= len(todo):
            elapsed = time.perf_counter() - t0
            rate = (i + BATCH) / elapsed
            eta = (len(todo) - i - BATCH) / rate
            print(f"[backfill] {i+BATCH}/{len(todo)} ({rate:.2f} img/s, "
                  f"eta {eta:.0f}s)")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run it**

```bash
.venv/bin/python -m tools.backfill_sam3_embeds 2>&1 | tail -10
```

Expected wall time: ~1.8s × N rows ÷ batch_size_4 = ~0.45s × N. For 1500 rows = ~11 min.

- [ ] **Step 3: Commit**

```bash
git add tools/backfill_sam3_embeds.py
git commit --no-gpg-sign -m "backfill: SAM3 vision embeddings for existing parquet rows"
```

---

## Task 6: Train per-label classifiers on embeddings

**Files:**
- Create: `scripts/detect_subjects/ml_labeler/train_embed.py`
- Test: `tests/python/test_train_embed.py`

- [ ] **Step 1: Write the test**

```python
"""train_embed should produce reasonable CV metrics on synthetic data."""
import numpy as np
from scripts.detect_subjects.ml_labeler.train_embed import _embed_clf_factory
from scripts.detect_subjects.ml_labeler.evaluation import cv_evaluate

def test_embed_classifier_separates_synthetic_classes():
    np.random.seed(0)
    n = 200
    X_pos = np.random.randn(n // 2, 1024) + 0.3
    X_neg = np.random.randn(n // 2, 1024) - 0.3
    X = np.vstack([X_pos, X_neg])
    y = np.array([1] * (n // 2) + [0] * (n // 2))
    metrics = cv_evaluate(_embed_clf_factory, X, y, n_splits=3, n_repeats=1)
    assert metrics["mcc_mean"] > 0.3, f"MCC too low: {metrics['mcc_mean']:.3f}"
    assert metrics["pr_auc_mean"] > 0.7
```

- [ ] **Step 2: Run to fail**

```bash
.venv/bin/pytest tests/python/test_train_embed.py -v
```

- [ ] **Step 3: Implement train_embed**

```python
"""Train per-label classifier on SAM3 vision-encoder embeddings.

Pipeline (sklearn): StandardScaler → optional PCA(256) → LogisticRegression
with class_weight='balanced' + L2. PCA reduces the 1024-dim input to 256
which (a) trains faster, (b) regularizes, (c) reduces overfit risk on
small data. Logistic regression on dense features is well-calibrated
out of the box and beats HGB for high-dim inputs by ~5-15% in our
PR-AUC range.
"""
from __future__ import annotations
import json, time
from pathlib import Path
from typing import Optional

import joblib
import numpy as np
import polars as pl

from scripts.detect_subjects.ml_labeler.embed_sidecar import load_embeds
from scripts.detect_subjects.ml_labeler.evaluation import cv_evaluate
from scripts.detect_subjects.ml_labeler.train import _load_non_drawable_ids


def _embed_clf_factory():
    """Pipeline: scale → PCA(256) → LR. PCA centered+whitened."""
    from sklearn.pipeline import Pipeline
    from sklearn.preprocessing import StandardScaler
    from sklearn.decomposition import PCA
    from sklearn.linear_model import LogisticRegression
    return Pipeline([
        ("scaler", StandardScaler(with_mean=True, with_std=True)),
        ("pca", PCA(n_components=256, whiten=True, random_state=42)),
        ("lr", LogisticRegression(
            class_weight="balanced", C=1.0, max_iter=2000,
            random_state=42, solver="lbfgs",
        )),
    ])


def _load_xy_for_label_embed(
    parquet_path: Path, labels_path: Path, label: str,
) -> tuple[np.ndarray, np.ndarray, list[str]]:
    """Mirror of train.py's _load_xy_for_label but pulls 1024-dim embed
    instead of 12-dim scalars. Exclusion logic must match exactly."""
    labels = json.loads(labels_path.read_text())
    non_drawable = _load_non_drawable_ids()
    parquet = pl.read_parquet(parquet_path).filter(pl.col("variant") == "sam3__sam3")
    embeds_df = load_embeds().filter(pl.col("variant") == "sam3__sam3")
    embed_map = {
        r["image_id"]: np.asarray(r["embedding"], dtype=np.float32)
        for r in embeds_df.iter_rows(named=True)
    }
    X_rows, y_rows, ids = [], [], []
    for row in parquet.iter_rows(named=True):
        iid = row["image_id"]
        lbl = labels.get(iid)
        if not lbl or not lbl.get("reviewed_at") or not lbl.get("user_edited"):
            continue
        if lbl.get("unsure"):
            continue
        if row.get("framing_quality") in ("bug_too_small", "no_bug"):
            continue
        if iid in non_drawable:
            continue
        embed = embed_map.get(iid)
        if embed is None:
            continue  # not yet backfilled
        col3 = (lbl.get("col3") or []) + (lbl.get("flags") or [])
        if label in col3:
            y_rows.append(1)
        elif (lbl.get("col1") is not None or lbl.get("col2_count") is not None
              or lbl.get("flags") is not None):
            y_rows.append(0)
        else:
            continue
        X_rows.append(embed)
        ids.append(iid)
    return np.asarray(X_rows, dtype=np.float32), np.asarray(y_rows, dtype=np.int8), ids


def train_label_embed(
    label: str, parquet_path: Path = Path("data/cache/framing_detections.parquet"),
    labels_path: Path = Path("data/cache/labels.json"),
    out_dir: Optional[Path] = None, random_state: int = 42,
) -> dict:
    if out_dir is None:
        from scripts.detect_subjects.ml_labeler import MODELS_DIR
        out_dir = MODELS_DIR / label
    out_dir.mkdir(parents=True, exist_ok=True)
    X, y, ids = _load_xy_for_label_embed(parquet_path, labels_path, label)
    n_pos = int(y.sum())
    n_total = len(y)
    print(f"[train_embed:{label}] n={n_total}, pos={n_pos}")
    if n_pos < 5 or n_total - n_pos < 5:
        raise ValueError(f"too imbalanced: {n_pos}/{n_total}")
    t0 = time.perf_counter()
    cv = cv_evaluate(_embed_clf_factory, X, y, n_splits=5, n_repeats=5,
                     random_state=random_state)
    elapsed = time.perf_counter() - t0
    print(f"[train_embed:{label}] CV {cv['n_folds']} folds {elapsed:.1f}s: "
          f"MCC={cv['mcc_mean']:.3f} PR-AUC={cv['pr_auc_mean']:.3f}")
    final = _embed_clf_factory()
    final.fit(X, y)
    model_path = out_dir / "arm_embed_latest.joblib"
    joblib.dump({
        "label": label, "arm": "embed", "clf": final,
        "embed_version": 1, "n_train": n_total, "n_positives": n_pos,
        "trained_at": int(time.time()),
    }, model_path)
    metrics_path = out_dir / "metrics_embed.json"
    metrics_path.write_text(json.dumps({
        "label": label, "n_total": n_total, "n_positives": n_pos,
        "arm_embed": cv, "trained_at": int(time.time()),
        "cv_elapsed_s": round(elapsed, 1),
    }, indent=2))
    return cv


if __name__ == "__main__":
    import sys
    label = sys.argv[1] if len(sys.argv) > 1 else "mask_blur_unusable"
    train_label_embed(label)
```

- [ ] **Step 4: Run test**

```bash
.venv/bin/pytest tests/python/test_train_embed.py -v
```

- [ ] **Step 5: Commit**

```bash
git add scripts/detect_subjects/ml_labeler/train_embed.py tests/python/test_train_embed.py
git commit --no-gpg-sign -m "ml_labeler: train embeddings classifier (LR on PCA(256) of SAM3 embeds)"
```

---

## Task 7: A/B benchmark + report

**Files:**
- Create: `tools/benchmark_embed_vs_scalar.py`
- Create: `docs/ml_labeler/embed_vs_scalar.md` (written by the benchmark)

- [ ] **Step 1: Write the benchmark**

```python
"""Side-by-side: scalar vs embed PR curves per tier-1 label.

Uses the EXACT SAME labeled rows (intersection of cards with both
scalar features and an embedding) for both arms. OOF predictions via
StratifiedKFold(5). Writes a comparison table to docs/.
"""
from __future__ import annotations
from datetime import datetime
from pathlib import Path

import numpy as np
from sklearn.model_selection import StratifiedKFold, cross_val_predict

from scripts.detect_subjects.ml_labeler import TIER1_LABELS
from scripts.detect_subjects.ml_labeler.train import (
    _load_xy_for_label, _scalar_clf_factory,
)
from scripts.detect_subjects.ml_labeler.train_embed import (
    _load_xy_for_label_embed, _embed_clf_factory,
)

OUT = Path("docs/ml_labeler/embed_vs_scalar.md")
TARGETS = [0.30, 0.50, 0.60, 0.70, 0.80]


def _pr_at(probs, y, target):
    order = np.argsort(probs)[::-1]
    y_sorted, p_sorted = y[order], probs[order]
    n_pos = int(y.sum())
    best = {"precision": 1.0, "recall": 0.0}
    tp = 0
    for i, (yi, pi) in enumerate(zip(y_sorted, p_sorted)):
        if yi == 1: tp += 1
        prec = tp / (i + 1)
        rec = tp / n_pos if n_pos else 0
        if prec >= target and rec > best["recall"]:
            best = {"precision": prec, "recall": rec}
    return best


def main():
    parquet = Path("data/cache/framing_detections.parquet")
    lbl = Path("data/cache/labels.json")
    out_lines = [
        f"# Scalar vs SAM3-embeddings classifier comparison ({datetime.now():%Y-%m-%d})",
        "",
        "OOF predictions via StratifiedKFold(5). Same labeled rows for both arms.",
        "",
    ]
    for label in TIER1_LABELS:
        X_s, y_s, ids_s = _load_xy_for_label(parquet, lbl, label)
        X_e, y_e, ids_e = _load_xy_for_label_embed(parquet, lbl, label)
        # Intersect
        common = set(ids_s) & set(ids_e)
        if len(common) < 30:
            out_lines += [f"\n## `{label}` — skipped (only {len(common)} common rows)", ""]
            continue
        s_idx = [i for i, x in enumerate(ids_s) if x in common]
        e_idx = [i for i, x in enumerate(ids_e) if x in common]
        X_s_c, y_c = X_s[s_idx], y_s[s_idx]
        X_e_c = X_e[e_idx]
        # Ensure y aligns (should since both filtered identically)
        cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)
        p_s = cross_val_predict(_scalar_clf_factory(), X_s_c, y_c, cv=cv,
                                method="predict_proba", n_jobs=-1)[:, 1]
        p_e = cross_val_predict(_embed_clf_factory(), X_e_c, y_c, cv=cv,
                                method="predict_proba", n_jobs=-1)[:, 1]
        out_lines += [
            f"\n## `{label}` — n={len(common)}, positives={int(y_c.sum())}",
            "",
            "| target P | scalar R | embed R | Δ |",
            "|---:|---:|---:|---:|",
        ]
        for t in TARGETS:
            rs = _pr_at(p_s, y_c, t)["recall"]
            re_ = _pr_at(p_e, y_c, t)["recall"]
            delta = re_ - rs
            out_lines.append(
                f"| {t:.2f} | {rs:.2f} | {re_:.2f} | {delta:+.2f} |"
            )
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text("\n".join(out_lines) + "\n")
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run benchmark**

```bash
.venv/bin/python -m tools.benchmark_embed_vs_scalar
cat docs/ml_labeler/embed_vs_scalar.md
```

- [ ] **Step 3: Commit**

```bash
git add tools/benchmark_embed_vs_scalar.py docs/ml_labeler/embed_vs_scalar.md
git commit --no-gpg-sign -m "bench: scalar vs SAM3-embeddings PR-curve comparison per label"
```

---

## Task 8: Wire embedding predictions into predict.py (only if Task 7 shows wins)

**Files:**
- Modify: `scripts/detect_subjects/ml_labeler/predict.py`

This task ONLY runs if the Task 7 report shows ≥0.05 R improvement on ≥2 labels at the P=0.60 operating point. Otherwise stop, document the failure, leave scalar-only in production.

- [ ] **Step 1: Decision check**

Read `docs/ml_labeler/embed_vs_scalar.md`. If the gains are below the bar, write a brief "why it didn't work" addendum and skip to "Cleanup" section. Don't ship Task 8.

- [ ] **Step 2: Add embed prediction path**

Extend `predict_labels_batched` to load `arm_embed_latest.joblib` per label if it exists, run on the embedding sidecar, and average / pick the winning arm per label. Persist `predicted_<label>_p` (existing column) using the winning arm.

- [ ] **Step 3: Add per-label arm selection metadata to `ml_labeler/__init__.py`**

```python
WINNING_ARM_PER_LABEL = {
    "mask_blur_unusable": "scalar",  # or "embed", set from benchmark
    ...
}
```

- [ ] **Step 4: Smoke test + commit**

```bash
.venv/bin/python -m scripts.detect_subjects.ml_labeler.predict
.venv/bin/python -m scripts.detect_subjects.build_html sam3__sam3
git add scripts/detect_subjects/ml_labeler/{predict.py,__init__.py}
git commit --no-gpg-sign -m "predict: route to embedding arm for labels where it wins"
```

---

## Cleanup / decision matrix

After Task 7 + 8, three outcomes are possible:

| Outcome | Action |
|---|---|
| Embed wins on 3+ labels by ≥0.10 R at P=0.60 | Ship Task 8. Schedule a follow-up to deprecate scalar features entirely. |
| Embed wins on 1-2 labels by ≥0.05 R | Ship Task 8 — per-label arm selection earns its keep. |
| Embed wins on <1 label or gains ≤0.05 R | Don't ship Task 8. Keep the sidecar code (cheap to maintain), but don't gate on it. Write a "why it didn't pay off" note in `docs/ml_labeler/embed_vs_scalar.md`. |

The Task 7 benchmark is the gate. Don't be tempted to ship the embedding arm "because we built it" — if it doesn't beat scalars by the bar above, the added complexity (sidecar parquet, dual model files, dual training, dual prediction) isn't worth carrying.

---

## Risks + mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Mask→patch-grid alignment is wrong (off-by-1 in pooling) | Medium | Task 0 probe forces explicit alignment decision; Task 1 unit tests exercise edge cases |
| 1024-dim is too high for 384 samples (overfit) | Medium | PCA(256) in pipeline; CV with std reports variance honestly |
| SAM3 segmentation-trained features don't transfer to classification | Medium-Low | Task 7 benchmark — if no gain, we know fast and stop |
| Backfill takes too long (>30 min) | Low | Task 5 batches at 4; checkpoint every batch; resumable |
| Float16 storage loses precision needed for PCA | Low | Float16 has ~3 decimal digits of precision; PCA is robust |
| Pooling inside mask collapses to background features when mask is small/wrong | Medium | Fallback to global pool when mask is empty; could also add "bbox pool" as a 3rd option to try |

---

## Estimate

- Tasks 0-4 (capture pipeline): 2-3h
- Task 5 (backfill 1500 rows): 30min coding + 10-15min run
- Task 6 (train_embed): 1h
- Task 7 (benchmark): 30min coding + 5min run
- Task 8 (production wire, IF gains justify): 1h

**Total: 5-7h focused work, with a clear decision gate at Task 7 that prevents over-investment.**
