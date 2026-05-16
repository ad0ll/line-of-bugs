# Modular Label Pipeline — Design Spec

**Author:** ad0ll + Claude
**Date:** 2026-05-15 (rev 2026-05-16)
**Status:** approved (pending user review)
**Type:** Architecture redesign + iteration roadmap

---

## Summary

The line-of-bugs gallery filter needs to evolve from a single-variant hard-coded pipeline (DINO + InsectSAM + rule labels) into a modular system where the segmenter and per-label ML labelers can be swapped, A/B tested, and replaced as we collect more labels. The detector is locked to **SAM 3** based on published LVIS-rare performance (SAM 3: 48.8 AP vs DINO: 33 AP) and its 4M-noun-phrase training vocabulary; the cost of detector experimentation (every change invalidates §1 + §2 labels) makes detector A/B prohibitively expensive without strong evidence the default is failing.

Current pipeline weaknesses against 318 human labels: `multi-bug` F1 = 0.31, `poor-contrast` F1 = 0.39, `subject-clipped` F1 = 0.49, and blur is not predicted at all (127 user labels with no system equivalent). This spec replaces the pipeline with a Protocol-based modular architecture, a 4-column human-label vocabulary aligned to the technical components, and an iteration plan using active learning + PU/class-weighted training to grow labels efficiently.

## Goal

Build an automated drawability filter that processes ~34,000 raw insect photos and decides keep/reject per image, with **precision ≥ 0.94** on the keep decision (≤1-3 bad images per 50 shown to a student). The pipeline must:

1. Allow swap-in/swap-out of segmentation and per-label ML labeler components without rewriting orchestration code.
2. Run A/B tests across segmenter + classifier variants on the same human-labeled set, with statistical confidence reporting.
3. Use the 318 existing human labels (and additional labels grown via active learning) as the calibration set.
4. Drop legacy concepts that don't serve the workflow (auto-generated crop previews, cropping-specific labels, detector A/B complexity).

No target gallery size — filter what's unusable, keep what's usable.

## Vocabulary (canonical — to be mirrored to CLAUDE.md)

These terms are precise. Code, comments, and conversation use them consistently.

- **classify** / **classification** — the whole label-emission pipeline (detection → segmentation → features → rule labeler → ML labeler → gate). Orchestrator file is `scripts/detect_subjects/classify.py`.
- **rule labeler** — `scripts/detect_subjects/rule_labeler.py` (renamed from old `classify.py`). Pure functions emitting labels from scalar features. No ML.
- **ML labeler** — trained ML models under `scripts/detect_subjects/ml_labelers/`. Output probabilities per label.
- **gate** — `scripts/detect_subjects/gate.py`. Combines all label sources into a single keep/reject decision.
- **label** — an individual descriptor (e.g., `bbox_correct-subject_not-clipped`) emitted by rule labeler, ML labeler, or set by human.
- **soft reject** — labels suffixed `_usable` (e.g., `bbox-content_bbox-multibug_usable`, `mask_blur_usable`). Still gate-rejects today, but indicates a more-drawable variant. No functional difference at the gate; preserved for analytics and possible future filtering tiers.
- **bbox-content label** — labels prefixed `bbox-content_` describing what is INSIDE the chosen bbox (count, size, etc.). NOT the same as image-content.
- **bbox label** — labels prefixed `bbox_` describing the bbox ITSELF (whether the detector picked correctly).
- **mask label** — labels prefixed `mask_` derived from segmenter output.
- **ml label** — labels prefixed `ml_` set primarily by the ML labeler (or human catch-all).

## Architecture

Six-stage cascade. Each stage has one responsibility. Stages communicate through Python `Protocol`-typed dataclasses defined in `scripts/detect_subjects/interfaces.py`.

