# Modular Label Pipeline — Design Spec

**Author:** ad0ll + Claude
**Date:** 2026-05-15
**Status:** approved (pending user review)
**Type:** Architecture redesign + iteration roadmap

---

## Summary

The line-of-bugs gallery filter needs to evolve from a single-variant hard-coded pipeline (DINO + InsectSAM + rule labels) into a modular system where the detector, segmenter, and per-label ML labelers can be swapped, A/B tested, and replaced as we collect more labels. The current pipeline has measured weaknesses against 318 human labels: `multi-bug` F1 = 0.31, `poor-contrast` F1 = 0.39, `subject-clipped` F1 = 0.49, and blur is not predicted at all (127 user labels with no system equivalent). This spec replaces the pipeline with a Protocol-based modular architecture, a 4-column human-label vocabulary that maps cleanly to the technical components, and an iteration plan that uses active learning + PU training to grow labels efficiently from the 318 we have today.

## Goal

Build an automated drawability filter that processes ~34,000 raw insect photos and decides keep/reject per image, with **precision ≥ 0.94** on the keep decision (≤1-3 bad images per 50 shown to a student). The pipeline must:

1. Allow swap-in/swap-out of detection, segmentation, and per-label ML classifier components without rewriting orchestration code.
2. Run A/B tests across model variants on the same human-labeled set, with statistical confidence reporting.
3. Use the 318 existing human labels (and additional labels grown via active learning) as the calibration set.
4. Drop legacy concepts that don't serve the workflow (auto-generated crop previews, cropping-specific labels).

No target gallery size — filter what's unusable, keep what's usable.

## Vocabulary (canonical — to be mirrored to CLAUDE.md)

These terms are precise. Code, comments, and conversation should use them consistently.

- **classify** / **classification** — the whole label-emission pipeline (detection → segmentation → features → rule labeler → ML labeler → gate).
- **rule labeler** — `scripts/detect_subjects/rule_labeler.py` (renamed from `classify.py`). Pure functions emitting labels from scalar features. No ML.
- **ML labeler** — trained ML models under `scripts/detect_subjects/ml_labelers/`. Output probabilities per label.
- **gate** — `scripts/detect_subjects/gate.py`. Combines all label sources into a single keep/reject decision.
- **label** — an individual descriptor (e.g., `bbox_correct-subject_not-clipped`) emitted by rule labeler, ML labeler, or set by human.
- **soft reject** — labels suffixed `_usable` (e.g., `bbox_multibug_usable`, `mask_blur_usable`). Still gate-rejects today, but indicates a more-drawable variant for future use cases (tier-2 gallery, ranked fallback, severity training data).
- **bbox-content label** — a label that describes what is INSIDE the chosen bbox (e.g., `bbox_single`, `bbox_multibug_*`). NOT the same as image-content. If a label asks "what is in the whole image," that's an ML labeler concern, not a bbox rule.
- **soft reject vs hard reject** — both are gate rejections. Distinction is preserved for analytics and future filtering tiers.

## Architecture

Six-stage cascade. Each stage has one responsibility. Stages communicate through Python `Protocol`-typed dataclasses defined in `scripts/detect_subjects/interfaces.py`.

```
image  ──►  Detector  ──►  bbox + per-class signals
                                    │
                                    ▼
                              Segmenter  ──►  mask
                                    │
                                    ▼
                  features.py (geometry from bbox; color/edge from mask)
                                    │
                                    ▼
                  rule_labeler.py (hard-rule labels: §2, §3-rule-portion)
                                    │
                                    ▼
                  ml_labelers/*.py (trained classifiers: §3-ML-portion, §4)
                                    │
                                    ▼
                  gate.py (drawability keep/reject)
                                    │
                                    ▼
            parquet (rows tagged by variant) + labels.json + validator HTML
```

`pipeline.py` is orchestration only — composes the chosen detector + segmenter + classifier set via factory functions, runs the for-loop, and writes parquet rows.

### Protocols

```python
# interfaces.py — contracts every implementation must satisfy

class Detector(Protocol):
    def detect(self, image: PIL.Image, image_id: str | None = None) -> DetectionResult: ...

class Segmenter(Protocol):
    def segment_with_bbox(
        self, image_id: str, image: PIL.Image,
        bbox_xywh_normalized: tuple[float, float, float, float],
    ) -> SegmentationResult: ...

class OneShotDetectorSegmenter(Protocol):
    """For models like SAM 3 PCS that take text and return masks+boxes together."""
    def detect_and_segment(
        self, image: PIL.Image, text_prompt: str, image_id: str | None = None,
    ) -> list[tuple[BBox, Mask, float]]: ...

class MLLabeler(Protocol):
    def predict(self, image_id: str, features: dict) -> dict[str, float]: ...
    # returns {label_name: probability}
```

