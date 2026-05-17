# SAM 3 API Probe Findings

**Date:** 2026-05-16
**Model:** facebook/sam3
**Transformers version:** 5.8.1
**Test image:** 2111256_inaturalist_nature_smoky-winged-beetle-bandit-wasp.jpg (2048x1365)

## Key API Corrections vs. Reference Docs

The reference docs described `Sam3Processor(images=image, text=["a beetle", "a flower"], ...)` (list of phrases). **This is wrong.** The actual API takes a single string.

## Text-prompted inference (detection mode)

```python
inputs = processor(images=image, text="an insect", return_tensors="pt")
outputs = model(**inputs)
```

Output tensor shapes:
- `outputs.pred_masks`: `torch.Size([1, 200, 288, 288])` — 200 queries, each with a 288x288 mask
- `outputs.pred_boxes`: `torch.Size([1, 200, 4])` — normalized xyxy [0,1]
- `outputs.pred_logits`: `torch.Size([1, 200])` — per-query text-alignment score
- `outputs.presence_logits`: `torch.Size([1, 1])` — global presence score
- `outputs.iou_scores`: NOT PRESENT (SAM 3 does not expose iou_scores like SAM 1/2)

## post_process_instance_segmentation

```python
results = processor.post_process_instance_segmentation(
    outputs, threshold=0.3, mask_threshold=0.5, target_sizes=[(H, W)]
)
r0 = results[0]  # dict with keys: 'scores', 'boxes', 'masks'
```

- `r0["scores"]`: `torch.Size([N])` — confidence per detection above threshold
- `r0["boxes"]`: `torch.Size([N, 4])` — pixel xyxy coordinates (scaled by target_sizes)
- `r0["masks"]`: `torch.Size([N, H, W])` — binary masks (after mask_threshold)

**Critical finding: NO `labels` or `text` field per detection.** SAM 3 does not expose which phrase matched per detection because it's a single-text query model. The `text_label` field must be set to the query string used (e.g., `"an insect"`).

With text query `"an insect"` at threshold=0.3: **2 detections**, scores `[0.923, 0.714]`.

## Box-prompted inference (segmenter mode)

```python
# input_boxes needs 3 levels: [images, boxes, coords] with pixel xyxy coords
inputs = processor(
    images=image,
    input_boxes=[[[ x1, y1, x2, y2 ]]],  # pixel coords, not normalized
    return_tensors="pt",
)
# text auto-resolves to "visual" when input_boxes provided
outputs = model(**inputs)
results = processor.post_process_instance_segmentation(
    outputs, threshold=0.1, mask_threshold=0.5, target_sizes=[(H, W)]
)
```

Box-prompted result: same `{scores, boxes, masks}` dict. At threshold=0.1: **42 detections** for a 50%x50% box. Use higher threshold or pick top-N.

## Multi-phrase strategy

To match multiple insect classes, concatenate them in the text string using sentence/period format, matching the GroundingDINO pattern:

```python
text = "an insect. a butterfly. a beetle. a caterpillar."
inputs = processor(images=image, text=text, return_tensors="pt")
```

This works because SAM 3's CLIP text encoder processes the full string. However, there is **no way to know which sub-phrase matched per detection** — the model returns a single scalar logit per query.

## Implications for Sam3Detector / Sam3Segmenter

1. **Detector**: Pass all prompt phrases as a single joined string (`". ".join(phrases)`). All detections get `text_label` = the full prompt string (no per-detection phrase breakdown). This is a known limitation vs. GroundingDINO.
2. **Segmenter**: Use box-prompted mode with `input_boxes=[[[x1, y1, x2, y2]]]` (pixel coords). Use `threshold=0.1` to get detections; pick mask with highest score. `iou_scores` is not available — use the presence/score instead.
3. **No `post_process_masks` needed**: The `post_process_instance_segmentation` handles mask interpolation via `target_sizes`.
