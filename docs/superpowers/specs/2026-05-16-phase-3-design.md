# Phase 3 — ML Labelers + Active Learning

**Author:** ad0ll + Claude
**Date:** 2026-05-16
**Status:** approved (provisional — operational details revisit before plan writing)
**Type:** Phase 3 implementation design
**Parent spec:** `docs/superpowers/specs/2026-05-15-modular-pipeline-design.md`
**Predecessor:** `docs/superpowers/specs/2026-05-16-phase-2-design.md`

---

## Summary

After Phase 2 ships, the pipeline runs SAM 3 + DB-driven prompt + the 4-column label vocabulary, and the user has completed a bbox-only labeling marathon (~150-200 re-reviewed labels). Phase 3 takes the next step: train ML labelers on the labeled set, grow under-represented labels via active learning, and ship a re-runnable PR curve tool for per-label threshold tuning.

The first ML labeler is the **3-class blur classifier** (`mask_blur_unusable` / `mask_blur_usable` / `mask_good`) since that's where the largest current label count exists (77+50=127 examples). Other ML labelers (`mask_poor-contrast` promotion from rule, image-level catch-alls) are downstream candidates if Phase 3's first labeler validates the pipeline.

**Key Phase 3 contingencies (Phase 2 outcomes that change Phase 3 details):**
- **If the ablation (Phase 2b) says "drop the segmenter"** → mask-derived features go away. `mask_blur_*` classifier becomes "use only bbox-cropped image features." `mask_poor-contrast` becomes irrelevant. Significant Phase 3 reshape.
- **If the bbox marathon produces fewer labels than expected** (e.g., user gets fatigued at 100 of 200 re-review) → underrepresented labels stay under-quantified; active learning prioritization shifts.
- **If per-detection text-label exposure works in Phase 2b** → additional features (matched-phrase-vs-DB-taxon alignment) become available for ML labelers.

This spec is approved at design intent + contingency callouts. Detailed task breakdown waits for Phase 2 ship, then revisit.

## Scope

**In scope:**
- `ml_labelers/` package with factory + Protocol implementations
- `ml_labelers/blur.py` — 3-class blur classifier (first to ship)
- `active_surfacer.py` — uncertainty + diversity sampling for candidate labeling
- `pr_curves.py` — re-runnable per-label PR curve tool
- Active surfacer → validator UI integration (surfaced candidates appear in the existing UI)
- `mask_poor-contrast` ML migration **IF** rule F1 stays below decided threshold after Phase 2
- Parquet schema additions: per-label ML probability columns

**Out of scope (Phase 4+):**
- Gate precision calibration to ≥0.94 (Phase 4)
- 34k full-dataset run (Phase 4)
- Image-level ML labelers beyond blur (deferred to Phase 5 or later)
- Cross-label correlation (multi-label joint training)

## Decomposition

```
Phase 2 ships (with bbox labels + ablation outcome)
        │
        ▼
Phase 3-prep (sub-1)
   - ml_labelers/ package skeleton + Protocol wiring
   - pr_curves.py standalone
   - Parquet schema additions for ML probabilities
        │
        ├─────────────────┐
        ▼                 ▼
   Phase 3a          Phase 3b
   (blur classifier   (active learning loop)
   + integration)
        │                 │
        └─────────────────┘
                │
                ▼
   User workflow:
   active surfacer → label → retrain → PR curves → repeat
   until per-label F1 stabilizes (parent spec: F1 change <0.02 across 3 rounds)
```

Phase 3a and Phase 3b are independent after the prep sub-phase. 3a builds the first concrete classifier; 3b builds the labeling-growth loop.

## Phase 3-prep deliverables

1. **`ml_labelers/__init__.py`** — factory pattern mirroring `detectors/` and `segmenters/`:
   ```python
   def make_ml_labeler(name: str, **kwargs) -> MLLabeler: ...
   def registered_ml_labelers() -> list[str]: ...
   ```
2. **`ml_labelers/_base.py`** — shared utilities (cross-validation harness, PU vs class-weighted comparison)
3. **`pr_curves.py`** (standalone tool, not extending `evaluate_pipeline.py`): reads parquet + labels.json. For each label with classifier probabilities: PR curve over thresholds 0.01-0.99. Outputs markdown table + PNG per label to `docs/pr_curves/<date>/<label>.png`. Designed for repeated re-runs.
4. **Parquet schema additions**: `ml_proba__<label_name>` columns (e.g., `ml_proba__mask_blur_unusable`, `ml_proba__mask_blur_usable`). Float, nullable. Populated by classify.py when ML labeler is active.
5. **`classify.py` extension**: when an ML labeler is registered for a label column, call it after feature computation and write probabilities to parquet. Rule labeler still runs in parallel — both populate suggested_labels (with icon distinction per parent spec §270-275).

