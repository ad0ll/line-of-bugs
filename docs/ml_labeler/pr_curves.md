# PR curves per tier-1 label (auto-generated 2026-05-18 13:24)

Each row shows the highest-recall threshold that achieves the target precision.
OOF predictions via StratifiedKFold(5) — unbiased estimate of held-out behavior.


## `mask_blur_unusable` — n=374, positives=121

| target precision | achieved | recall | threshold | TP | FP | FN |
|---:|---:|---:|---:|---:|---:|---:|
| 0.30 | 0.34 | 1.00 | 0.000 | 121 | 239 | 0 |
| 0.50 | 0.50 | 0.68 | 0.143 | 82 | 82 | 39 |
| 0.60 | 0.61 | 0.48 | 0.646 | 58 | 37 | 63 |
| 0.70 | 0.73 | 0.13 | 0.989 | 16 | 6 | 105 |
| 0.80 | 0.83 | 0.08 | 0.994 | 10 | 2 | 111 |
| 0.90 | 0.90 | 0.07 | 0.996 | 9 | 1 | 112 |

## `mask_blur_usable` — n=374, positives=77

| target precision | achieved | recall | threshold | TP | FP | FN |
|---:|---:|---:|---:|---:|---:|---:|
| 0.30 | 0.32 | 0.09 | 0.886 | 7 | 15 | 70 |
| 0.50 | 0.60 | 0.04 | 0.993 | 3 | 2 | 74 |
| 0.60 | 0.60 | 0.04 | 0.993 | 3 | 2 | 74 |
| 0.70 | 1.00 | 0.00 | 1.000 | 0 | 0 | 77 |
| 0.80 | 1.00 | 0.00 | 1.000 | 0 | 0 | 77 |
| 0.90 | 1.00 | 0.00 | 1.000 | 0 | 0 | 77 |

## `mask_bad-photo-quality` — n=374, positives=51

| target precision | achieved | recall | threshold | TP | FP | FN |
|---:|---:|---:|---:|---:|---:|---:|
| 0.30 | 0.34 | 0.41 | 0.086 | 21 | 41 | 30 |
| 0.50 | 0.50 | 0.08 | 0.978 | 4 | 4 | 47 |
| 0.60 | 0.67 | 0.04 | 0.999 | 2 | 1 | 49 |
| 0.70 | 1.00 | 0.02 | 0.999 | 1 | 0 | 50 |
| 0.80 | 1.00 | 0.02 | 0.999 | 1 | 0 | 50 |
| 0.90 | 1.00 | 0.02 | 0.999 | 1 | 0 | 50 |

## `mask_poor-contrast` — n=374, positives=24

| target precision | achieved | recall | threshold | TP | FP | FN |
|---:|---:|---:|---:|---:|---:|---:|
| 0.30 | 0.45 | 0.42 | 0.608 | 10 | 12 | 14 |
| 0.50 | 0.67 | 0.25 | 0.966 | 6 | 3 | 18 |
| 0.60 | 0.67 | 0.25 | 0.966 | 6 | 3 | 18 |
| 0.70 | 1.00 | 0.04 | 1.000 | 1 | 0 | 23 |
| 0.80 | 1.00 | 0.04 | 1.000 | 1 | 0 | 23 |
| 0.90 | 1.00 | 0.04 | 1.000 | 1 | 0 | 23 |
