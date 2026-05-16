# Phase 2 — SAM 3 Swap, Label Vocabulary Migration, 4-Column UI

**Author:** ad0ll + Claude
**Date:** 2026-05-16
**Status:** approved (pending written-spec review)
**Type:** Phase 2 implementation design
**Parent spec:** `docs/superpowers/specs/2026-05-15-modular-pipeline-design.md` (the modular pipeline architecture)

---

## Summary

Phase 1 (refactor) is done. The pipeline now has Protocol-based detector/segmenter factories, an extracted `features.py`, a strict-gate `gate.py` module, and a `cfg.variant_tag()` helper. Behavior is unchanged from pre-Phase-1.

Phase 2 takes the next step: swap GroundingDINO + InsectSAM for SAM 3, ship the DB-driven prompt builder, migrate `labels.json` to the new 4-column vocabulary, rewrite the validator UI in 4 columns, and wire `gate.py` into the live pipeline. **Two behavioral changes ship in parallel: model swap and vocabulary/UI swap.**

The central design constraint is **minimizing the user's re-labeling work**. SAM 3 will pick different bboxes than DINO. The user has 318 existing labels keyed by `image_id`; many will need re-review under SAM 3. Phase 2 provides an IoU-based label transfer tool (gated by a sanity-check validation) to auto-carry-forward labels where SAM 3's bbox barely shifted, so the user re-labels only the subset that actually changed.

## Scope

**In scope:**
- SAM 3 wired as detector + segmenter (default after Phase 2 ships)
- DB-driven prompt builder (`prompt_builder.py`)
- Per-detection phrase wiring (populate `text_label` / `text_label_score` / 6th tuple slot)
- 4-column label vocabulary migration in `labels.json` + parquet schema
- 4-column validator UI rewrite (per parent spec §219-298)
- `gate.py` wired into `classify.py` orchestrator
- `cfg.variant_tag()` replaces `V1_NAME` literal in completion tracking
- Ablation test: with-mask vs without-mask classifier AUC (parent spec §337-347)
- IoU-based label transfer tool with sanity-check validation
- Knob sweep tool + phrase-vs-taxon validator + bbox stability report
- Integration test infrastructure (stub detectors/segmenters for CI)

**Out of scope (Phase 3+):**
- ML labelers (`ml_labelers/` package, blur classifier, etc.)
- Active learning surfacer (`active_surfacer.py`)
- PR curves over thresholds (`pr_curves.py` standalone tool)
- Gate precision calibration to ≥0.94 target (Phase 4)
- 34k full-dataset run (Phase 4)
- Threshold tuning at scale (Phase 3-4)

## Decomposition

Three deliverables that execute in **sequence then parallel**:

```
Pre-work (Phase 2-prep)
        │
        ├──────────────────┐
        ▼                  ▼
   Phase 2a            Phase 2b
   (UI + vocab         (SAM 3 + prompt
    + gate wiring)      + ablation)
        │                  │
        └──────────────────┘
                │
                ▼
   User workflow (post-ship):
   IoU transfer → 20-image sanity check
   → bbox-only labeling marathon → knob tuning
```

**Why this structure:**

- **Pre-work first** decouples the file conflicts. 2a and 2b both touch `classify.py`, `schema.py`, and `evaluate_pipeline.py`. Pre-work lands the shared changes so 2a and 2b can edit independent files in parallel without merge conflicts.
- **2a and 2b parallel** because they touch different layers (vocab/UI vs models) and depend on disjoint files after pre-work.
- **User workflow ordered**: bbox labeling waits until SAM 3 ships (otherwise the user would label DINO bboxes that SAM 3 invalidates).

## Pre-work (Phase 2-prep) — 11 deliverables

Must land **before** 2a and 2b run in parallel:

