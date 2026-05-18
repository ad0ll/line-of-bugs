# Phase 3 ML labeler — design spec

**Date:** 2026-05-17
**Status:** brainstormed, pending implementation plan

## Problem

The `rule_labeler` is the only automated source of `suggested_labels` today. Per the n=238 hand-label audit (see `evaluate_pipeline` equivalent in this chat):

- `subject-too-small` rule works (F1=0.91)
- `image-multi-bug` over-fires informationally (F1=0.79)
- `no-bug` rule barely fires (F1=0.60)
- `multibug_unusable` never fires (F1=0)
- `poor-contrast` rule is a coin flip (F1=0.59)
- **No rule for blur** — `mask_blur_unusable` (n=91) is the largest user-labeled category with zero automation

The `MLLabeler` protocol exists in `interfaces.py` but has no implementation. This spec defines the implementation.

## Scope

**In-scope labels** (predict per-image probability, 9 total):

| label | n positives | scope tier |
|---|---:|---|
| `mask_blur_unusable` | 91 | tier-1 (train + gate) |
| `mask_blur_usable` | 39 | tier-1 |
| `mask_bad-photo-quality` | 29 | tier-1 |
| `mask_poor-contrast` | 21 | tier-1 |
| `ml_other-bad` | 5 | tier-2 (train + report, do NOT gate) |
| `bbox-content_partially-concealed` | 4 | tier-2 |
| `bbox-content_no-bug` | 7 | tier-2 |
| `bbox-content_bbox-multibug_unusable` | 5 | tier-2 |
| `bbox-content_bbox-multibug_usable` | 5 | tier-2 |

Tier-2 labels train but their predictions are flagged unreliable. `gate.py` does not consume them. They re-tier to tier-1 once n≥30.

**Out of scope:** col1 BBox correctness labels (`bbox_correct-*`, `bbox_wrong-subject`, `bbox_should-have-bbox`) — these measure SAM 3 quality, not predictable from image features.

## Architecture

Two parallel arms; per-label winner picked via 5×5 stratified CV.

**Image arm:** Frozen DINOv3 ViT-S/16 (Aug 2025, arxiv:2508.10104) + DoRA rank-4 on Q/V (Liu et al., ICML 2024 Oral) + linear head per label. Embedding cached at `data/cache/dinov3_embed/<image_id>.npy`.

**Scalar arm:** TabPFN-v2 (Hollmann et al., *Nature* Jan 2025) on the 12 hand-engineered scalars: `bbox_area_ratio`, `offcenter`, `bbox_min/long_edge_px`, `mask_area_ratio`, `lab_delta_e`, `boundary_sharpness`, `subject_sharpness`, `top10pct_lap_mask`, `edge_density_mask_vs_bg`, `confidence`, `n_distinct_detections`.

**Selection:** For each label, train both arms via 5×5 stratified CV. Winner is whichever has higher mean MCC. The losing arm's predictions are discarded; the winner's `predict_proba` is Platt-scaled and persisted. Rationale: literature is genuinely thin at n=200-500; per-label selection lets statistical signals (poor-contrast → ΔE) pick TabPFN while semantic signals (no-bug, partially-concealed) pick DINOv3.

**Rule label as noisy prior:** `rule_labeler` output for each label becomes an additive bias term in the head's logit (`rule_prior.py`), trained as a single scalar weight per (label, rule) pair. No Snorkel framework. Replaces the discarded prior recommendation of label-model aggregation.

**Cleanlab audit:** Before training, `cleanlab_audit.py` runs `cleanlab.classification.CleanLearning` on each label's training set to surface likely mislabeled examples. Audit report written to `docs/ml_labeler/cleanlab_audit_<timestamp>.md` for manual review. Audit does not auto-modify labels.json.

## Module structure

```
scripts/detect_subjects/ml_labeler/
  __init__.py              # registry + make_ml_labeler factory
  features.py              # build feature dict per image_id (embeds + scalars)
  cleanlab_audit.py        # one-shot label-error surfacing
  train.py                 # per-label train_both_arms_pick_winner
  predict.py               # batch inference; writes predicted_<label>_p cols
  rule_prior.py            # rule-label → bias term per (label, rule) pair
  active_learning.py       # k-means cold-start + BADGE-style uncertainty
  evaluation.py            # 5x5 stratified CV; MCC/PR-AUC/Brier
  models/
    <label>/
      arm_image_<ts>.joblib
      arm_scalar_<ts>.joblib
      latest_symlink       # winner
      metrics.json         # cv_metrics, winner, n_positives
```

Mirrors existing `detectors/` and `segmenters/` modular pipeline pattern.

## Active learning workflow

**Cold-start:** k-means(k=20) on DINOv3 CLS embeddings, sample 1 from each cluster as initial seed set (50-100 labels). Reuses the same embedding cache as training.

**Steady-state:** for the active label, sort unreviewed cards by `|predicted_p − 0.5|` ascending (most uncertain first). User labels these; precision rises with each iteration.

**Retrain triggers:**
- Manual button in validator UI ("Retrain `<label>`")
- Auto: when a label's training set grows by ≥25 positives since last train, banner appears in UI

User starts with low-precision/high-recall thresholds (recall ≥0.95 calibrated initially) and raises them across iterations.

## Validator UI changes

