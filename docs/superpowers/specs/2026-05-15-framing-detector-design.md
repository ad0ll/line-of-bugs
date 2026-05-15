# Framing Detector Experiment — Design Spec

**Author:** ad0ll + Claude
**Date:** 2026-05-15
**Status:** approved (pending user sign-off on this doc)
**Type:** Experiment + downstream production design

---

## Summary

We have ~34k insect photos pulled from iNaturalist, Bugwood, Smithsonian, and USDA-ARS. A substantial fraction (especially in iNat) are poorly framed for gesture drawing: zoomed-out shots where the bug is a tiny dot, multi-bug compositions, and camouflaged subjects. None of the source APIs expose framing labels.

This experiment validates whether an open-vocabulary detection + segmentation pipeline can reliably identify framing problems and propose tight crops automatically — replacing the crowdsourced "zoomed out" / "where's the bug?" report categories as the primary signal for the bulk dataset. The 6 model variants are tested on 400 stratified images, with empirical comparison via a parquet cache and an interactive HTML review interface. If results pass validation gates, we ship a full 34k-image backfill plus DB schema additions.

## Goal & success criteria

**Primary goal:** establish empirically whether a local model pipeline can correctly classify framing quality (good / wide / hidden / multi_bug / camouflaged) on our dataset, and produce crop proposals you'd actually serve to students.

**Success on the 400-image validator:**
- ≥95% of single-bug photos get a bbox that contains the bug
- ≥90% of zoomed-out photos correctly flagged (precision ≥85%, recall ≥85%)
- ≥85% of multi-bug photos correctly flagged
- <2% catastrophic detection errors (bug missed entirely or wrong object boxed)
- Proposed crops visually preserve nature context per the cropping rules in §6
- Total experiment wall-time ≤10 min (target ≤7 min)

**Failure modes that trigger a redesign:**
- All variants underperform → escalate to cloud VLM (Haiku/Sonnet via Batch API)
- One variant dominates by ≥10% across all categories → drop the others, simplify
- MLX path for SAM 3.1 doesn't work → drop V4

## Pipeline architecture

```
data/images/{id}.jpg (full-res original, 3000-4000px long-edge)
        │
        ├─[16-thread loader]─→ decoded RGB tensor at model-input res
        │                       (shared across variants via in-memory LRU cache)
        │
        ├─[PyTorch MPS worker, F16]─┬─→ GroundingDINO-base
        │                             │     ↓ bboxes (used by V1, V2)
        │                             │
        │                             ├─→ OWLv2-base
        │                             │     ↓ bboxes (used by V3)
        │                             │
        │                             ├─→ InsectSAM image-encode (cached)
        │                             │     ↓ image embedding (used by V1+V3 with different prompts)
        │                             │
        │                             ├─→ SAM 2.1 image-encode (cached)
        │                             │     ↓ image embedding (used by V2)
        │                             │
        │                             ├─→ Florence-2-base (V5: single-shot detect)
        │                             │
        │                             └─→ PaliGemma 2 3B (V6: text-gen detection)
        │
        ├─[MLX worker (separate process)]─→ SAM 3.1 (V4)
        │
        ├─[ProcessPoolExecutor-16, CPU]─→ Metrics:
        │     • bbox_area_ratio, mask_area_ratio, offcenter
        │     • n_distinct_detections (post-NMS)
        │     • LAB ΔE (subject vs background, from mask)
        │     • Sobel boundary sharpness
        │     • iNat-2017 ground-truth IoU (where image overlap exists)
        │
        ├─[CropPlanner, CPU]─→ Proposed crop bbox (full-res coords)
        │                       Generated crop preview JPEG saved to disk
        │
        └─[Parquet writer]─→ data/cache/framing_detections.parquet
                              (one row per (image_id, variant), append-only)
```

## Models under test

| ID | Variant | HF model IDs | Hypothesis | License | Params |
|---|---|---|---|---|---|
| V1 | DINO + InsectSAM | `IDEA-Research/grounding-dino-base` + `martintomov/InsectSAM` | Specialist + domain-fine-tuned baseline | Apache-2 + Apache-2 | 233M + 94M |
| V2 | DINO + SAM 2.1 | `IDEA-Research/grounding-dino-base` + `facebook/sam2.1-hiera-base-plus` | Insect fine-tune vs modern general SAM | Apache-2 + Apache-2 | 233M + 81M |
| V3 | OWLv2 + InsectSAM | `google/owlv2-base-patch16-ensemble` + `martintomov/InsectSAM` | Is DINO the right detector? OWLv2 strong on animal classes | Apache-2 + Apache-2 | 154M + 94M |
| V4 | SAM 3.1 | `facebook/sam3.1` (PyTorch) or `mlx-community/sam3.1-bf16` (MLX path) | Has 2026 SOTA caught up to specialists for our domain? | SAM License (custom) | 873M |
| V5 | Florence-2 | `microsoft/Florence-2-base` | Does multi-task VLM training help? | MIT | 232M |
| V6 | PaliGemma 2 3B | `google/paligemma2-3b-mix-448` | Does VLM-style autoregressive coord-token detection work? | Gemma license | 3B |