DetectionResult includes: `bbox_xywh_normalized`, `confidence`, `n_raw_detections`, `n_distinct_detections`, `distinct_subjects`, `text_labels` (NEW — phrase that matched per detection), `detection_ms`.

### Module structure

```
scripts/detect_subjects/
├── pipeline.py                # orchestration only (~120 lines target)
├── interfaces.py              # Protocol definitions
├── features.py                # NEW — compute_geometric_features, compute_mask_features
├── rule_labeler.py            # RENAMED from classify.py — pure rule labels
├── gate.py                    # NEW — keep/reject decision combining all sources
├── schema.py                  # unchanged
├── crop.py                    # crop math kept; previews not saved
├── metrics.py                 # geometric helpers (IoU etc.)
├── ground_truth.py            # unchanged
├── caches.py                  # unchanged
├── label_server.py            # unchanged
├── build_html.py              # updated for new 4-column UI
├── evaluate_pipeline.py       # RENAMED from evaluate_v1.py; adds PR curves + bootstrap CIs
├── detectors/
│   ├── __init__.py            # factory: make_detector(name) → Detector
│   ├── grounding_dino.py      # moved from detector_dino.py
│   ├── mm_grounding_dino.py   # NEW
│   └── sam3.py                # NEW — text-prompted detection mode (PCS)
├── segmenters/
│   ├── __init__.py            # factory: make_segmenter(name) → Segmenter
│   ├── insectsam.py           # moved from segmenter_insectsam.py
│   └── sam3.py                # NEW — bbox-prompted mode
└── ml_labelers/
    ├── __init__.py            # factory + registry
    └── blur.py                # 3-class blur classifier (first to ship)
```

Variant identifier = `(detector_name, segmenter_name)`. Pipeline writes rows tagged with this variant; A/B comparison filters by variant. Existing parquet columns `detector_model`, `segmenter_model`, `variant` already support this.

### Default models

After Phase 2 (segmenter swap):
- Detector: `grounding_dino` initially; revisited in Phase 3 detector bench against `mm_grounding_dino` and `sam3_detector_head` (PCS).
- Segmenter: `sam3` (replaces `insectsam`).

Configuration single source of truth: `config.py` sets `DETECTOR_VARIANT` and `SEGMENTER_VARIANT`. Swapping is a one-line change.

## Label taxonomy — 4 columns

The validator UI presents labels in 4 columns aligned with the technical components that produce them. Each column has its own color. The "good" default at the top of each column is the gate-pass state for that column.

### Column 1 — BBox (green when selected)

Mutex set of 3. Describes whether the detector picked the right region.

| display | snake_case | semantic |
|---|---|---|
| Correct & Not Clipped | `bbox_correct-subject_not-clipped` | DEFAULT. Bbox is on the right bug and captures its full body. |
| Correct & Clipped | `bbox_correct-subject_clipped` | Bbox is on the right bug BUT cuts off body parts. |
| Wrong Subject | `bbox_wrong-subject` | Bbox is on the wrong subject (flower, leaf, different bug). |

**Set by**: human only (cannot be determined by hard rule from bbox geometry alone). Detector A/B uses this column as the eval signal.

### Column 2 — BBox Rule (amber when selected)

Describes what is INSIDE the chosen bbox. The count category is mutex (one of 4); the size flag is independent boolean.

| display | snake_case | mutex group | semantic |
|---|---|---|---|
| Single | `bbox_single` | count (default) | One bug inside the bbox. |
| No Bug | `bbox_no-bug` | count | Zero bugs inside the bbox (or no detection at all). |
| Multibug Unusable | `bbox_multibug_unusable` | count | Multiple bugs in bbox, hard reject form. |
| Multibug Usable | `bbox_multibug_usable` | count | Multiple bugs in bbox, soft reject form (still gate-rejects). |
| Too Small | `bbox_too-small` | independent | Bbox long-edge < 512px (insufficient resolution). |

**Set by**: rule labeler from `n_distinct_detections` (counted WITHIN the primary bbox after Phase 2 rewrite — see §Open questions below), `bbox_long_edge_px`.

**Important semantic**: these labels describe the BBOX. An image with many bugs but a bbox on only one is labeled `bbox_single`. The "image has multi subjects" question is an ML labeler concern, not a bbox rule.

### Column 3 — Mask Rule (sky-blue when selected)

Mask-derived labels. Each independent; blur pair mutex within itself.

