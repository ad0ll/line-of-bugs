# Phase 4 — Gate Calibration + 34k Full-Dataset Run

**Author:** ad0ll + Claude
**Date:** 2026-05-16
**Status:** approved (provisional — operational details revisit before plan writing, after Phase 3 produces throughput data)
**Type:** Phase 4 implementation design
**Parent spec:** `docs/superpowers/specs/2026-05-15-modular-pipeline-design.md`
**Predecessor:** `docs/superpowers/specs/2026-05-16-phase-3-design.md`

---

## Summary

After Phase 3, the pipeline has SAM 3 in production, the 4-column label vocabulary, ML labelers for at least blur (and possibly `mask_poor-contrast`), and per-label PR curves showing classifier behavior across thresholds. Phase 4 takes the final step: calibrate the drawability gate to hit the parent spec's precision target (≥0.94), run the full pipeline over 34k raw images, and sample-review the output to decide whether to ship to the gallery.

This is the "is the system ready?" phase. Pass = ship; fail = iterate on whichever component is the weakest link.

**Key Phase 4 contingencies:**
- **If Phase 3 ML labelers underperform** (CV F1 too low to deploy) → gate calibration relies more on rule labeler + bbox/bbox-content labels. Possibly lower achievable precision ceiling.
- **If the bbox marathon never hit the 30-positive threshold for some labels** → gate calibration has noisy ground truth for those labels. Need to either downgrade the target or accept noisier gate.
- **If 34k pipeline run hits unforeseen hardware/time limits** → batching/checkpoint strategy needs revision.
- **If sample review hits ≥4 disagreements out of 100** → ship is blocked; iterate on whichever label class dominates the disagreements.

This spec is approved at design intent + contingency callouts. Operational specifics (batching cadence, hardware sizing, sample review process) revisit before plan writing using Phase 3-measured throughput.

## Scope

**In scope:**
- Gate precision sweep tool (`tools/gate_sweep.py`)
- 34k pipeline driver with checkpointing (`tools/run_full_dataset.py`)
- Sample-review tooling (a focused validator mode for 50 keeps + 50 rejects)
- Per-class disagreement analysis on sample-review results
- Decision documentation: ship-to-gallery vs iterate

**Out of scope (later):**
- Gallery wiring itself (parent spec calls this "Phase H — separate spec"; not designed here)
- Production monitoring of the live gallery
- Re-running the pipeline as new images come in (separate operational concern)
- New ML labelers beyond Phase 3 outputs

## Decomposition

```
Phase 3 ships (with ML labelers + PR curves + bbox/marathon labels)
        │
        ▼
Phase 4-prep
   - gate_sweep.py
   - run_full_dataset.py (with checkpoint/resume)
   - sample-review UI mode
        │
        ▼
   User workflow (sequential, NOT parallel):
   1. Gate sweep → pick threshold for ≥0.94 precision
   2. Lock thresholds
   3. Run pipeline on 34k → parquet populated for full dataset
   4. Random sample: 50 keeps + 50 rejects
   5. Sample review → count disagreements
   6. Decide: ship or iterate
```

No parallelism in Phase 4. Each step depends on the previous step's outcome.

## Phase 4-prep deliverables

1. **`tools/gate_sweep.py`** — gate precision/recall sweep:
   - Reads parquet (variant-filtered to active SAM 3 variant) + labels.json
   - For each label-threshold tuple in a sweep range (default: 0.01-0.99 in 0.05 steps):
     - Compute gate decision per labeled image (using rule labels + ML probabilities at threshold)
     - Compute precision, recall, F1 against human gate decision (KEEP if all four columns at default)
   - Output: markdown table per threshold combo + best-precision-meeting-target threshold per ML label
   - Recommends: thresholds that hit ≥0.94 precision with maximum recall
2. **`tools/run_full_dataset.py`** — 34k pipeline driver:
   - Reads `data/db/line-of-bugs.db` for full image list
   - Calls `classify.py:run_v1_on_sample` in batches (default: 500 images per batch)
   - After each batch: checkpoint progress to `data/cache/full_run_progress.json` (which image_ids done, which failed)
   - Resume capability: re-running picks up from last checkpoint
   - Outputs: progress log to stdout + final summary (X processed, Y failed, Z hours)
3. **Sample-review UI mode**:
   - Reuse existing validator template; new URL `/sample-review.html?n=100&seed=42`
   - Loads random sample of 50 KEEPs + 50 REJECTs from the full-dataset parquet
   - User clicks "agree" / "disagree" per image (binary)
   - Disagreement counter visible in UI header
   - Stop button when target sample size reached
   - Output: `data/cache/sample_review_<date>.json` with per-image (image_id, gate_decision, user_agrees) records

