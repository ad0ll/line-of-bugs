# PR curves per tier-1 label (auto-generated 2026-05-18 13:30)

Each row shows the highest-recall threshold that achieves the target precision.
OOF predictions via StratifiedKFold(5) — unbiased estimate of held-out behavior.


## `mask_blur_unusable` — n=384, positives=131

| target precision | achieved | recall | threshold | TP | FP | FN |
|---:|---:|---:|---:|---:|---:|---:|
| 0.30 | 0.34 | 1.00 | 0.000 | 131 | 253 | 0 |
| 0.50 | 0.53 | 0.81 | 0.064 | 106 | 95 | 25 |
| 0.60 | 0.60 | 0.56 | 0.642 | 73 | 48 | 58 |
| 0.70 | 0.70 | 0.34 | 0.938 | 45 | 19 | 86 |
| 0.80 | 0.82 | 0.21 | 0.991 | 28 | 6 | 103 |
| 0.90 | 1.00 | 0.01 | 1.000 | 1 | 0 | 130 |

## `mask_blur_usable` — n=384, positives=77

| target precision | achieved | recall | threshold | TP | FP | FN |
|---:|---:|---:|---:|---:|---:|---:|
| 0.30 | 0.31 | 0.18 | 0.577 | 14 | 31 | 63 |
| 0.50 | 0.50 | 0.10 | 0.876 | 8 | 8 | 69 |
| 0.60 | 1.00 | 0.00 | 1.000 | 0 | 0 | 77 |
| 0.70 | 1.00 | 0.00 | 1.000 | 0 | 0 | 77 |
| 0.80 | 1.00 | 0.00 | 1.000 | 0 | 0 | 77 |
| 0.90 | 1.00 | 0.00 | 1.000 | 0 | 0 | 77 |

## `mask_bad-photo-quality` — n=384, positives=55

| target precision | achieved | recall | threshold | TP | FP | FN |
|---:|---:|---:|---:|---:|---:|---:|
| 0.30 | 0.31 | 0.55 | 0.033 | 30 | 67 | 25 |
| 0.50 | 0.50 | 0.29 | 0.717 | 16 | 16 | 39 |
| 0.60 | 0.67 | 0.15 | 0.982 | 8 | 4 | 47 |
| 0.70 | 0.71 | 0.09 | 0.999 | 5 | 2 | 50 |
| 0.80 | 1.00 | 0.02 | 1.000 | 1 | 0 | 54 |
| 0.90 | 1.00 | 0.02 | 1.000 | 1 | 0 | 54 |

## `mask_poor-contrast` — n=384, positives=24

| target precision | achieved | recall | threshold | TP | FP | FN |
|---:|---:|---:|---:|---:|---:|---:|
| 0.30 | 0.33 | 0.42 | 0.045 | 10 | 20 | 14 |
| 0.50 | 0.53 | 0.33 | 0.548 | 8 | 7 | 16 |
| 0.60 | 0.60 | 0.12 | 0.992 | 3 | 2 | 21 |
| 0.70 | 1.00 | 0.00 | 1.000 | 0 | 0 | 24 |
| 0.80 | 1.00 | 0.00 | 1.000 | 0 | 0 | 24 |
| 0.90 | 1.00 | 0.00 | 1.000 | 0 | 0 | 24 |