| # | item | rationale |
|---|---|---|
| 1 | Per-detection phrase wiring in `grounding_dino.py` | 2a's per-bbox text overlay needs phrase data; DINO already emits it, wrapper just dropped it |
| 2 | Schema additions: `text_label` (string), `text_label_score` (float) columns in parquet | Both phases write these; landing first avoids dual schema migrations |
| 3 | `cfg.variant_tag()` invoked in `classify.py` (replaces `V1_NAME` in completion tracking + parquet rows) | Both phases need consistent variant tagging behavior |
| 4 | Wire `gate.py` into `classify.py` orchestrator; write gate decision to parquet | 2a's UI displays gate result; 2b's ablation evaluates against gate output |
| 5 | Re-tag legacy v1 rows: `"v1_dino_insectsam"` → `"grounding_dino__insectsam"` (matches `variant_tag()` format) | Forward-compatible tagging; one-shot migration script |
| 6 | Extract PR curve + bootstrap CI utilities from `evaluate_pipeline.py` → shared module | Both phases use; avoids duplication |
| 7 | `data/cache/labels.json` → git-tracked (`.gitignore` exception per parent spec §353) | Both phases commit edits to it; need version control |
| 8 | Migration script skeleton (framework + dry-run mode; mapping table filled in by 2a) | Decouples script infrastructure from vocab decisions |
| 9 | Relocate validator HTML to `tools/validator/`, delete `audit/` (per parent spec §354-355) | 2a's UI rewrite assumes the file is in the new location |
| 10 | Integration test infrastructure: stub `Detector` / `Segmenter` returning deterministic fixed outputs | Phase 1 had no CI-runnable integration test for `classify.py`; both phases need this for regression assertions |
| 11 | Snapshot current parquet → `tests/python/_phase2_baseline/baseline.parquet` | Regression comparison anchor for both phases (same pattern as Phase 1 T0) |

## Phase 2a — UI + vocab + gate

Independent of model changes; ships with the existing DINO + InsectSAM stack.

**Deliverables:**

- **`migrate_labels.py`** — one-shot script. Applies parent spec's rename mapping (§446-466). Drops the 42 `multi-bug` labels entirely (semantic changed — rule labeler will re-suggest under new vocab). Backs up old `labels.json` to `tools/manual-labels-backups/labels-pre-phase2.json` before rewriting. Deleted after running per repo convention.
- **4-column validator UI** (HTML/JS in `tools/validator/`):
  - Column 1 (BBox): green when set, mutex of 3, human-only
  - Column 2 (BBox Content): amber, count mutex + independent flags, rule labeler auto-fills
  - Column 3 (Mask Rule): sky-blue, blur pair mutex, rule labeler auto-fills today (ML labeler in Phase 3)
  - Column 4 (ML Label): pink, catch-all, human-only today
  - "Good" default at the top of each column = the gate-pass state
- **Bbox-only labeling mode** (UI toggle): focuses Column 1, auto-fills Columns 2-4 with rule labeler suggestions, "Save & next" commits Column 1 + accepts auto-fills. Lets the user blast through bbox labeling without distraction.
- **Stale label warning**: UI flags when a displayed label was set against a different variant than what's currently rendered (uses `variant_tag` from parquet vs the row that produced the label).
- **`label_server.py`** updates: serves new vocab, accepts new label POST payloads, handles soft-reject `_usable` variants.
- **`build_html.py`** updates: renders the 4-column layout, applies per-column colors, draws per-bbox text-label overlays (`phrase·confidence` at each bbox corner; red border for NEGATIVE-class matches).
- **`evaluate_pipeline.py`** vocab refresh: per-label F1 + bootstrap CIs against new label names.

