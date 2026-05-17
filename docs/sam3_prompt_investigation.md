# SAM 3 prompt investigation — single phrase wins

**Date:** 2026-05-17
**Outcome:** Production `Sam3Detector` defaults to `["an insect"]` (single phrase).

## TL;DR

Multi-phrase prompts dilute SAM 3's `presence_logits.sigmoid()` — the
scene-level gate that bounds every detection score on the image. Going
from 9 phrases to 1 phrase ("an insect") cut the no-bbox subset from 38
to 3 (out of 299 sam3 rows) with zero regressions.

## Background

The validator QA on the first 50-image fresh sample showed 5/50 misses,
all Odonata (dragonflies) or Mantodea (mantises). Initial hypothesis was
that the 32-token CLIP budget pushed "a dragonfly" / "a praying mantis"
out of the prompt. A pass-2 run with those phrases promoted to the top
of the priority list found only 1 new bbox out of 38 no-bbox images —
the hypothesis was wrong.

## Investigation

### Step 1: visual inspection of misses

3 missed images inspected directly. All were clear, well-lit, no occlusion —
classic dragonfly on stick, posed mantis in foliage, damselfly on rock.
SAM 3 *should* detect these in principle.

### Step 2: raw output probe (no threshold)

Dumped `pred_logits.sigmoid() * presence_logits.sigmoid()` for 4 images
× 6 prompt variations:

```
red dragonfly:   multi9_orig  presence=0.083  max=0.078  (filtered out)
red dragonfly:   single_dragonfly  presence=0.980  max=0.969  (strong)
red dragonfly:   single_insect  presence=0.663  max=0.647  (clear)

mantis:          multi9_orig  presence=0.169  max=0.144  (filtered out)
mantis:          single_mantis  presence=0.992  max=0.925  (strong)
mantis:          single_insect  presence=0.985  max=0.934  (strong)

beetle (control): multi9_orig  presence=0.947  max=0.936  (strong)
beetle (control): multi8_aug  presence=0.001  max=0.001  (KILLED)
beetle (control): single_beetle  presence=0.991  max=0.978  (strong)
```

Key insight: the score formula is `sigmoid(pred_logits) * sigmoid(presence_logits)`.
`presence_logits` is a single scalar per image — the model's belief that
the queried object(s) exist in the scene. When the prompt is a fusion of
8+ phrases, the text embedding becomes a superposition that the image
matches weakly → presence collapses → every query score collapses.

### Step 3: A/B/C prototype on 87 images

| strategy | new detections (no-bbox=37) | with-bbox kept (50) | regressions | mean IoU vs current | median score |
|---|---:|---:|---:|---:|---:|
| baseline_multi9 (current production) | 0 | 49 | 1 | 1.000 | 0.867 |
| **insect_only** | **34** | **50** | **0** | 0.956 | 0.923 |
| taxon_routed (DB taxon_order → single phrase) | 27 | 41 | 9 | 0.946 | 0.912 |

`insect_only` is strictly better than baseline (more detections, fewer
regressions, higher scores, similar bboxes).

`taxon_routed` underperforms because some images have wrong/missing
taxon_order in the DB, AND because specific phrases like "a dragonfly"
do NOT generalize to damselflies (CLIP concept boundary mismatch).

### Step 4: 2-phrase combos checked

`"an insect. a dragonfly"` and `"a dragonfly. an insect"` were both
tested. They never beat single-phrase performance; dilution starts at
2 phrases too, just gentler than at 9. Skipped.

## Production decision

`Sam3Detector.DEFAULT_PROMPT_PHRASES = ["an insect"]`. Callers can
override but get a logged warning pointing to this doc.

`classify.py` explicitly passes `["an insect"]` for the sam3 detector
to keep `prompt_version` logging consistent with what the model sees.

## What this does NOT cover

- **Why CLIP-class text encoders pool to a worse embedding for multi-phrase
  input.** Likely because CLIP was trained on short single captions, not
  enumerated lists. Out of scope here; just observed.
- **Whether SAM 3.5 / future versions fix this.** Worth re-checking on
  any major SAM 3 update.
- **Whether other text-prompted detectors (GroundingDINO, OWLv2) show
  the same pattern.** Not tested; GroundingDINO docs explicitly support
  multi-phrase prompts so behavior may differ.
- **The 3 still-no-bbox images after switching to insect_only.** Two are
  cvtColor errors (corrupted JPEGs). The third is the only true SAM 3
  miss left — a stick insect in challenging lighting. Acceptable.