**Drop list (researched and rejected):**
- TIPSv2 — encoder only, no built-in detector head, would require custom integration
- OWL-ViT v1 — superseded by OWLv2
- SAM 1 — superseded by SAM 2 and SAM 3
- YOLO-World — closed-set strength, less flexible than DINO/OWL for prompts
- DINO-X — API-only / rate-limited, can't run locally for 34k

## Sample selection

Drawn deterministically from `data/manifest/*.csv` with a fixed random seed (42) so reruns are reproducible:

- **160 iNat random** (highest-volume problem area; 27k of 34k images)
- **80 iNat "suspected hard"** — description tokens matching `r"\bhabitat|landscape|wide|field|scenery\b"` OR extreme aspect ratio (>2:1)
- **80 Bugwood random** (already curated, sanity check)
- **40 Smithsonian** (pinned specimens on white — easy case baseline)
- **40 mixed difficult taxa** — 10 each of Mantodea, Phasmatodea, Lepidoptera-larva (caterpillars), Orthoptera (grasshoppers on grass — known camouflage)

The Mantodea/Phasmatodea picks specifically test camouflage detection — where ΔE metric earns its keep.

Sample index saved to `data/cache/validator_sample.parquet`. Each experiment run can resume against it.

## Cropping rules

The model gives us bboxes; cropping rules turn them into student-facing crops.