## User workflow

1. **Run `tools/gate_sweep.py`** → recommended thresholds for ≥0.94 precision
2. **Lock thresholds in `config.py`** (or new `gate_config.py` if cleaner) → commit
3. **Run `tools/run_full_dataset.py`** → 34k parquet populated (may take hours — checkpoint allows resume)
4. **Run sample-review UI**: 50 keeps + 50 rejects randomly sampled
5. **Click through 100 images** marking agree/disagree
6. **Read disagreement count:**
   - ≤ 3 → success criteria met (parent spec §527); ship to gallery (via Phase H, separate)
   - 4-10 → analyze: which labels dominate disagreements? Likely iterate on that label class (return to Phase 3 active learning, or Phase 2 bbox marathon for additional labels)
   - 11+ → significant calibration miss; revisit gate thresholds, possibly classifier choices

## Success criteria

Phase 4 is "done" when:

- [ ] Gate sweep tool generates a precision/recall table over the full threshold grid
- [ ] 34k pipeline run completes (with errors=0 or documented per-image failures)
- [ ] Sample review of 100 images (50 keep + 50 reject) completed
- [ ] **Disagreement count ≤ 3** OR iteration plan documented + executed → re-run
- [ ] Phase 3 followups all closed
- [ ] Decision documented: ship-to-gallery (proceed to Phase H) OR iterate

Parent spec's full success criteria (parent spec §521-527):
- Drawability gate F1 ≥ 0.85 on labeled set
- Gate precision ≥ 0.94 on held-out sample
- All four columns have non-trivial label counts
- 34k run completes in <4 hours wall time
- ≤ 3 disagreements on 50/50 sample review

## Risks

1. **34k run exceeds 4-hour budget** (parent spec target). Mitigation: throughput measured during Phase 2/3 against ~360 labeled images; extrapolate. If projection exceeds budget, optimize (batch size, parallel image loading, GPU utilization) before launching full run.
2. **Pipeline crashes mid-run on 34k**. Mitigation: checkpoint-and-resume in `run_full_dataset.py` (per-batch progress saved to JSON).
3. **Sample-review disagreements indicate systematic failure** (e.g., all on one label class). Mitigation: by-label disagreement breakdown in the analysis script; clearly identifies which Phase 3 labeler needs more data.
4. **Gate threshold sweep produces no precision-≥0.94 option** (i.e., the classifiers can't hit the target). Mitigation: this surfaces during Phase 4-prep, before launching 34k. Revisit classifier training (Phase 3 retraining with more data) before committing to 34k run.
5. **Storage pressure from 34k parquet rows + per-image cache files**. Mitigation: 34k × ~200KB/row = ~7GB parquet, plus cache (DINO+SAM embeddings) ~50KB/image = ~1.7GB. Well within disk budget on dev machine but worth monitoring.
6. **All four columns don't reach non-trivial counts** (parent spec §525 failure mode). Mitigation: review Phase 3 active learning outputs; if a column is empty after Phase 3, decide whether to ship without it or extend Phase 3.

## Out of scope

- Gallery wiring ("Phase H" per parent spec)
- Continuous deployment / ongoing pipeline runs as data grows
- Re-calibration on data distribution shift (future operational concern)
- Production monitoring dashboards

## Open questions to resolve before plan writing

These will be answered by Phase 2/3 outcomes or by initial Phase 4 research:

- **Pipeline throughput per image under SAM 3 + ML labelers** — measure during Phase 3, project to 34k. Drives batching strategy.
- **Sample-review iteration loop if disagreement ≥ 4** — what specifically does the user iterate on? Likely Phase 3 active learning for the weakest label, but should be a documented decision tree before Phase 4 starts.
- **Sample-review reviewer**: just you? Or do you want a second reviewer for inter-rater check on the 100-image sample? Adds calendar overhead but improves confidence in the precision number.
- **Gate threshold storage**: `config.py` is currently the source of truth for thresholds, but those are coupled with detector params. Should ML labeler thresholds live in a new `gate_config.py`? Decide based on `config.py` size at end of Phase 3.
- **34k storage strategy**: keep full parquet, prune old variant rows, archive to cold storage? Defer until run completes and we see actual size.

## Sources

- Parent spec: `docs/superpowers/specs/2026-05-15-modular-pipeline-design.md`
- Predecessor specs:
  - `docs/superpowers/specs/2026-05-16-phase-2-design.md`
  - `docs/superpowers/specs/2026-05-16-phase-3-design.md`

---

End of spec.