## Phase 3a — blur classifier

**Why blur first:** highest existing label count (77 unusable + 50 usable = 127 examples, parent spec §326-333).

**Deliverables:**

- **`ml_labelers/blur.py`** — 3-class classifier:
  - Output classes: `mask_blur_unusable`, `mask_blur_usable`, `mask_good`
  - Features: pulls from `features.py` outputs (subject_sharpness, boundary_sharpness, mask area, lab_delta_e) + possibly raw image crop features (depends on Phase 2b ablation outcome)
  - Per parent spec §364: trains **both** `LogisticRegression(class_weight='balanced')` and PU (Elkan-Noto). 5-fold cross-validation. Per-label winner picked empirically.
  - Output: probability per class
- **Training script** `tools/train_blur_classifier.py`: reads parquet + labels.json. Trains both LR + PU. Outputs winner with CV metrics + saved model to `data/cache/ml_models/blur_v0.pkl`.
- **`classify.py` integration**: at startup, load blur model. During pipeline run, compute features → call `blur_classifier.predict(features)` → write probabilities to parquet `ml_proba__*` columns + suggested labels.
- **Validator UI updates** (small): show 🤖 icon on blur labels with inline probability (per parent spec §272 — `mask_blur_unusable 🤖 0.82`). Existing ⚙ icon shows rule-set labels (Phase 2 deliverable, may need to be added in 3a if not yet present).

**Verification:**
- 5-fold CV F1 per class meets some bar (TBD — `>0.7` if labels permit?)
- PR curve generated for each class
- Integration test: run classify.py against 5 known images; assert ml_proba columns populated; assert suggested_labels include blur labels with appropriate confidence

## Phase 3b — active learning loop

**Deliverables:**

- **`active_surfacer.py`**:
  - Per label, computes model confidence for unlabeled / unreviewed images (uses classifier from Phase 3a + future labelers)
  - Surfaces images with confidence near the decision boundary (uncertainty sampling)
  - Clusters uncertain candidates by feature embeddings; samples ≤1 per cluster (diversity sampling per parent spec §371)
  - Per-label budget: 20-30 surfaces per round (parent spec §373)
  - Output: JSON manifest `data/cache/active_surfacing.json` with `{label_name: [{image_id, confidence, surfacing_reason, cluster_id}]}`
- **Validator UI integration**: new filter option "Active surfacing queue" alongside existing sort/filter dropdowns. When selected, shows only images in the active surfacing manifest, grouped by label.
- **Stop criterion implementation**: per parent spec §374 — "F1 change <0.02 across 3 consecutive rounds per label." `active_surfacer.py` reads PR curve history and refuses to surface for a label that's stable.
- **Round automation**: `tools/run_active_round.py` — orchestrates: (1) train current labelers, (2) generate active surfacing manifest, (3) prompt user to label via UI, (4) retrain on commit. Manual trigger — user runs when ready.

**Verification:**
- Stop criterion: synthesize 3 rounds of fake F1 history with deltas <0.02 → assert surfacer skips that label
- Uncertainty boundary detection: synthesize predictions clustered near 0.5; assert all surface
- Diversity sampling: synthesize 30 candidates in 5 feature clusters; assert at most 5 surface

## User workflow after both ship

1. **Run `tools/train_blur_classifier.py`** → produces v0 blur model + CV metrics report
2. **Re-run `classify.py` with blur model active** → parquet populated with ML probabilities
3. **Run `tools/run_active_round.py`** → produces surfacing manifest
4. **Label via validator UI** (use "Active surfacing queue" filter) → labels.json updates
5. **Re-train** → updated model + PR curve
6. **Repeat 3-5** until stop criterion met for target labels (per parent spec §332: `mask_poor-contrast` needs +15, `bbox_wrong-subject` needs +14)
7. **Decide on `mask_poor-contrast` ML promotion** based on PR curves (TBD threshold — see Open Questions)

## Success criteria

Phase 3 is "done" when:

- [ ] `ml_labelers/` package + factory operational
- [ ] Blur classifier shipped: CV F1 reported, PR curves generated, integrated into `classify.py`
- [ ] `pr_curves.py` standalone tool working
- [ ] `active_surfacer.py` shipped: surfaces candidates, respects stop criterion
- [ ] Active learning rounds completed for `bbox_wrong-subject` and `mask_poor-contrast` until 30-positive directional threshold hit (parent spec §332)
- [ ] Decision documented: is `mask_poor-contrast` migrated to ML or kept as rule?
- [ ] All Phase 2 followups closed

## Risks

1. **Ablation (Phase 2b) says "drop segmenter"** → blur classifier loses mask features. Mitigation: train fallback variant on bbox-cropped image features only; reuse same training script.
2. **PU loss instability on small data** → parent spec §367 acknowledges this. Mitigation: per-label LR vs PU empirical comparison; pick winner. Don't commit philosophically to PU.
3. **Active learning produces diminishing returns** before label-count target hit. Mitigation: explicit stop criterion (parent spec §374). If a label can't be grown to 30 positives, downgrade to "rule labeler only" for that label.
4. **CV F1 too low to deploy** (e.g., blur F1 < 0.5). Mitigation: don't ship the classifier; fall back to rule-labeler-only for that label until more data accumulates.
5. **User fatigue during active learning rounds** — 20-30 surfaces × 6 labels × 3 rounds = ~500 decisions. Mitigation: rounds are user-initiated, not automated; user controls pace.

## Out of scope

- 34k full-dataset run (Phase 4)
- Gate precision calibration (Phase 4)
- Image-level ML labelers beyond blur (deferred)
- Joint multi-label training / label correlations (deferred)
- Cropped-image classifier (never per parent spec out-of-scope)

## Decisions made for plan writing

Resolved using judgment + parent spec defaults. Each is a defensible default — revisit if Phase 2 data invalidates the choice.

- **Ablation outcome from Phase 2b**: genuinely unknown until Phase 2b ships. Plan written assuming **"segmenter STAYS"** (mask features available). Plan includes one explicit fallback task — "if ablation result = drop, swap blur classifier feature set from `{subject_sharpness, boundary_sharpness, mask_area_ratio, lab_delta_e}` to `{subject_sharpness, bbox-cropped image embedding from CLIP}`."
- **Final label counts after marathon**: unknown. Plan handles generically — each active learning task checks per-label count at runtime and skips labels already above target (30 positives directional).
- **`mask_poor-contrast` ML migration trigger**: **F1 < 0.5** on the rule labeler against post-Phase-2 labels. If rule F1 ≥ 0.5, keep as rule labeler (avoid premature ML complexity). If F1 < 0.5, train ML labeler in Phase 3.
- **Active surfacer embedding source for diversity clustering**: **CLIP `openai/clip-vit-base-patch32`**. Justification: (a) SAM 3 visual features not confirmed exposed in HF output surface; (b) CLIP is well-understood, ~150MB model, fast on MPS; (c) feature-vector clustering (13 scalars from features.py) won't cluster meaningfully. CLIP was already a transitive dep via the deleted `blur_model_bench.py` — re-adding is cheap.
- **PR curve sample size**: **start at directional (30 positives per label)**; push to statistical (100) only if Phase 3 active learning shows rule labeler can't reach Phase 4 gate target with 30. Pragmatic — don't over-collect labels if directional is enough.
- **Active learning round budget**: **20-30 per round per label** (parent spec default). User can lower per-round if fatigued.

## Sources

- Parent spec: `docs/superpowers/specs/2026-05-15-modular-pipeline-design.md`
- Predecessor spec: `docs/superpowers/specs/2026-05-16-phase-2-design.md`
- [Encord active learning guide](https://encord.com/blog/active-learning-machine-learning-guide/) — uncertainty + diversity sampling
- [PU learning survey (Bekker & Davis 2018)](https://link.springer.com/article/10.1007/s10994-020-05877-5)
- [F1 confidence intervals (Raschka 2022)](https://sebastianraschka.com/blog/2022/confidence-intervals-for-ml.html)
- [arXiv 2306.16016 — PU learning practical guide](https://arxiv.org/pdf/2306.16016)
- [Nature SR 2024 — active learning sample size](https://www.nature.com/articles/s41598-023-50598-z)

---

End of spec.