**For `subject_type = "nature"` (~95% of iNat + Bugwood):**
- Target post-crop subject area: **30% of frame** (bug-in-context, not bug-portrait)
- `padding_factor ≈ 1.83×` (= sqrt(1/0.30)) applied to bbox dimensions
- Crop bounded to original image extent (no synthesized background)
- Preserve original aspect ratio when possible; fall back to clamped crop if needed
- **Skip crop entirely if bbox already covers ≥25%** (already well-framed; cropping ruins composition)
- **Skip crop if bbox covers <2%** (treat as 'hidden'; don't try to rescue tiny dots)

**For `subject_type = "specimen"` (Smithsonian + Bugwood specimens):**
- Already sit on uniform backgrounds; tight cropping is fine
- Target subject area: **60% of frame**
- `padding_factor ≈ 1.29×`

**For multi-bug images (n_distinct_detections ≥ 2 after NMS):**
- Don't auto-crop. Flag as `framing_quality='multi_bug'` and surface for manual review.

**For "hidden" cases (no detection or area <2% or confidence <0.4):**
- Don't auto-crop. Flag as `framing_quality='hidden'`.

Crops applied to the **full-resolution original**, not the model-input-resolution. Model bbox is normalized [0,1] and rescaled to original pixel coords. Crop saved as JPEG q90 medium variant (1024px max-edge) + JPEG q85 thumbnail (512px max-edge).

## Parquet schema

```python
# Frozen schema — locked before any row gets written
# data/cache/framing_detections.parquet
# Primary key: (image_id, variant)
# Compression: snappy; resumable append-mode via pyarrow.parquet.ParquetWriter

image_id:                str                # primary key part 1
source:                  str                # for stratified review filtering
variant:                 str                # primary key part 2; V1..V6
img_w, img_h:            int32              # original full-res dimensions
subject_type:            str                # 'nature'|'specimen'

# Detection
n_raw_detections:        int16              # before NMS
n_distinct_detections:   int16              # after NMS at IoU=0.5, conf>0.25
bbox_x, bbox_y, bbox_w, bbox_h:  float32   # normalized 0-1 of TOP detection
confidence:              float32            # 0-1

# Geometry
bbox_area_ratio:         float32            # bbox / image
offcenter:               float32            # dist(bbox_center, img_center) / diagonal

# Mask-derived (null when no mask, e.g. detection-only variant)
mask_area_ratio:         float32            # mask pixels / image pixels
mask_iou_score:          float32            # SAM's own confidence in mask
lab_delta_e:             float32            # subject vs background LAB ΔE
boundary_sharpness:      float32            # mean Sobel grad on mask boundary

# Crop proposal
crop_x, crop_y, crop_w, crop_h:  float32   # normalized 0-1, proposed crop
post_crop_subject_area:  float32            # bug % of crop after cropping

# Classification (derived)
framing_quality:         str                # 'tight'|'good'|'wide'|'hidden'|'multi_bug'|'camouflaged'

# Validation (where iNat-2017 ground truth available)
gt_bbox_x, gt_bbox_y, gt_bbox_w, gt_bbox_h:  float32  # nullable; iNat-2017 GT bbox
gt_iou:                  float32            # IoU(our_bbox, gt_bbox), nullable

# Bookkeeping
detection_ms:            int32              # detector inference time
segmentation_ms:         int32              # segmenter inference time (nullable)
detector_model:          str
segmenter_model:         str                # nullable for detection-only variants
processed_at:            timestamp[ms]
schema_version:          int8               # bump if columns change
```

## Caching strategy

Six explicit caches, layered for performance and resume capability:

| Cache | What | Where | Lifetime |
|---|---|---|---|
| Image decode | Decoded RGB tensor at model-input res | In-memory LRU dict (~2 GB cap) | Per-run |
| SAM image-embedding | ViT encoder output per (model, image) | In-memory dict | Per-run |
| GroundingDINO bbox | Detection results per image | In-memory dict | Per-run; V1+V2 share |
| OWLv2 bbox | Detection results per image | In-memory dict | Per-run; V3 only |
| Parquet resume | Done `(image_id, variant)` pairs | Disk: parquet file | Persistent |
| Crop previews | Generated `audit/framing-validator/crops/{V}/{id}.jpg` | Disk | Persistent |
| HuggingFace model | Model weights | `~/.cache/huggingface/` | Persistent across runs |

The SAM image-embedding cache is the most impactful: SAM's ViT encoder is the dominant compute cost. V1 and V3 both use InsectSAM; without this cache they'd re-encode each image twice.

## Concurrency model (M5 Max, 128 GB)

```
┌─────────────────────────────────────────────────────────────┐
│  Process 1 — PyTorch/MPS worker (V1, V2, V3, V5, V6):       │
│                                                              │
│   Loader pool (16 threads)                                  │
│      Read JPEG + decode → tensor ──→ Queue (cap 32)         │
│                                       │                      │
│   Model runner (single thread):       ▼                      │
│      Batch up to 16 imgs per model:                         │
│        DINO-base (batch 16)                                  │
│        OWLv2-base (batch 16)                                 │
│        InsectSAM encode (batch 8) → embedding cache          │
│        SAM 2.1 encode (batch 8) → embedding cache            │
│        SAM prompt-decode (batch 32, cheap, cached)           │
│        Florence-2 (batch 8)                                  │
│        PaliGemma 2 (batch 4, autoregressive generation)      │
│                                                              │
│   Metrics pool (ProcessPoolExecutor 16):                     │
│      LAB ΔE, Sobel, crop calc — CPU-bound NumPy             │
│                                                              │
│   Parquet writer (1 thread):                                │
│      Batch 50 rows → write_table()                          │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  Process 2 — MLX worker (V4 SAM 3.1):                       │
│                                                              │
│   Reads same image queue                                    │
│   Runs SAM 3.1 via mlx-vlm                                  │
│   Appends to same parquet (file lock)                       │
└─────────────────────────────────────────────────────────────┘
```

**Why this shape:**
- MPS doesn't multi-tenant well across PyTorch contexts; one thread drains GPU
- Batching maximizes GPU utilization
- Loading + post-processing pipeline-parallelize around the GPU
- MLX uses Metal differently from PyTorch MPS — two processes may genuinely overlap
- ProcessPoolExecutor for metrics avoids GIL on NumPy-heavy work
- Single parquet writer with file lock prevents race conditions

**Memory budget:** ~3 GB model weights × 6 variants peak = 18 GB. Decoded image batches another 4 GB. Comfortable in 128 GB.

**Estimated wall-time for 400 images × 6 variants:**
- DINO @ batch 16, F16: ~30s
- OWLv2 @ batch 16: ~30s
- SAM 3.1 (MLX): ~80s if MLX parallel with PyTorch; ~80s sequential
- Florence-2 @ batch 8: ~60s
- PaliGemma 2 3B @ batch 4: ~3-5 min (autoregressive, slowest variant)
- InsectSAM encode pass: ~120s (then ~10s for both prompt decodes)
- SAM 2.1 encode pass: ~100s
- Image loading + metrics: parallel with GPU, ≤30s overhead
- **Realistic: 7-10 min total wall time. Hard ceiling: 12 min.**

If PaliGemma 2 dominates the runtime, we may drop it after Phase A benchmark.

## Review interface

Static HTML at `audit/framing-validator/index.html`, generated by the script:

**Sticky header:**
- Variant selector: `[V1▼]` switches active variant
- Source filter: `[all|inat|bugwood|smithsonian|usda-ars▼]`
- Classification filter: `[all|good|tight|wide|hidden|multi_bug|camouflaged▼]`
- Sort: `[confidence ▲|bbox area ▲|ΔE ▲|random]`
- Per-image label totals: `✓ 142 / ✗ 8 / ? 4`
- `[Export labels]` button → downloads `labels.json`

**Each tile (grid, ~4 per row):**

```
┌──────────────────────────────────────────────┐
│ ┌─────────────────┐  ┌─────────────────┐    │
│ │ [Full original  │  │ [Proposed crop] │    │
│ │  with bbox &    │  │  (saved as      │    │
│ │  mask overlay]  │  │  crops/V1/{id}) │    │
│ └─────────────────┘  └─────────────────┘    │
│                                              │
│ Mantis religiosa · inat-12345                │
│ ┌─────────────────────────────────────┐      │
│ │ [WIDE] auto-crop  (color-coded)     │      │
│ └─────────────────────────────────────┘      │
│ bbox: 18% area → crop preview: 36%           │
│ conf: 0.82 · ΔE: 27 · off-center: 0.21       │
│ detected: 1 bug · gt_iou: 0.84 (✓)           │
│ [✓ correct] [✗ wrong] [? unsure] [📝 note]   │
└──────────────────────────────────────────────┘
```

**Special views per category:**
- `hidden` — image displayed with red "no detection" overlay; reason shown explicitly
- `multi_bug` — all detected bboxes drawn (different colors); no crop proposed
- `camouflaged` — color-swatch widget showing mean subject vs background side-by-side
- `good` — minimal info, just the original; nothing to do

**Variant comparison view** — `[Compare variants]` button on each tile opens a row showing V1-V6 outputs for that exact image side-by-side. Quickly spot disagreements.

**Resolution flow** — what users actually see:
```
data/images/{id}.jpg                ← full original (3000-4000px)
   ↓ resize for model input         (800-1333px for DINO/OWLv2, 1024px for SAM family, 768 for Florence)
   ↓ bbox/mask in normalized [0,1]
   ↓ rescale to original pixel coords
   ↓ Pillow crop on full-res
   ↓ JPEG q90 medium (1024px) + JPEG q85 thumb (512px)
   → audit/framing-validator/crops/{V}/{id}.jpg
```

The HTML "proposed crop" element IS what the gallery/session player would serve. The original tile to its left shows what users see today. Direct A/B.

Per-image labels saved to `localStorage`; `[Export labels]` downloads `labels.json`. Ingested back to `data/cache/labels.parquet` for threshold tuning.

## Threshold tuning

Initial classification rules (to be refined via review labels):

```python
def classify(row):
    if row.confidence < 0.40 or row.bbox_area_ratio < 0.02:
        return 'hidden'
    if row.n_distinct_detections >= 2:
        return 'multi_bug'
    if row.mask_area_ratio is not None and row.lab_delta_e < 12:
        return 'camouflaged'
    if row.bbox_area_ratio < 0.20:
        return 'wide'        # auto-crop candidate
    if row.bbox_area_ratio > 0.50:
        return 'tight'
    return 'good'
```

After review, `scripts/tune_thresholds.py`:
1. Loads `framing_detections.parquet` + `labels.parquet`
2. ROC-sweeps each threshold against your labels
3. Writes `data/cache/tuned_thresholds.yaml`
4. Re-classifies all 400 with new thresholds; shows confusion matrix per variant

Failure mode: if any category's F1 < 0.75 after tuning, the rule needs work (or that variant is wrong for the category).

## Phased work sequence

```
Phase 0  [now]              SAM 3.1 access request submitted ✓
Phase A  [≤3 min]           Smoke benchmark: load each model, run 5 images each,
                            run 10-point sanity gate (see below). FAIL LOUDLY.
Phase B  [≤5 min]           Run V1 (DINO + InsectSAM) on all 400 images.
                            Generate parquet + HTML + crop previews.
═══════ PAUSE — user reviews V1 ═══════
                            Iterate on V1 framework: crop aesthetics,
                            classification rules, HTML UX. Lock once approved.
Phase C  [≤7 min]           Run V2, V3, V5, V6 on all 400 (same scaffolding).
Phase D  [≤2 min]           Run V4 (SAM 3.1 via MLX) — IF access granted.
Phase E  [≤30 min]          User reviews; labels saved to labels.parquet.
Phase F  [≤5 min]           Run threshold tuner; final confusion matrix.
═══════ DECISION GATE — go / no-go for 34k pass ═══════
Phase G  [4-8h, mostly wall-time]  Run winning variant on full 34k.
Phase H  [≤30 min]          DB schema migration + apply_crops.
Phase I  [≤1h]              Wire framing_quality into gallery + moderation UI.
```

## Phase A 10-point sanity gate

Each model variant must pass these gates BEFORE Phase B/C runs. Fail loudly with structured diagnostics:

1. Model loads to device (or explicit MPS-fallback diagnostic)
2. Peak working memory during first batch <16 GB
3. MPS kernel CPU-fallback count <5% of ops
4. First batch sanity per variant: ≥1 valid bbox produced for ≥4 of 5 sample images
5. Confidences in plausible range (not all 0.99 or all 0.05)
6. Bbox coords in valid [0,1], w/h > 0, not whole image (>99%)
7. Mask plausibility (non-zero pixel count, IoU score > 0)
8. Tensor shapes match model docs
9. Parquet write+read roundtrip succeeds (5 rows)
10. HTML renders in headless Playwright with no JS errors

## DB schema (post-experiment, if green-light)

```sql
ALTER TABLE images ADD COLUMN subject_bbox_x REAL;
ALTER TABLE images ADD COLUMN subject_bbox_y REAL;
ALTER TABLE images ADD COLUMN subject_bbox_w REAL;
ALTER TABLE images ADD COLUMN subject_bbox_h REAL;
ALTER TABLE images ADD COLUMN subject_area REAL;
ALTER TABLE images ADD COLUMN subject_confidence REAL;
ALTER TABLE images ADD COLUMN subject_offcenter REAL;
ALTER TABLE images ADD COLUMN framing_quality TEXT;
ALTER TABLE images ADD COLUMN crop_bbox_x REAL;
ALTER TABLE images ADD COLUMN crop_bbox_y REAL;
ALTER TABLE images ADD COLUMN crop_bbox_w REAL;
ALTER TABLE images ADD COLUMN crop_bbox_h REAL;
ALTER TABLE images ADD COLUMN detector_used TEXT;
ALTER TABLE images ADD COLUMN segmenter_used TEXT;

CREATE INDEX idx_images_framing ON images(framing_quality);
```

Re-generated `medium/` and `thumbnails/` from proposed crops, leaving full-res `images/` untouched.

## Risks & unknowns

1. **SAM 3.1 access gating** — gated on HF, can be denied silently. Mitigation: Phase 0 request initiated, V4 drops gracefully if not granted in time.
2. **MLX + PyTorch MPS co-existence** — two GPU contexts on M-series untested in my hands. Mitigation: Phase A benchmark falls back to serial execution.
3. **PaliGemma 2 throughput** — autoregressive decoding is inherently slower. If >5 min for 400 images, drop V6.
4. **Crop aesthetic at 30% area target** — math says portrait-y; might still feel wrong on some photos. Mitigation: HTML review catches this; single-line change before 34k pass.
5. **iNat-2017 ID overlap** — we may have only a small subset of our images in iNat-2017's labeled set. gt_iou column will be sparse; not a blocker, just a partial validation signal.
6. **Inference speed inadequate for 34k pass** — if winning variant takes >5 sec/img, 34k = 48 hours. Mitigation: benchmark in Phase A; if too slow, fall back to detector-only variant for full pass.

## Open questions answered already

- ✅ Detector preference: empirical via V1/V3 (DINO vs OWLv2)
- ✅ Segmenter preference: empirical via V1/V2 (InsectSAM vs SAM 2.1)
- ✅ SAM 3 inclusion: yes, contingent on access
- ✅ PaliGemma 2: include as V6
- ✅ TIPSv2: excluded (encoder only, no detector head)
- ✅ Crop target for nature: 30% subject area
- ✅ Sample size: 400 stratified images
- ✅ iNat-2017 GT bboxes: include as validation column (gt_iou)
- ✅ Phased execution with pause after V1: yes
- ✅ Caching strategy: 6 layers explicitly defined

---

End of spec.