**Header tab strip:** per-label tabs `[all] [blur_unusable: 91p, MCC 0.62] [blur_usable: 39p] [bad_photo: 29p] [poor_contrast: 21p] [+5 unreliable]`. Tab metadata (positive count, current CV MCC) updates on retrain.

**Tab behavior:** clicking a tab filters the grid to that label's most-uncertain unreviewed cards (sorted by `|predicted_p − 0.5|` ascending). Each card shows `pred: 0.83` next to the relevant column header.

**Retrain banner:** when a label has ≥25 new labels since last train, banner appears: "blur_unusable has 25 new labels — Retrain now". Click invokes `train.py` for that label.

## Storage / schema

Parquet schema v3 additions: per label,
- `predicted_<label>_p` (float32) — Platt-scaled probability
- `predicted_<label>_unreliable` (bool) — true if training set <30 positives

Per-label thresholds: `data/cache/gate_thresholds.yaml`. Generated by `train.py` after CV; tunable per active-learning iteration.

## Integration with gate.py

`gate.py` reads `predicted_<label>_p` for each tier-1 label. KEEP decision flips to REJECT if any predicted probability exceeds its threshold. Tier-2 labels' predictions are ignored by gate.

Existing rule labels remain in `suggested_labels` for the validator UI display, but `gate.py` consumes only the ML predictions for the 4 tier-1 labels.

## Evaluation methodology

- **Split:** 5×5 stratified k-fold per arm per label (per arxiv:2502.17361 small-data best practice)
- **Metrics:** MCC (winner selection — F1 over-rewards trivial classifiers on imbalanced labels per Chicco & Jurman 2020), PR-AUC (ranking quality for the active-learning use case), Brier (calibration sanity)
- **Output:** `docs/ml_labeler/eval_<timestamp>.md` with per-label tables + winner-arm record
- **Re-eval cadence:** every retrain

## Drift detection / retraining

- DINOv3 embedding centroid drift via MMD on rolling 100-image window (per DriftLens, arxiv:2406.17813)
- Rule-vs-ML disagreement rate per label
- Either alone triggers "retrain recommended" banner; both together trigger a stronger warning
- Auto-retrain on +25 new labels per label

## Caching & concurrency

Per CLAUDE.md ("Use concurrency in backend code — beefy hardware") and the user's explicit ask:

**Caching:**
- DINOv3 embeddings: `data/cache/dinov3_embed/<image_id>.npy` (lazy populate)
- Scalar features: already in parquet (no new cache)
- Cleanlab confidence scores: `data/cache/cleanlab_confidence_<label>.json`
- Active-learning k-means assignments: rebuilt on each retrain (cheap)
- DoRA-adapted head weights: serialized via joblib in `ml_labeler/models/<label>/`

**Concurrency:**
- Per-label training: `ProcessPoolExecutor` (9 labels, MPS single-tenant per process — cap workers at 2 if both arms image-based, else 4)
- Within a process, CV folds: `ThreadPoolExecutor` for I/O-bound encoder calls
- DINOv3 inference cache pre-population: batched on MPS (batch=16), `ThreadPoolExecutor` for image I/O
- TabPFN-v2 runs on CPU, fully parallelizable across labels independently of MPS
- Cleanlab audit: one-shot, single process

## Out of scope (defer)

- Col1 (bbox correctness) prediction — needs different signal source
- Image augmentation during training — research shows minor gains at our scale, complexity not worth it
- Ensembling image + scalar arms — adds complexity; revisit if neither arm is conclusively better at n>500
- Full encoder fine-tuning (vs DoRA) — research warns against at n<500 (Kumar et al. ICLR 2022 still stands for OOD)

## Open questions / risks

1. **License caveat:** DINOv3 uses Meta's custom license. We're internal-only so it's fine, but flag if we ever distribute model artifacts.
2. **TabPFN-v2 multi-target:** open-source API is single-target; we run 9 one-vs-rest. Confirmed acceptable at our scale (Saito et al. Sep 2025).
3. **Active-learning gain may not materialize:** literature warns AL often doesn't beat random at small n (Munjal CVPR 2022). Mitigation: benchmark against random in the first two AL rounds; if no lift, drop AL and use random sampling.
4. **Tier-2 label predictions:** technically trained but flagged unreliable. The flag must be visible in validator UI so user doesn't trust them prematurely.
5. **DoRA rank choice:** spec uses rank-4 based on CVPR 2025 evidence. May need rank-8 for some labels; pick during eval.

## References

- DINOv3 (Siméoni et al., arxiv:2508.10104, Aug 2025)
- DoRA (Liu et al., ICML 2024 Oral, arxiv:2402.09353)
- PEFT unifying study (Mai et al., CVPR 2025, arxiv:2409.16434)
- TabPFN-v2 (Hollmann et al., *Nature* Jan 2025) + TabPFN-2.5 (arxiv:2511.08667, Nov 2025)
- Cleanlab / confident learning (Northcutt et al., baseline arxiv:1911.00068)
- Foundation-embedding cold-start AL (Yuan & Hong 2024)
- BADGE (Ash et al., ICLR 2020, arxiv:1906.03671)
- DriftLens (arxiv:2406.17813, 2024)
- MCC > F1 for imbalanced (Chicco & Jurman 2020, BMC Genomics)
- Kumar et al. (Fine-tuning distorts features, ICLR 2022, arxiv:2202.10054) — still cited for OOD robustness