```
image  ──►  Detector  ──►  bbox + per-detection text label
                                    │
                                    ▼
                              Segmenter  ──►  mask
                                    │
                                    ▼
                  features.py (geometry from bbox; color/edge from mask)
                                    │
                                    ▼
                  rule_labeler.py (§2, §3-rule portion)
                                    │
                                    ▼
                  ml_labelers/*.py (§3-ML portion, future §4)
                                    │
                                    ▼
                  gate.py (drawability keep/reject)
                                    │
                                    ▼
            parquet (rows tagged by variant) + labels.json + validator HTML
```

`classify.py` is orchestration only (~120 lines target) — composes the chosen detector + segmenter + classifier set via factory functions, runs the for-loop, and writes parquet rows.

### Protocols

```python
# interfaces.py

class Detector(Protocol):
    """Open-vocabulary bbox detector: image + text prompt → bbox + per-detection phrase."""
    def detect(self, image: PIL.Image, image_id: str | None = None) -> DetectionResult: ...

class Segmenter(Protocol):
    """Bbox-prompted segmenter: image + bbox → pixel mask."""
    def segment_with_bbox(
        self, image_id: str, image: PIL.Image,
        bbox_xywh_normalized: tuple[float, float, float, float],
    ) -> SegmentationResult: ...

class MLLabeler(Protocol):
    """Trained classifier emitting per-label probabilities."""
    def predict(self, image_id: str, features: dict) -> dict[str, float]: ...
```

**No separate `OneShotDetectorSegmenter` protocol.** SAM 3 implements BOTH `Detector` and `Segmenter` on the same model instance. The "unified mode" is implementation-level (share the model), not protocol-level.

DetectionResult fields:
- `bbox_xywh_normalized`, `confidence`
- `n_raw_detections`, `n_distinct_detections`, `distinct_subjects` (list of (x,y,w,h,conf,text_label) tuples)
- `text_label` (the prompt phrase that matched the primary bbox — NEW; previously discarded)
- `text_label_score` (alignment strength — NEW)
- `detection_ms`

### Module structure

```
scripts/detect_subjects/
├── classify.py                # RENAMED from pipeline.py — orchestration only
├── interfaces.py              # Protocol definitions
├── features.py                # NEW — compute_geometric_features, compute_mask_features
├── rule_labeler.py            # RENAMED from old classify.py — pure rule labels
├── gate.py                    # NEW — keep/reject decision combining all sources
├── schema.py                  # updated for new label vocabulary
├── crop.py                    # crop math kept for compute_crop_bbox; previews not saved
├── metrics.py                 # geometric helpers (IoU etc.)
├── ground_truth.py            # unchanged
├── caches.py                  # unchanged
├── label_server.py            # updated for 4-column label schema
├── build_html.py              # updated for new validator UI
├── evaluate_pipeline.py       # RENAMED from evaluate_v1.py; adds PR curves + bootstrap CIs
├── prompt_builder.py          # NEW — DB-driven insect prompt generation
├── active_surfacer.py         # NEW — uncertainty + diversity sampling
├── pr_curves.py               # NEW — re-runnable PR curve tool per label
├── detectors/
│   ├── __init__.py            # factory: make_detector(name) → Detector
│   ├── grounding_dino.py      # KEPT for reference; not active default
│   └── sam3.py                # NEW — DEFAULT; text-prompted detection mode
└── segmenters/
    ├── __init__.py            # factory: make_segmenter(name) → Segmenter
    ├── insectsam.py           # KEPT for reference; not active default
    └── sam3.py                # NEW — DEFAULT; bbox-prompted mode (same model instance as detector)
└── ml_labelers/
    ├── __init__.py            # factory + registry
    └── blur.py                # 3-class blur classifier (first to ship)
```

### Default models (LOCKED — do not change without a relabeling pass)

- **Detector**: `sam3` (using SAM 3 PCS text-prompted mode)
- **Segmenter**: `sam3` (same model instance, bbox-prompted)
- **Prompt**: built from `prompt_builder.py` at startup from DB taxa + standard negative classes (see Prompt Design below)