**Verification:**
- Integration tests using stub `Detector`/`Segmenter` produce expected parquet rows under new schema
- `migrate_labels.py` dry-run shows expected rename count + drop count
- Validator UI loads, displays all 4 columns, accepts label edits, persists to `labels.json`
- Stale-label warning fires when expected (parquet variant ≠ label's variant lineage)

## Phase 2b — SAM 3 + prompt + ablation

Model-layer changes. Independent of vocab/UI work after pre-work.

**Deliverables:**

- **`detectors/sam3.py`** — SAM 3 wrapper implementing `Detector` Protocol. Populates `text_label` / `text_label_score` / per-detection phrases from the model output. Loads SAM 3 from `facebook/sam3` on MPS, F32 dtype.
- **`segmenters/sam3.py`** — same model instance, bbox-prompted mode. Per parent spec §91: no separate `OneShotDetectorSegmenter` protocol; the unified mode is implementation-level (share model weights between `Detector` and `Segmenter` instances).
- **`prompt_builder.py`** — DB-driven prompt:
  - Queries `taxon_order` from `data/db/line-of-bugs.db`
  - Maps via `ORDER_TO_COMMON_NAMES` lookup (parent spec §181-197)
  - Appends NEGATIVE classes ("a flower", "a leaf", "a stem", "a rock")
  - Generates version hash (`sha1` truncated)
  - Logs unmatched orders at startup as warnings (so the user knows to add lookup entries)
- **`tools/transfer_labels.py`** — IoU-based label transfer:
  - Inputs: v1 parquet, SAM 3 parquet, current `labels.json`
  - For each labeled image: compute `IoU(SAM3_bbox, DINO_bbox)`
  - IoU ≥ 0.8 → auto-transfer label
  - 0.5 ≤ IoU < 0.8 → auto-transfer ONLY if label was "correct" + new bbox is similar-or-larger; else re-review queue
  - IoU < 0.5 → re-review queue
  - Outputs: auto-transferred `labels.json` + `tools/transfer_review_queue.json`
- **`tools/bbox_stability.py`** — given two parquet variants (or two knob configs), reports % of bboxes with IoU > 0.5 (stable) vs not. Drives re-review queue sizing.
- **`tools/knob_sweep.py`** — extends `evaluate_pipeline.py`. Takes a knob name + value range. Re-runs detector for each value over labeled set. Outputs F1 + IoU stability per value. Uses existing labels as ground truth; flags shifted subset for spot re-review.
- **`tools/phrase_vs_taxon.py`** — reads DB taxa + per-detection phrase from parquet. Outputs "matched phrase agrees with DB taxon" rate per image. No labels needed; DB has the answer. Useful for prompt quality validation.
- **`tools/ablation_mask_features.py`** — implements parent spec §337-347:
  - Train classifier on labeled set with bbox-only features → AUC_no_mask
  - Train classifier on same set with bbox + mask features → AUC_with_mask
  - Decision rule: ΔAUC ≥ 0.05 → keep segmenter; else drop
  - Runs for `mask_blur_*` and `mask_poor-contrast`
  - Output: markdown report + persisted JSON for future re-runs
- **Delete `backfill_secondary_bboxes.py`** — SAM 3 returns distinct_subjects natively; the backfill sidecar becomes redundant.

**Verification:**
- SAM 3 wrapper passes integration tests using stub-replaced model layer
- `prompt_builder.py` startup logs match expected orders for current DB
- IoU transfer tool produces sane queue sizes (sanity check on the 318 existing labels)
- Phrase-vs-taxon validator runs without errors against current parquet
- Ablation produces a markdown report with both AUC values + decision

## Label transfer strategy (validated IoU)

The single biggest risk: forcing the user to re-label all 318 images twice. The strategy minimizes re-label cost via IoU-based transfer, gated by an explicit validation step.

**The transfer logic:**

| IoU(SAM3, DINO) | label was "correct" | label was "wrong" or "clipped" |
|---|---|---|
| ≥ 0.8 | auto-transfer "correct" | auto-transfer same label (probably still applies to similar bbox) |
| 0.5 – 0.8 | auto-transfer ONLY if new bbox is larger-or-similar | re-review queue |
| < 0.5 | re-review queue | re-review queue |

Implicit "user accepted" labels (no bbox-related flag in old vocab) flow through the same logic as "correct."

**Sanity-check protocol (gates the marathon):**

1. After SAM 3 ships and runs over labeled images, user picks **20 images at random** from the existing 318.
2. User manually re-labels those 20 under SAM 3's new bbox (this is part of the marathon anyway — just front-load 20).
3. Run `transfer_labels.py` on the same 20.
4. Compute agreement rate between transferred labels and fresh labels:
   - **≥ 90%** → trust transfer, apply to remaining 298, work through re-review queue normally
   - **70-90%** → tighten transfer rules (drop the 0.5-0.8 auto-transfer band; require IoU ≥ 0.8 for any transfer); re-run transfer
   - **< 70%** → transfer logic unreliable for this dataset; fall back to **full re-label of all 318**

**Confidence basis:**

The IoU primitive is universal in object detection (COCO/PASCAL VOC). The IoU = 0.5 threshold for "matching detection" is the standard floor. IoU ≥ 0.8 as "essentially same bbox" is aligned with high-confidence propagation patterns in tracking literature ([HCC propagation, Liu et al. 2022](https://arxiv.org/pdf/2207.01183)). However, the specific application — IoU-based label transfer across detector versions on the same dataset — is not a canonical published method. The 20-image sanity check exists precisely because the thresholds are educated defaults, not literature-validated values for this use case.

## User workflow after both ship

1. **Run SAM 3 over full image set** (or labeled subset to start) → generates new variant parquet
2. **Run `transfer_labels.py`** → auto-transferred `labels.json` + re-review queue (expect ~150-200 of 318)
3. **20-image sanity check** (per protocol above)
4. **Bbox-only labeling marathon** on the re-review queue + any new images, using UI's bbox-only mode
5. **Knob tuning sweeps** against locked SAM 3 labels (`BOX_THRESHOLD`, `TEXT_THRESHOLD`, `BBOX_CONF_TOLERANCE`, `BBOX_MAX_AREA_RATIO`, `NMS_IOU_THRESHOLD`, `HIGH_CONF_THRESHOLD`)
6. **Mask + ML label review** comes AFTER bbox is locked

The workflow ordering is deliberate — bbox is upstream of everything. If bbox shifts, mask labels and gate decisions become noise. Locking bbox first means all downstream label work has stable foundation.

## Small decisions (baked in)

- **No feature flag** for UI cutover (local-only validator, atomic single-commit cutover)
- **`backfill_secondary_bboxes.py`** kept through 2a (still works for `grounding_dino__insectsam` variant), **deleted in 2b** once SAM 3 exposes `distinct_subjects` natively
- **`labels.json` keyed by `image_id` only** (no variant). Matches parent spec's A/B methodology (parquet variant-tagged, labels image-keyed, joined at evaluation time)
- **Legacy v1 rows re-tagged** to match `variant_tag()` output format (option B from brainstorming; matches forward-compatible tagging)
- **Multi-bug labels dropped** entirely on migration (42 labels). Rule labeler re-suggests under new vocab; user confirms during marathon
- **Sanity check is part of the workflow**, not optional. Gates the bbox labeling marathon
- **Phase 2 ships when both 2a and 2b deliverables land**, not when SAM 3 alone lands

## Success criteria

Phase 2 is "done" when ALL of:

- [ ] Pre-work (11 items) committed and verified
- [ ] Phase 2a deliverables shipped (UI + vocab + gate wiring)
- [ ] Phase 2b deliverables shipped (SAM 3 + prompt + ablation)
- [ ] IoU transfer sanity-check protocol completed (validated or fallen back to full re-label)
- [ ] SAM 3 is in production as default detector + segmenter
- [ ] Bbox-only labeling marathon completed (Column 1 labels locked on the re-review queue)
- [ ] Ablation outcome documented: keep segmenter or drop it (per parent spec ΔAUC ≥ 0.05)
- [ ] All Phase 1 followups closed (none deferred into Phase 2)

Parent spec's overall success criteria (gate precision ≥0.94, full 34k run, <3 disagreements on sample-review) are **Phase 4 deliverables**, not Phase 2.

## Risks

1. **SAM 3 underperforms vs DINO on insects.** Mitigation: keep DINO wrapper + shim in tree through Phase 2; one-line config rollback if SAM 3 degrades F1 against existing labels.
2. **IoU transfer agreement < 70% in sanity check.** Mitigation: explicit fallback to full re-label; the 20-image cost is bounded.
3. **SAM 3 doesn't expose per-detection phrase for multi-class prompts.** Per parent spec §515 open question. Mitigation: pre-work item 1 (per-detection phrase from DINO) gives us the data path; if SAM 3 doesn't expose it directly, fallback to (a) separate inference call per phrase or (b) post-hoc text-image similarity. Verify during Phase 2b implementation.
4. **`labels.json` migration corrupts data.** Mitigation: explicit backup to `tools/manual-labels-backups/labels-pre-phase2.json` before any edit; dry-run mode in migration script; commit gate.
5. **Validator UI breaks during cutover.** Mitigation: no feature flag (single-commit atomic), but commit message includes rollback instructions; pytest integration tests cover label_server endpoints.
6. **Knob sweep tool returns misleading results because shifted-bbox subset is large.** Mitigation: bbox stability report alongside F1 result; user sees both signals.
7. **Multi-bug labels dropped without user review.** Acceptable — user explicitly chose this in brainstorming; rule labeler will re-suggest and user confirms during marathon.

## Out of scope

- ML labelers (`ml_labelers/blur.py`, etc.) — Phase 3
- Active learning (`active_surfacer.py`) — Phase 3
- PR curve tool as standalone utility — Phase 3 (basic PR curves added to `evaluate_pipeline.py` in pre-work item 6)
- Gate precision calibration to ≥0.94 — Phase 4
- 34k full-dataset run — Phase 4
- Threshold tuning at scale — Phase 3-4
- Cropped-image classifier — never (separate concern per parent spec out-of-scope list)
- Detector A/B testing (committed to SAM 3 per parent spec)
- Image-level multi-bug as gate signal (kept informational only)

## Open questions to resolve during implementation

- **SAM 3 PCS per-instance text label exposure.** Parent spec §515. If SAM 3 doesn't return per-detection phrases natively when given multi-class prompts, fallback options: (a) separate inference call per phrase; (b) post-hoc text-image embedding similarity. Verify in Phase 2b's first task.
- **Sanity check sample size.** 20 images is a starting point. If the dataset's bbox shift distribution is bimodal (most images either super-stable or super-shifted), 20 may miss the middle ground. Revisit if validation results look ambiguous.
- **Pre-trained classifier for ablation test.** The ablation needs SOME classifier to compare with-mask vs without-mask AUC. The spec doesn't specify which. Plan to use a simple `LogisticRegression` on the labeled subset (rather than training a deep model just for ablation). Decision point in Phase 2b.

## Sources

- [COCO Detection Evaluation](https://cocodataset.org/#detection-eval) — IoU thresholds for mAP
- [PASCAL VOC devkit doc](http://host.robots.ox.ac.uk/pascal/VOC/voc2012/htmldoc/devkit_doc.html) — IoU = 0.5 as matching detection
- [Fast Vehicle Detection (Liu et al. 2022)](https://arxiv.org/pdf/2207.01183) — HCC propagation at IoU ≥ 0.8
- [Dynamic Label Assignment (Cai et al. 2022)](https://arxiv.org/abs/2201.09396) — threshold-gating pattern for label decisions
- [Re-labeling ImageNet (Yun et al. CVPR 2021)](https://openaccess.thecvf.com/content/CVPR2021/papers/Yun_Re-Labeling_ImageNet_From_Single_to_Multi-Labels_From_Global_to_Localized_CVPR_2021_paper.pdf) — IoU confidence weighting
- Parent spec: `docs/superpowers/specs/2026-05-15-modular-pipeline-design.md`

---

End of spec.
