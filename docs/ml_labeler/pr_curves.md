# PR curves per tier-1 label (auto-generated 2026-05-18 09:31)

Each row shows the highest-recall threshold that achieves the target precision.
OOF predictions via StratifiedKFold(5) — unbiased estimate of held-out behavior.


## `mask_blur_unusable` — n=272, positives=97

| target precision | achieved | recall | threshold | TP | FP | FN |
|---:|---:|---:|---:|---:|---:|---:|
| 0.30 | 0.36 | 1.00 | 0.000 | 97 | 173 | 0 |
| 0.50 | 0.50 | 0.80 | 0.041 | 78 | 78 | 19 |
| 0.60 | 0.61 | 0.56 | 0.570 | 54 | 34 | 43 |
| 0.70 | 0.71 | 0.37 | 0.887 | 36 | 15 | 61 |
| 0.80 | 0.80 | 0.33 | 0.958 | 32 | 8 | 65 |
| 0.90 | 0.93 | 0.13 | 0.997 | 13 | 1 | 84 |

## `mask_blur_usable` — n=272, positives=49

| target precision | achieved | recall | threshold | TP | FP | FN |
|---:|---:|---:|---:|---:|---:|---:|
| 0.30 | 0.32 | 0.35 | 0.290 | 17 | 36 | 32 |
| 0.50 | 1.00 | 0.04 | 0.992 | 2 | 0 | 47 |
| 0.60 | 1.00 | 0.04 | 0.992 | 2 | 0 | 47 |
| 0.70 | 1.00 | 0.04 | 0.992 | 2 | 0 | 47 |
| 0.80 | 1.00 | 0.04 | 0.992 | 2 | 0 | 47 |
| 0.90 | 1.00 | 0.04 | 0.992 | 2 | 0 | 47 |

## `mask_bad-photo-quality` — n=272, positives=32

| target precision | achieved | recall | threshold | TP | FP | FN |
|---:|---:|---:|---:|---:|---:|---:|
| 0.30 | 0.50 | 0.03 | 0.964 | 1 | 1 | 31 |
| 0.50 | 0.50 | 0.03 | 0.964 | 1 | 1 | 31 |
| 0.60 | 1.00 | 0.00 | 1.000 | 0 | 0 | 32 |
| 0.70 | 1.00 | 0.00 | 1.000 | 0 | 0 | 32 |
| 0.80 | 1.00 | 0.00 | 1.000 | 0 | 0 | 32 |
| 0.90 | 1.00 | 0.00 | 1.000 | 0 | 0 | 32 |

## `mask_poor-contrast` — n=272, positives=23

| target precision | achieved | recall | threshold | TP | FP | FN |
|---:|---:|---:|---:|---:|---:|---:|
| 0.30 | 0.33 | 0.57 | 0.054 | 13 | 27 | 10 |
| 0.50 | 1.00 | 0.09 | 0.998 | 2 | 0 | 21 |
| 0.60 | 1.00 | 0.09 | 0.998 | 2 | 0 | 21 |
| 0.70 | 1.00 | 0.09 | 0.998 | 2 | 0 | 21 |
| 0.80 | 1.00 | 0.09 | 0.998 | 2 | 0 | 21 |
| 0.90 | 1.00 | 0.09 | 0.998 | 2 | 0 | 21 |