| display | snake_case | mutex group | semantic |
|---|---|---|---|
| Good | `mask_good` | default | No mask-derived problems. |
| Poor Contrast | `mask_poor-contrast` | independent | Bug color blends with background (low ΔE). |
| Blur Unusable | `mask_blur_unusable` | blur pair | Subject blurred, hard reject. |
| Blur Usable | `mask_blur_usable` | blur pair | Subject blurred, soft reject form (still gate-rejects). |

**Set by**: rule labeler today (poor-contrast via `lab_delta_e`); ML labeler when built (blur). When ML labeler exists, the predicted probability is shown inline next to each label as a thin visual indicator. A subtle visual tint distinguishes rule-set from ML-set labels.

### Column 4 — ML Label (pink when selected)

Catch-all for image-level labels that aren't bbox or mask specific.

| display | snake_case | semantic |
|---|---|---|
| Good | `ml_good` | default — no image-level problems. |
| Other Bad | `ml_other-bad` | catch-all rare cases not covered by §1–§3. |

Future image-level ML labels (e.g., "image is mostly background", "wrong species class") go here.

### Gate logic

Reject if ANY of:
- §1 not `bbox_correct-subject_not-clipped`
- §2 count != `bbox_single`, OR `bbox_too-small` is set
- §3 anything other than `mask_good` selected (including soft-rejects)
- §4 anything other than `ml_good` selected

All four "good" defaults selected = keep.

## A/B testing methodology

### Per-variant pipeline runs

Each (detector, segmenter) combination runs over the same image set. Parquet rows are tagged with `variant = "{detector_name}__{segmenter_name}"`. Comparison filters parquet by variant.

### Per-label F1 with bootstrap confidence intervals

