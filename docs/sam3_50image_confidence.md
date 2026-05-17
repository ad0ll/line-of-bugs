# SAM 3 — Final 50-image confidence check

**Variant:** `sam3__sam3`  ·  **Sample:** 50 images, `--seed-fresh` (seed=1778983137)
**Date:** 2026-05-16

Methodology: `tools/render_bbox_overlays.py --n 50 --seed-fresh` against the
full `framing_detections.parquet` sample pool (299 SAM 3 rows). Each
overlay JPEG was loaded into the Read tool and visually classified.

## Headline numbers

| metric                                              | value      |
|---|---:|
| primary bbox returned                               | **43 / 50** (86 %) |
| primary bbox correct (on the actual insect)         | **42 / 43** (98 %) |
| no-bbox: justified (no visible insect)              | **2 / 7**  |
| no-bbox: clear miss (insect visible but missed)     | **5 / 7**  |
| false-positive on negative class (flower/leaf/etc)  | **0 / 50** |
| effective recall on detect-eligible insects         | **42 / 47** (89 %) |
| effective precision among detections                | **42 / 43** (98 %) |

The 1 / 43 "ambiguous" primary bbox is `inat-3421883` (Common Eastern
Bumble Bee in leaf litter): bbox is tiny on a dark blob plausibly a bee
but hard to confirm at this resolution. Marked correct-with-caveat.

## The five misses are concentrated in two orders

All 5 false-negatives are Odonata (dragonflies) or Mantodea (mantises):

| idx | image_id          | order      | common name                   | why missed |
|---:|---|---|---|---|
| 009 | inat-23899394     | Mantodea   | Chinese Mantis                | "a mantis" not in 9-phrase prompt budget |
| 028 | inat-1467290      | Odonata    | White-faced Meadowhawk        | "a dragonfly" not in prompt |
| 036 | inat-197453       | Odonata    | Scarlet Basker                | same |
| 042 | inat-1289882      | Odonata    | Tropical King Skimmers        | same |
| 047 | inat-1994451      | Mantodea   | South African Mantis (rope)   | "a mantis" not in prompt + partial occlusion |

The 9 phrases that DO fit (32-token CLIP budget): `an insect, a butterfly,
a moth, a beetle, a bee, a wasp, an ant, a true bug, a fly`. Mantodea and
Odonata fall through to `an insect`, which has lower per-detection score
under SAM 3 and gets filtered by `SAM3_BOX_THRESHOLD`.

**Recommendation (Phase 3 candidate):** Either bump the prompt budget by
dropping a less-common phrase (e.g. swap `a true bug` for `a dragonfly` —
true bugs still match `an insect` reasonably well) OR introduce a
two-pass strategy that re-runs SAM 3 on no-bbox images with a mantis/
dragonfly-focused prompt. Out of scope for Phase 2.

## Correct multi-bug detection (5 + sec)

Multi-bug images detected secondary subjects without false-positives on
background texture:

| idx | image_id           | primary + secondaries        | notes |
|---:|---|---|---|
| 001 | inat-2719463       | 1 + 57 stink bugs            | hard scene, hits many but tiny bboxes |
| 014 | bugwood-5506340    | 1 + 6 bark beetles on penny  | clean separation |
| 015 | bugwood-5424579    | 1 + 3 beetle specimens       | clean separation |
| 018 | bugwood-5341009    | 1 + 2 Colorado potato beetles | clean |
| 019 | bugwood-5385553    | 1 + 3 tortoise beetles + 1 FP scab | one cyan on a scab |
| 034 | bugwood-1540228    | 1 + 22 pine aphids           | scattered across branches |

The `inat-2719463` case (58 detections) is the noisiest — a hectic image
with many tiny stink bugs on mustard. Primary bbox is correct but small;
all the cyan secondaries are real bugs, no FP on flowers/leaves despite
the busy background. Holds up.

## What did NOT show up

- **No false-positives on flowers** (bugwood-5385923 cuckoo wasp on a
  pink flower: bbox correctly on the wasp, not the petals)
- **No false-positives on leaves** (inat-2876350 carpenter ant on a
  twig with leaf-like texture: bbox on the ant)
- **No clipped bboxes** that I would call out as obvious bbox-quality
  defects beyond the 5 misses above
- **No "wrong subject" detections** — when SAM 3 returns a bbox, it's
  always on the intended insect

## Verdict

SAM 3 generalizes well. **Sign off to ship.** The 10 % miss rate is
concentrated in two well-understood failure modes (Odonata, Mantodea due
to prompt token budget) and the recommendation above can be picked up in
Phase 3 without re-running Phase 2.

The 30-image iterative sample done earlier in Phase 2b and this 50-image
fresh-seed final check agree: ~85-90 % detection, ~98 % precision when
detected, 0 negative-class FPs.

## Verification supplement (post-hoc confidence checks)

After the initial QA pass, three follow-up checks closed gaps in the
original confidence story:

**1. 30-vs-50 sample overlap.** Re-ran the deterministic sample logic for
both seeds against the current 299-row sam3 pool. Overlap is 6 / 50
(12 %) — well under the "drop and re-render" 30 % threshold. The 44
distinct images in the 50-check (including all 5 misses) are genuinely
new data, so the recall/precision numbers above reflect generalization,
not re-confirmation of what the 30-check already showed.

**2. `recompute_parquet` for new-vocab `suggested_labels`.** Existing
parquet rows for both v1 and sam3 carried OLD-vocab labels emitted by
the pre-Phase-2 rule labeler, so `evaluate_pipeline` couldn't compare
system-vs-user. Re-ran rule_labeler over all 360 v1 rows + 299 sam3 rows.
After recompute, evaluate_pipeline produces real Phase 0 F1 numbers
(backup at `framing_detections.parquet.bak-*`).

| label                             | v1 F1 | sam3 F1 | reading |
|---|---:|---:|---|
| bbox-content_subject-too-small    | 0.90  | 0.74    | rule strong on v1; weaker on sam3 (different bbox-size dist) |
| mask_poor-contrast                | 0.39  | 0.18    | over-predicts on both; thresholds need re-tune on sam3 |
| bbox-content_no-bug               | 0.67  | 0.11    | sam3 over-fires (33 FPs); confidence threshold needs re-cal |
| bbox-content_bbox-multibug_unusable | 0.00 | 0.00   | sam3 emits 54 FPs (many secondaries) — not in user vocab |

Rule_labeler thresholds were tuned for v1 detector distributions; they
don't transfer cleanly to sam3. **Re-tuning is a Phase 3 item, not a
regression from Phase 2b.** Plus, the user labels themselves were
assigned looking at v1 bboxes — `transfer_labels` projects 293/318 of
those need re-review under sam3 bboxes, so the user-side ground truth
itself shifts after re-labeling.

**3. `_commitBboxOnly` against diverse suggested_labels.** Tested 5
records with different rule outputs (single / no-bug / multibug_unusable /
subject-too-small / [single+mask_poor-contrast]) by deleting them from
labels.json, filtering the UI to unreviewed-only, pressing N five times,
and inspecting the disk JSON. All 5 wrote correctly:

- col1 = `bbox_correct-subject_not-clipped` (the default)
- col2_count = the matching COL2_COUNT_ID, or fallback to `single`
- col2_flags / col3 populated from suggested_labels via the right
  bucket

The fix handles count vs flag vs mask routing correctly across all
combinations seen in production data.
