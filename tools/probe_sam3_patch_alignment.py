"""Task 0 from the SAM3 vision-features plan.

Confirm exactly how the processor transforms a PIL image → pixel_values,
so we know how to map an original-image-coord mask onto the patch grid.

Outputs all the info needed to make the pooling logic correct:
  - Input → pixel_values shape across aspect ratios (pad vs stretch?)
  - image_processor config fields (do_pad, do_resize, size, etc.)
  - Patch grid (from last_hidden_state.shape)
  - Patch size (1008 / sqrt(P))
  - Effective per-axis stride
"""
from __future__ import annotations
import torch
from PIL import Image
from scripts.detect_subjects._sam3_shared import get_shared_sam3


def main() -> None:
    model, processor = get_shared_sam3()

    # 1) Aspect-ratio probe — does the processor pad-to-square or stretch?
    print("=== aspect-ratio behavior ===")
    for size in [(800, 800), (600, 1200), (1200, 600), (1500, 1000), (640, 480)]:
        im = Image.new("RGB", size, (128, 128, 128))
        out = processor(images=im, text="x", return_tensors="pt")
        pv = out["pixel_values"]
        print(f"  input {size[0]}x{size[1]:>4} → pixel_values {tuple(pv.shape)}  "
              f"aspect_in={size[0]/size[1]:.2f} aspect_out={pv.shape[3]/pv.shape[2]:.2f}")

    # 2) Processor config introspection
    print("\n=== image_processor config ===")
    ip = processor.image_processor
    for attr in ["size", "do_pad", "do_resize", "do_normalize", "do_rescale",
                 "image_mean", "image_std", "resample", "pad_size"]:
        val = getattr(ip, attr, "(missing)")
        # Truncate long mean/std
        if isinstance(val, list) and len(val) > 4:
            val = f"{val[:3]}...({len(val)} total)"
        print(f"  {attr}: {val!r}")

    # 3) Patch grid discovery — run encoder, see last_hidden_state shape
    print("\n=== encoder output shapes ===")
    im = Image.new("RGB", (1000, 1000), (200, 100, 50))
    inputs = processor(images=im, text="x", return_tensors="pt").to("mps")
    inputs["pixel_values"] = inputs["pixel_values"].to(torch.float32)
    with torch.no_grad():
        vis_out = model.vision_encoder(inputs["pixel_values"])
    H_pix, W_pix = inputs["pixel_values"].shape[-2:]
    P = vis_out.last_hidden_state.shape[1]
    grid_side = int(P ** 0.5)
    patch_px = H_pix // grid_side if grid_side ** 2 == P else None
    print(f"  pixel_values: {H_pix}x{W_pix}")
    print(f"  last_hidden_state: {tuple(vis_out.last_hidden_state.shape)}")
    print(f"  P = {P}, sqrt(P) = {P**0.5:.2f}, grid = {grid_side}x{grid_side} "
          f"(square? {grid_side**2 == P})")
    print(f"  inferred patch size: {patch_px}px")
    print(f"  fpn_hidden_states shapes:")
    for i, h in enumerate(vis_out.fpn_hidden_states):
        print(f"    fpn[{i}]: {tuple(h.shape)}")

    # 4) Reverse the transform — given a mask in original image coords,
    # how does it land on the patch grid?
    print("\n=== mask alignment rule (derived) ===")
    # Most likely: processor longest-side resize to N, pad to NxN, then patchify
    # Detect the pattern:
    for size in [(800, 800), (640, 480), (480, 640)]:
        im = Image.new("RGB", size, 0)
        out = processor(images=im, text="x", return_tensors="pt")
        pv = out["pixel_values"]
        H_out, W_out = pv.shape[-2:]
        longest = max(size)
        scale = H_out / longest if size[1] >= size[0] else W_out / longest
        new_w, new_h = int(round(size[0] * scale)), int(round(size[1] * scale))
        pad_x, pad_y = W_out - new_w, H_out - new_h
        print(f"  input {size[0]}x{size[1]} → out {W_out}x{H_out}: "
              f"if longest-side-resize+pad → scale={scale:.4f}, "
              f"resized to {new_w}x{new_h}, padding=({pad_x}x{pad_y})")


if __name__ == "__main__":
    main()