`evaluate_pipeline.py` (renamed from `evaluate_v1.py`) extends current functionality with:
- Bootstrap (B = 2000) confidence intervals on per-label F1 — per [arXiv 2309.14621](https://arxiv.org/abs/2309.14621) Wilson direct/indirect methods OR sklearn-friendly resampling.
- McNemar's test for paired classifier comparison on the same test set.
- PR curve per label at every threshold from 0.01 to 0.99 (re-runnable, output to markdown + PNG).

### Sample size for confidence

Per [Raschka's CI guide](https://sebastianraschka.com/blog/2022/confidence-intervals-for-ml.html) and the F1 CI literature:
- ≥30 positives per label → directional confidence (F1 CI ±0.10)
- ≥100 positives per label → statistical confidence (F1 CI ±0.05)

Labels below 30 positives today: `poor-contrast` (15), `subject-clipped` (now folded into §1), `bbox-wrong_better-subject-other-bbox` (10), `crop-too-*` (deleted). Active labeling priorities are derived from this — grow underrepresented labels until A/B has statistical confidence.

### Ablation tests for SAM contribution

Three-way ablation per relevant label (blur, poor-contrast):
1. Classifier with only bbox-derived features → AUC_no_mask
2. Classifier with bbox + InsectSAM mask features → AUC_insectsam
3. Classifier with bbox + SAM 3 mask features → AUC_sam3

Decision rule:
- If `max(AUC_insectsam, AUC_sam3) − AUC_no_mask ≥ 0.05` → mask features helpful; keep segmenter.
- Otherwise → drop segmenter from pipeline entirely.

This is THE decision rule for whether SAM is worth investing in.

### Detector A/B

Candidates: `grounding_dino` (current), `mm_grounding_dino` (open-mmlab successor), `sam3_detector_head` (PCS mode).

Eval signals:
- Per-label F1 with CIs on the human-labeled set
- §1 BBox-correctness rate (% images user marked `bbox_correct-subject_not-clipped`)
- bbox IoU vs a ≥30-image manually-labeled bbox ground-truth set (you label boxes manually for a stratified subset to provide an objective IoU signal)

## Labeling state model + active learning

### Storage

Labels live in `data/cache/labels.json` (per current label_server.py implementation). The validator UI uses the 4-column structure above. Each labeled image record stores the snake_case label IDs the user selected.

### PU learning (no negative labels needed)

Per [arXiv 2306.16016](https://arxiv.org/pdf/2306.16016) and [arXiv 2002.04672](https://ar5iv.labs.arxiv.org/html/2002.04672), we use **positive-unlabeled (PU) learning** for classifiers. Treat unreviewed images as "unknown" rather than "negative." This avoids the systematic bias from treating absent labels as confirmed-clean and means we don't need to ask the human to also click "this image is NOT blurry" for every reviewed image.

### Active learning candidate surfacer

A re-runnable tool surfaces images for the human to label next, prioritizing the most label-efficient candidates:
- **Uncertainty sampling**: for each label, surface images where current model confidence is near the decision boundary (≈0.5)
- **Diversity sampling**: cluster the uncertain pool by feature embeddings, sample one per cluster to avoid redundancy ([Encord guide](https://encord.com/blog/active-learning-machine-learning-guide/))
- **Per-label budget**: configurable cap per labeling round (e.g., 50 images per session)
- **Stop criterion**: when new labels stop moving the label's F1 by ≥0.02, that label's surfacing is paused

Active surfacer lives in `scripts/detect_subjects/active_surfacer.py`. Output: a JSON manifest of (label, image_id, surfacing_reason) consumed by the validator HTML.

## Re-runnable PR curve tool

A first-class deliverable. `scripts/detect_subjects/pr_curves.py`:
- Reads parquet + labels.json
- For each label that has at least one classifier-emitted probability, computes the PR curve over the 0.01–0.99 threshold range
- Outputs:
  - Markdown table of (threshold, precision, recall, F1) per label
  - PNG plot per label saved to `docs/pr_curves/<date>/<label>.png`
- Used by user to set per-label thresholds and to monitor model regressions over time.

User can re-run this anytime via `make pr` or direct invocation. Re-running is fast (no model inference; uses cached predictions).

## Validator UI changes

### Replace crop preview with bbox-zoom

Today the right pane in each card shows the auto-generated padded crop JPEG. Replace with:
- Live CSS-based bbox-zoom (no separate file): show the original image scaled and positioned so the bbox region fills the pane.
- Red border on the bbox-zoom pane when `bbox_long_edge_px < 512`.
- Stop saving crop preview JPEGs in the pipeline.

### 4-column label grid

Replace current flat label grid with the 4-column structure above. Each column:
- Own background tint
- "Good" default option at top
- Soft-reject labels visually distinguished within their column

### Drop descriptive text about bbox colors

User knows pink = primary, cyan = secondary. The "primary pink · cyan = N other detections" caption is removed.

### Per-label probability indicator

When ML labeler emits a probability for a label, show it next to the label as a thin visual indicator (e.g., a small bar to the right of the button, alongside the numeric value). Aligns visually with the rule-vs-ML tint distinction.

### Subtle "originally suggested" border

Any label that was set by rule labeler OR ML labeler keeps a subtle persistent border even after the user toggles it off. This way the user can re-review their changes against the original suggestion.

## Iteration roadmap (5 phases)

The implementation plan (a separate doc, written via the writing-plans skill) decomposes these into tasks. Here's the phase shape:

**Phase 1 — Refactor for swappability** (no behavior change)
- Extract `features.py`, rename `classify.py` → `rule_labeler.py`, move detector/segmenter to packages, add factory functions, define Protocols, wire into pipeline. Tests verify identical output to today.

**Phase 2 — Segmenter swap (InsectSAM → SAM 3)**
- Add `segmenters/sam3.py`. Run pipeline with SAM 3 on existing 318-labeled images. Run SAM ablation tests (with-mask vs without-mask for blur classifier proof of concept). Decision: keep SAM 3 as default, OR drop the segmenter entirely if mask features don't help.

**Phase 3 — Detector A/B + manual bbox labeling**
- Label bboxes manually on 30 stratified images (1.5h human time) for objective IoU evaluation.
- Add `detectors/mm_grounding_dino.py` and `detectors/sam3.py` (PCS mode).
- Run detector bench. Compare per-label F1, §1 bbox-correctness rate, IoU AP.
- Decision: pick winner, set `DETECTOR_VARIANT` in config.

**Phase 4 — ML labelers + active learning**
- Train v0 blur 3-class classifier (PU loss; 5-fold CV; report PR curves).
- Build active surfacer tool. Grow underrepresented labels in priority order: `mask_poor-contrast` (15→50), `bbox_correct-subject_clipped` (~38 after migration → 50), `bbox_wrong-subject` (~16 after migration → 30).
- Possibly migrate `mask_poor-contrast` and other weak rules to ML labelers depending on Phase 2 ablation outcomes.

**Phase 5 — Gate calibration + 34k run**
- Sweep gate precision/recall trade-off; pick threshold for target precision ≥0.94.
- Run full pipeline on 34k images. Sample-review 50 keeps and 50 rejects visually.
- Decision: ship to gallery, or iterate.

## Data migration plan

Labels.json migration (one-shot script, deleted after run):

| current label | action |
|---|---|
| `crop-too-tight` | delete from flags |
| `crop-too-loose` | delete from flags |
| `cropped-good` | delete from flags |
| `subject-blurred_partially-usable` | rename to `mask_blur_usable` |
| `subject-blurred_unusable` | rename to `mask_blur_unusable` |
| `subject-blurred` (legacy) | rename to `mask_blur_unusable` |
| `original-good` | drop (semantic replaced by absence of rejections) |
| `subject-clipped` | migrate to `bbox_correct-subject_clipped` |
| `bbox-wrong_correct-subject` | migrate to `bbox_correct-subject_clipped` |
| `bbox-wrong_better-subject-other-bbox` | migrate to `bbox_wrong-subject` |
| `bbox-wrong` (legacy) | migrate to `bbox_correct-subject_clipped` (conservative) |
| `no-bug` | rename to `bbox_no-bug` |
| `bug-too-small` | rename to `bbox_too-small` |
| `multi-bug` | rename to `bbox_multibug_unusable` (default to hard reject; user can re-mark _usable if appropriate) |
| `poor-contrast` | rename to `mask_poor-contrast` |
| `other-bad` | rename to `ml_other-bad` |

After migration: every entry has a label from the new vocabulary. The backup at `audit/manual-labels/labels-2026-05-15-174559.json` preserves pre-migration state.

Crop preview file cleanup:
- Delete `audit/framing-validator/crops/v1_dino_insectsam/` after Phase 2 (no longer used by validator UI).

Parquet column cleanup:
- The legacy `framing_quality` string column becomes unused once the new HTML template stops reading it. Drop in a schema version bump (Phase 4).

## Out of scope

- V2-V6 model variants from the original spec (`OWLv2`, `Florence-2`, `PaliGemma 2`) — dropped except SAM 3. Florence-2 reserved as a separate future evaluation for captioning features.
- Re-ranker for bbox-wrong cases — needs ≥30 `bbox_wrong-subject` labels first.
- HRSAM or other >1024px-resolution segmentation models.
- DINO-X (API-only, can't run on 34k locally).
- YOLO-World (speed-prioritized; not our concern).
- Negative labeling UI (PU learning makes it unnecessary).
- Visual mask quality review as routine check (replaced by downstream-metric-only ablation).
- Image-level multi-bug as a §4 ML label — added only if §2 bbox-content multi-bug proves insufficient.

## Risks

1. **SAM 3 PCS detection mode underperforms on insects** despite published numbers on natural-image benchmarks. Mitigation: keep MM-Grounding-DINO in the bench as fallback.
2. **Active learning produces diminishing returns** before we hit precision target. Mitigation: define stop criterion (per-batch F1 improvement < 0.02 → pause that label).
3. **§2 multibug semantic shift** (image-level → bbox-content) may require detector rule changes — counting distinct subjects only within the primary bbox rather than the full image. Some current `multi-bug` user labels may be re-categorized after the semantic shift; minor manual re-review may be needed.
4. **PU loss training instability** on small label sets (e.g., 15 positives). Mitigation: bootstrap CIs make uncertainty visible; surface uncertainty as a flag rather than as a confident decision.
5. **Detector swap invalidates §1 + §2 labels** (~30 images of re-review per swap). Bounded cost; planned for.
6. **Mask quality unreliable on field photos** — but the SAM ablation explicitly tests whether masks help or hurt. If the answer is "hurt", we drop the segmenter and lose nothing.

## Open questions to resolve during implementation

- Multi-bug rule semantic: counting WITHIN bbox vs image-level. Today's rule uses image-level `n_distinct_detections`. Should the rule be rewritten to count only detections whose centers are inside the primary bbox? This aligns with the bbox-content semantic of `bbox_multibug_*`. Implementation needs to decide.
- Mask-edge-proximity for "subject clipped" — was originally proposed as a Mask Rule label but subject-clipped is now folded into §1 as human-only verification. The mask-edge-proximity heuristic could still be a useful SIGNAL for surfacing candidates to the active learner, even if it doesn't directly emit a label. Decide during Phase 4.
- Should detector A/B label re-review use the 30 manual-bbox-ground-truth images, OR also have user re-review §1 on each detector's output for the 318 labeled images? The plan should pick one to bound effort.

## Success criteria

The system "ships" when:
- Drawability gate F1 ≥ 0.85 on the human-labeled set (computed against the strict-gate decision)
- Gate precision ≥ 0.94 on a fresh held-out sample (≥50 randomly sampled images visually reviewed)
- All four columns have non-trivial label counts (avoid the "everything is `ml_other-bad`" failure mode)
- 34k full run completes in <4 hours wall time
- Sample-review of 50 keeps + 50 rejects from the 34k run finds ≤3 disagreements with the user's judgment

When all criteria met → ship to gallery via Phase H wiring (separate spec).

---

End of spec.