Variant identifier = `(detector_name, segmenter_name, prompt_version)`. Pipeline writes rows tagged with this variant. Existing parquet columns `detector_model`, `segmenter_model`, `variant` support this.

### Locked parameters (changing any of these requires a relabeling pass)

Any change to these affects which bbox is selected → invalidates §1 + §2 labels for affected images:
- `DETECTOR_VARIANT` (currently `sam3`)
- `INSECT_PROMPT_VERSION` (managed in prompt_builder.py)
- `BOX_THRESHOLD` (raw detection confidence floor)
- `TEXT_THRESHOLD` (text alignment floor)
- `HIGH_CONF_THRESHOLD` (multi-bug count gate)
- `NMS_IOU_THRESHOLD`
- `BBOX_MAX_AREA_RATIO`
- `BBOX_CONF_TOLERANCE` (bark-beetle rule — may drop with SAM 3)

Each change to these IS a research decision documented in commit messages with a regenerated A/B comparison.

## Prompt design (DB-driven, research-backed)

### Research basis

- [Parashar et al. EMNLP 2023](https://aclanthology.org/2023.emnlp-main.610/): common English names outperform scientific names by 2-5× for fine-grained species recognition in VLMs.
- [SAM 3 SA-Co dataset](https://huggingface.co/facebook/sam3): trained on 4M+ noun phrases + Wikipedia-based ontology spanning 22M entities. Insect orders (Coleoptera, Hemiptera, etc.) are in Wikipedia and likely understood. Common English insect names ("a beetle", "a butterfly") are reliably in training.
- [GroundingDINO multi-class prompt format](https://huggingface.co/docs/transformers/model_doc/grounding-dino): period-separated phrases; "categories can sometimes bleed" so adjacent semantically-close categories may need separate inference passes.

### Approach

`prompt_builder.py`:
```python
def build_insect_prompt(db_path) -> tuple[str, str]:
    """Returns (prompt_text, prompt_version_hash) for the current DB taxa."""
    orders_in_dataset = db.query("SELECT DISTINCT taxon_order FROM images WHERE taxon_order != ''")
    phrases = ["an insect"]
    for order in sorted(orders_in_dataset):
        phrases += ORDER_TO_COMMON_NAMES.get(order, [])
    phrases += NEGATIVE_CLASSES  # ["a flower", "a leaf", "a stem", "a rock"]
    text = ". ".join(phrases) + "."
    version = hashlib.sha1(text.encode()).hexdigest()[:8]
    return text, version
```

`ORDER_TO_COMMON_NAMES` is a small static lookup table (~20 entries) in code (not DB):

| taxon_order | common name phrases |
|---|---|
| Coleoptera | "a beetle" |
| Lepidoptera | "a butterfly", "a moth" |
| Hymenoptera | "a bee", "a wasp", "an ant" |
| Diptera | "a fly" |
| Hemiptera | "a true bug" |
| Orthoptera | "a grasshopper", "a cricket" |
| Odonata | "a dragonfly", "a damselfly" |
| Mantodea | "a praying mantis" |
| Blattodea | "a cockroach", "a termite" |
| Phasmatodea | "a stick insect" |
| Neuroptera | "a lacewing" |
| Trichoptera | "a caddisfly" |
| Ephemeroptera | "a mayfly" |
| Plecoptera | "a stonefly" |
| ... | (add as DB grows) |

Plus life stages:
- "a caterpillar", "a larva", "a nymph", "a pupa"

Negative classes (not insects — used to tag false positives so we can drop them):
- "a flower", "a leaf", "a stem", "a rock"

### Why DB-derived + code-derived hybrid

- **DB-derived (taxa coverage)**: only include order-prompts for orders we have. No "a termite" prompt if we have zero termite photos.
- **Code-derived (lookup table)**: order→common-name mapping is prompt engineering, not data. Lives in code alongside the prompt builder.
- **`common_name` field in DB stays for UI display**, NOT for prompts. Species-level common names ("Twice-stabbed Stink Bug") are exactly the long-tail vocabulary VLMs don't know reliably per Parashar.

### When to update the prompt

- DB grows a new `taxon_order` not in `ORDER_TO_COMMON_NAMES` → add entry → bumps prompt_version
- Empirical evidence that a different phrase performs better → add or substitute → bumps prompt_version
- Any prompt change invalidates §1 + §2 labels for affected images (treated as a labeled-data regeneration event)

## Label taxonomy — 4 columns

The validator UI presents labels in 4 columns aligned with the technical components that produce them. Each column has its own color. The "good" default at the top of each column is the gate-pass state for that column.

### Column 1 — BBox (green when selected)

Mutex set of 3. Describes whether the detector picked the right region. Human-set only.

| display | snake_case | semantic |
|---|---|---|
| Correct & Not Clipped | `bbox_correct-subject_not-clipped` | DEFAULT. Bbox is on the right bug and captures its full body. |
| Correct & Clipped | `bbox_correct-subject_clipped` | Bbox is on the right bug BUT cuts off body parts. |
| Wrong Subject | `bbox_wrong-subject` | Bbox is on the wrong subject (flower, leaf, different bug). |

### Column 2 — BBox Content (amber when selected)

Describes what is INSIDE the chosen bbox. Count category is mutex (one of 4); size flag is independent boolean; image-multi-bug is informational only.

| display | snake_case | mutex group | how set |
|---|---|---|---|
| Single (default) | `bbox-content_single` | count | rule labeler when n_in_bbox == 1 |
| No Bug | `bbox-content_no-bug` | count | rule labeler when confidence < threshold or no detection |
| Multibug Unusable | `bbox-content_bbox-multibug_unusable` | count | rule labeler when n_in_bbox ≥ 2 (default hard reject form) |
| Multibug Usable | `bbox-content_bbox-multibug_usable` | count | human only (mutex with unusable) |
| Subject Too Small | `bbox-content_subject-too-small` | independent | rule labeler when bbox_long_edge_px < 512 |
| Image Multi-Bug | `bbox-content_image-multi-bug` | independent; INFORMATIONAL ONLY (not a gate signal) | rule labeler when n_distinct_in_image ≥ 2 (existing n_distinct_detections logic) |

**Bbox-content multibug autoselect rule** (replaces existing image-level n_distinct):
```python
def count_bugs_in_primary_bbox(primary_bbox, all_high_conf_detections):
    px, py, pw, ph = primary_bbox
    count = sum(
        1 for det in all_high_conf_detections
        if (px <= det.x + det.w/2 <= px + pw) and (py <= det.y + det.h/2 <= py + ph)
    )
    return count
```

If `count >= 2` → autoselect `bbox-content_bbox-multibug_unusable`. Human can switch to `_usable`.

`bbox-content_image-multi-bug` is set by the current image-level `n_distinct_detections` logic — flagged for analytics + future use, NOT used by the gate.

### Column 3 — Mask Rule (sky-blue when selected)

Mask-derived labels. Each rejection independent; blur pair mutex.

| display | snake_case | mutex group | how set |
|---|---|---|---|
| Good (default) | `mask_good` | (none) | default when no rejection labels selected |
| Poor Contrast | `mask_poor-contrast` | independent | rule labeler (via `lab_delta_e`); may move to ML labeler |
| Blur Unusable | `mask_blur_unusable` | blur pair | ML labeler when trained; rule when ML unavailable |
| Blur Usable | `mask_blur_usable` | blur pair | ML labeler when trained; mutex with unusable |

**Visual distinction between rule-set and ML-set labels within §3**:
- ⚙ icon next to label → rule labeler set this
- 🤖 icon next to label → ML labeler set this (with probability shown inline, e.g., `mask_blur_unusable 🤖 0.82`)
- Both icons → rule fired AND ML labeler also predicts (we get to see when they agree/disagree)
- No icon → human-set
- This distinction is critical for evaluating "is the mask actually adding value" vs "should we drop the segmenter"

### Column 4 — ML Label (pink when selected)

Catch-all for image-level labels not bbox- or mask-specific.

| display | snake_case | how set |
|---|---|---|
| Good (default) | `ml_good` | default when no rejection labels selected |
| Other Bad | `ml_other-bad` | human only (catch-all rare cases) |

Future image-level ML labels (e.g., "wrong species class", "image-mostly-background") would land here.

### Gate logic

Reject if ANY of:
- §1: anything other than `bbox_correct-subject_not-clipped`
- §2: count != `bbox-content_single`, OR `bbox-content_subject-too-small` is set
- §3: any selection other than `mask_good` (including soft-reject _usable variants)
- §4: any selection other than `ml_good`

`bbox-content_image-multi-bug` does NOT contribute to gate decision.

All four columns "good" → keep.

## A/B testing methodology

### Per-variant pipeline runs

Each (segmenter, ML-labeler-version) combination runs over the same image set. Parquet rows tagged with `variant = "{detector}__{segmenter}__{prompt-version}"`. Filter parquet by variant for comparison.

### Per-label F1 with bootstrap confidence intervals

`evaluate_pipeline.py` extends current functionality with:
- Bootstrap (B = 2000) confidence intervals on per-label F1 — per [arXiv 2309.14621](https://arxiv.org/abs/2309.14621)
- McNemar's test for paired classifier comparison
- PR curve per label at thresholds 0.01–0.99

### Sample size targets (research-backed)

Per [F1 CI literature](https://sebastianraschka.com/blog/2022/confidence-intervals-for-ml.html) + [object detection eval guides](https://blog.roboflow.com/object-detection-metrics/):

| evaluation | minimum positives per label | rationale |
|---|---:|---|
| Directional A/B (spot major differences) | 30 per label | F1 CI ±0.10 |
| Statistical A/B (publish-quality) | 100 per label | F1 CI ±0.05 |
| Bbox AP A/B (manual ground truth bboxes) | 30 directional, 100 statistical | Object detection standard |
| Active learning batch | 20-30 per round with diversity sampling | Per [Encord guide](https://encord.com/blog/active-learning-machine-learning-guide/), [Nature SR 2024](https://www.nature.com/articles/s41598-023-50598-z) |

**Current label counts and gap to "directional A/B":**

| label | current | target (directional) | gap |
|---|---:|---:|---:|
| `mask_blur_unusable` | 77 | 30 | ✓ exceeds |
| `mask_blur_usable` (was partially-usable) | 50 | 30 | ✓ exceeds |
| `bbox_correct-subject_clipped` (post-migration) | ~38 | 30 | ✓ |
| `bbox-content_bbox-multibug_unusable` | ~42 | 30 | ✓ |
| `mask_poor-contrast` | 15 | 30 | **need 15 more** |
| `bbox_wrong-subject` (post-migration) | ~16 | 30 | **need 14 more** |

**Hard rule: do not run A/B tests until target sample size hit for the affected labels.** Active learning grows these counts as the first deliverable in Phase 4.

### Ablation tests for SAM contribution

For each mask-dependent label (initially `mask_blur_*`, `mask_poor-contrast`):
1. Classifier with only bbox-derived features → AUC_no_mask
2. Classifier with bbox + SAM 3 mask features → AUC_sam3

Decision rule:
- If AUC_sam3 − AUC_no_mask ≥ 0.05 → mask features helpful; keep segmenter
- Otherwise → drop segmenter from pipeline entirely (saves inference cost, drops a failure mode)

This is the unconditional test of whether SAM 3 earns its keep.

## Labeling state model + active learning

### Storage

Labels live in `data/cache/labels.json`. **Added exception to `.gitignore` (`!data/cache/labels.json`)** so the file is version-controlled. Every label edit becomes a git change. Commit cadence: end-of-session batch commits.

`audit/` folder deleted. Validator HTML moves to `tools/validator/` (`tools/validator/v1.html`, etc.). Backup of pre-migration labels.json kept at `tools/manual-labels-backups/labels-2026-05-15-174559.json`.

### PU loss vs class-weighted standard loss

Honest position from research:
- Per [arXiv 2306.16016](https://arxiv.org/pdf/2306.16016) and [arXiv 2002.04672](https://ar5iv.labs.arxiv.org/html/2002.04672): PU learning fits the "positive labels reliable, absence ambiguous" pattern of our data.
- Per [Bekker & Davis 2018 PU survey](https://link.springer.com/article/10.1007/s10994-020-05877-5): "PU learning is appropriate whenever the dataset consists of a small sample of reliable positives and a much larger remaining sample of unknown-label instances."
- BUT: PU performance at small data scales is unpredictable.

**Approach**: per-label, train BOTH `LogisticRegression(class_weight='balanced')` and PU loss (Elkan-Noto two-step). 5-fold cross-validation. Pick the better performer empirically. Don't commit philosophically to PU; commit empirically to whichever works for each label.

### Active learning candidate surfacer

`active_surfacer.py`:
- Per label, computes model confidence for unlabeled / unreviewed images
- Surfaces images with confidence near the decision boundary (uncertainty sampling)
- Clusters uncertain candidates by feature embeddings, samples ≤1 per cluster (diversity sampling — per [Encord guide](https://encord.com/blog/active-learning-machine-learning-guide/))
- Output: JSON manifest of (label, image_id, surfacing_reason) consumed by validator UI
- Per-label budget: 20-30 surfaces per round
- Stop criterion: when new labels stop moving per-label F1 by ≥0.02 across 3 consecutive rounds, pause that label's surfacing

## Re-runnable PR curve tool

`pr_curves.py`:
- Reads parquet + labels.json
- For each label with classifier-emitted probabilities: PR curve over threshold range 0.01-0.99
- Outputs:
  - Markdown table of (threshold, precision, recall, F1) per label
  - PNG plot per label saved to `docs/pr_curves/<date>/<label>.png`
- Used by user to set per-label thresholds and monitor model regressions over time
- Designed for repeated re-runs as new labels and model versions accumulate

## Validator UI changes

### Replace crop preview with bbox-zoom

- Right pane shows live CSS-based bbox-zoom (no separate file): original image scaled and positioned so bbox region fills the pane.
- **Red border** on bbox-zoom when `bbox_long_edge_px < 512`.
- Crop preview JPEG generation stops in the pipeline.

### 4-column label grid

Replace flat label grid with the 4-column structure above. Per-column color, "good" default at top.

### Per-bbox text-label overlay

For each bbox drawn on the original image (primary + secondaries):
- Small text in corner of the bbox: `phrase·confidence` (e.g., `butterfly·0.45`)
- If matched phrase is a NEGATIVE class (flower/leaf/stem/rock): render bbox in red/orange to flag false positive
- Enables fast visual `bbox_wrong-subject` detection

### Source-of-label visual indicators in §3

- ⚙ rule-set label
- 🤖 ML-set label + inline probability
- Both icons when rule and ML agree (or disagree)
- No icon = human-set

### Subtle "originally suggested" border

Any label set by rule labeler OR ML labeler retains a subtle persistent border even after user toggles it off. Lets user see what was system-suggested vs user-set after edits.

### Drop descriptive text

User knows the bbox color scheme. Remove the "primary pink · cyan = N other detections" caption.

## Iteration roadmap (4 phases — simplified)

**Phase 1 — Refactor for swappability** (no behavior change)
- Extract `features.py`, rename `classify.py` → `rule_labeler.py`, rename `pipeline.py` → `classify.py`, move detector/segmenter to packages, add factories, define Protocols, wire into classify.py orchestrator. Tests verify identical output.

**Phase 2 — Swap to SAM 3 + DB-driven prompt + label vocabulary migration**
- Add `detectors/sam3.py` + `segmenters/sam3.py` (same model, both interfaces)
- Add `prompt_builder.py` (DB-driven order common names + negative classes)
- Run full ablation test: blur classifier features WITH vs WITHOUT mask. Decision: keep or drop segmenter.
- Migrate `labels.json` to new vocabulary (script then deleted per repo convention)
- Rebuild validator HTML with 4-column UI + bbox-zoom + text-label overlay
- Re-run `evaluate_pipeline.py` against migrated labels

**Phase 3 — ML labelers + active learning**
- Build `active_surfacer.py` and `pr_curves.py`
- Grow underrepresented labels via active labeling until each hits 30-positive directional threshold (priority: `mask_poor-contrast`, `bbox_wrong-subject`)
- Train v0 blur 3-class classifier (PU vs class-weighted; pick per-label winner)
- Optionally migrate `mask_poor-contrast` from rule to ML labeler if rule F1 stays low

**Phase 4 — Gate calibration + 34k run**
- Sweep gate precision/recall trade-off; pick threshold for target precision ≥0.94
- Run full pipeline on 34k images. Sample-review 50 keeps + 50 rejects visually
- Decision: ship to gallery, or iterate

## Data migration plan

Labels.json migration (one-shot script, deleted after run):

| current label | action |
|---|---|
| `crop-too-tight`, `crop-too-loose`, `cropped-good` | DELETE entirely |
| `subject-blurred_partially-usable` | rename → `mask_blur_usable` |
| `subject-blurred_unusable` | rename → `mask_blur_unusable` |
| `subject-blurred` (legacy) | rename → `mask_blur_unusable` |
| `original-good` | DELETE (semantic now = absence of rejections) |
| `subject-clipped` | migrate → `bbox_correct-subject_clipped` |
| `bbox-wrong_correct-subject` | migrate → `bbox_correct-subject_clipped` |
| `bbox-wrong_better-subject-other-bbox` | migrate → `bbox_wrong-subject` |
| `bbox-wrong` (legacy) | migrate → `bbox_correct-subject_clipped` (conservative) |
| `no-bug` | rename → `bbox-content_no-bug` |
| `bug-too-small` | rename → `bbox-content_subject-too-small` |
| `multi-bug` | rename → `bbox-content_bbox-multibug_unusable` (default; human can switch to _usable) |
| `poor-contrast` | rename → `mask_poor-contrast` |
| `other-bad` | rename → `ml_other-bad` |

Post-migration: every entry uses new vocabulary. Backup at `tools/manual-labels-backups/labels-2026-05-15-174559.json` preserves pre-migration state.

Crop preview file cleanup:
- Delete `audit/framing-validator/crops/v1_dino_insectsam/`
- Delete `audit/` folder entirely after validator HTML moves to `tools/validator/`

Parquet column cleanup:
- Legacy `framing_quality` string column dropped in a schema version bump (Phase 3).

`.gitignore` change:
- Add: `!data/cache/labels.json` (track labels)
- Add: `!data/cache/secondary_bboxes.json` (track sidecar — useful for debugging)

## Apple Silicon optimization

The pipeline targets Apple M5 Max (the dev machine). Confirmed compatibility:

- PyTorch MPS device used throughout (`device="mps"`)
- F32 dtype required — MPS F16 Metal kernels have known issues
- SAM 3 works on MPS via Hugging Face transformers ([HF SAM 3 discussion](https://huggingface.co/facebook/sam3/discussions/11))
- Install pin: `pip install git+https://github.com/huggingface/transformers torchvision` (need transformers main branch as of Nov 2025 for SAM 3 support; pinned in `requirements.txt`)
- SAM 3 video processor has a known `pin_memory()` MPS bug ([ultralytics issue #22954](https://github.com/ultralytics/ultralytics/issues/22954)) — we don't use video, so unaffected
- Memory pressure: M5 Max with 128GB has ample headroom (SAM 3 weights ~3.4 GB, <4 GB inference)

## Out of scope

- Detector A/B testing (we commit to SAM 3 based on published evidence; revisit only on hard failure)
- MM-Grounding-DINO, OWLv2, Florence-2, PaliGemma 2, YOLO-World wrappers (dropped — SAM 3 is sufficient)
- Re-ranker for bbox-wrong cases (needs ≥30 `bbox_wrong-subject` labels first)
- HRSAM or >1024px high-res segmentation models
- DINO-X (API-only, can't run on 34k locally)
- Negative labeling UI (PU learning handles absence cleanly)
- Visual mask quality review as routine check (replaced by downstream-metric ablation only)
- Image-level multi-bug as gate signal (kept as informational `bbox-content_image-multi-bug`)
- Auto-crop preview generation
- Cropped-image classifier (separate concern; only revisit if base classifier insufficient)

## Risks

1. **SAM 3 PCS underperforms on insects** despite published numbers. Mitigation: keep GroundingDINO code intact; can swap back as a one-line config change if SAM 3 degrades labeled F1.
2. **DB-driven prompt missing common name for an insect order in the dataset** → that order's bugs get only the generic "an insect" anchor. Mitigation: prompt_builder logs unmatched orders; we add to lookup as encountered.
3. **Mask quality regression on field photos vs DIOPSIS distribution**. Mitigation: ablation test in Phase 2 directly compares with-mask vs without-mask classifier AUC; if mask doesn't help, drop the segmenter.
4. **Active learning produces diminishing returns** before precision target hit. Mitigation: explicit stop criterion (F1 change < 0.02 across 3 rounds).
5. **PU loss training instability** on small label sets. Mitigation: compare PU against class-weighted in CV; pick winner empirically per label.
6. **Locked-parameter discipline breakdown**: someone changes a threshold without re-running A/B → invalidates labels silently. Mitigation: enumerate locked params in CLAUDE.md; CI check (future) compares pipeline output against a baseline.
7. **DB grows a new order without a prompt entry** → silent gap. Mitigation: prompt_builder warns at startup; new orders added to lookup before next pipeline run.

## Open questions to resolve during implementation

- **Does SAM 3 PCS expose per-instance text labels** (which prompt phrase matched each instance) when given multi-class prompts? With a single-class prompt ("an insect"), all instances trivially match. With negative classes in the prompt, we need per-instance phrase to drop non-insect detections. If SAM 3 doesn't expose this directly, fallback options: (a) separate inference call per phrase; (b) post-hoc text-image embedding similarity. Verify in Phase 2.
- **bbox-content multi-bug rule rewrite**: switch `n_distinct` from image-level to centers-inside-primary-bbox. Existing `multi-bug` user labels may need partial re-review since the semantic changed. Decide acceptable re-review effort in Phase 2.
- **`mask_poor-contrast` ML promotion**: if Phase 3 shows current rule F1 stays below 0.5 even after segmenter swap, train ML labeler. Decide based on Phase 2 + 3 data.

## Success criteria

The system "ships" when:
- Drawability gate F1 ≥ 0.85 on the human-labeled set (computed against the strict-gate decision)
- Gate precision ≥ 0.94 on a fresh held-out sample (≥50 randomly sampled images visually reviewed)
- All four columns have non-trivial label counts (avoid "everything ml_other-bad" failure)
- 34k full run completes in <4 hours wall time
- Sample-review of 50 keeps + 50 rejects from 34k finds ≤3 disagreements

When all criteria met → ship to gallery via Phase H wiring (separate spec).

---

End of spec.
