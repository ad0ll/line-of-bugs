# Mask features ablation

Variant: `grounding_dino__insectsam`
Decision threshold: ΔAUC ≥ 0.05 → keep segmenter for that label

| label | n_pos (wo / w) | AUC w/o mask | AUC w/ mask | ΔAUC | decision |
|---|---:|---:|---:|---:|:---|
| `mask_blur_unusable` | 77 / 77 | 0.772 | 0.754 | -0.018 | **drop_mask** |
| `mask_blur_usable` | 50 / 50 | 0.649 | 0.658 | +0.009 | **drop_mask** |
| `mask_poor-contrast` | 15 / 15 | 0.544 | 0.627 | +0.083 | **keep_mask** |

## Overall: KEEP segmenter

Mask features add ≥0.05 AUC on at least one mask-dependent label → segmenter earns its keep.
