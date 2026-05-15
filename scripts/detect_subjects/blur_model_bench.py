"""Benchmark off-the-shelf NR-IQA / sharpness models against the 127 human
blur labels (`subject-blurred_unusable` + `_partially-usable`).

Each candidate model produces a per-image score; we compute ROC-AUC vs two
binary targets — "unusable blur" only, and "any blur" (unusable OR partial).
Report sorts by AUC for `subject-blurred_unusable`.

Models tested
=============
- subject_sharpness   : Laplacian variance over bbox (already in parquet) — baseline
- boundary_sharpness  : Sobel mag along SAM mask edge (already in parquet) — baseline
- tenengrad_bbox      : mean(Gx^2 + Gy^2) over bbox crop — Sobel-based focus measure
- tenengrad_full      : same, but over the whole image (control)
- brisque_full / _bbox: NR-IQA (PIQ), regression model trained on LIVE database
- clip_iqa_quality    : CLIP-IQA (PIQ) with "Good photo" / "Bad photo" antonym
- clip_zs_*           : raw CLIP zero-shot, prompt-pair similarity

Scores are cached at data/cache/blur_bench_scores.json so re-runs are cheap.

Usage:
    .venv/bin/python -m scripts.detect_subjects.blur_model_bench
"""
from __future__ import annotations
import json
import time
from pathlib import Path

import cv2
import numpy as np
import polars as pl
import torch
from PIL import Image
from sklearn.metrics import roc_auc_score

from scripts.detect_subjects.config import CACHE_DIR, DATA_DIR, PARQUET_PATH

VARIANT = "v1_dino_insectsam"
DEVICE = "mps" if torch.backends.mps.is_available() else "cpu"
SCORES_PATH = CACHE_DIR / "blur_bench_scores.json"


def _crop_to_bbox(image: Image.Image, bbox_xywh, pad: float = 0.10) -> Image.Image:
    W, H = image.width, image.height
    x, y, w, h = bbox_xywh
    pad_w, pad_h = w * pad, h * pad
    x1 = max(0, int((x - pad_w) * W))
    y1 = max(0, int((y - pad_h) * H))
    x2 = min(W, int((x + w + pad_w) * W))
    y2 = min(H, int((y + h + pad_h) * H))
    if x2 - x1 < 8 or y2 - y1 < 8:
        return image
    return image.crop((x1, y1, x2, y2))


def _tenengrad(image: Image.Image) -> float:
    gray = cv2.cvtColor(np.array(image), cv2.COLOR_RGB2GRAY)
    gx = cv2.Sobel(gray, cv2.CV_64F, 1, 0, ksize=3)
    gy = cv2.Sobel(gray, cv2.CV_64F, 0, 1, ksize=3)
    return float(np.mean(gx * gx + gy * gy))


def _pil_to_tensor(image: Image.Image) -> torch.Tensor:
    arr = np.array(image.convert("RGB"), dtype=np.float32) / 255.0
    return torch.from_numpy(arr).permute(2, 0, 1).unsqueeze(0)


def _brisque_score(image: Image.Image) -> float:
    """PIQ BRISQUE. Returns NEGATED score so higher = sharper for ROC."""
    import piq
    t = _pil_to_tensor(image)
    _, _, H, W = t.shape
    if min(H, W) < 256:
        scale = 256 / min(H, W)
        new_size = (int(H * scale), int(W * scale))
        t = torch.nn.functional.interpolate(t, size=new_size, mode="bilinear", align_corners=False)
    score = piq.brisque(t, data_range=1.0, reduction="none").item()
    return -score


def _clip_iqa_score(image: Image.Image, model) -> float:
    t = _pil_to_tensor(image).to(DEVICE)
    with torch.no_grad():
        return float(model(t).item())


def _clip_zs_score(image: Image.Image, processor, clip_model,
                    pos_prompt: str, neg_prompt: str) -> float:
    inputs = processor(text=[pos_prompt, neg_prompt], images=image,
                        return_tensors="pt", padding=True).to(DEVICE)
    with torch.no_grad():
        out = clip_model(**inputs)
    probs = out.logits_per_image.softmax(dim=-1).cpu().numpy()[0]
    return float(probs[0])


def _load_rows_with_labels() -> list[dict]:
    df = pl.read_parquet(PARQUET_PATH).filter(pl.col("variant") == VARIANT)
    with open(CACHE_DIR / "labels.json") as f:
        labels = json.load(f)
    out = []
    for r in df.iter_rows(named=True):
        rec = labels.get(r["image_id"])
        if not rec or rec.get("unsure"):
            continue
        flags = rec.get("flags") or []
        out.append({
            "image_id": r["image_id"],
            "bbox": (r["bbox_x"], r["bbox_y"], r["bbox_w"], r["bbox_h"]) if r["bbox_x"] else None,
            "subject_sharpness": r.get("subject_sharpness"),
            "boundary_sharpness": r.get("boundary_sharpness"),
            "y_unusable": "subject-blurred_unusable" in flags,
            "y_any_blur": ("subject-blurred_unusable" in flags
                          or "subject-blurred_partially-usable" in flags),
        })
    sample = pl.read_parquet(CACHE_DIR / "validator_sample.parquet")
    fn_idx = {r["image_id"]: r["filename"] for r in sample.iter_rows(named=True)}
    for d in out:
        d["filename"] = fn_idx.get(d["image_id"])
    return [d for d in out if d["filename"]]


def _load_scores() -> dict:
    if SCORES_PATH.exists():
        try:
            return json.loads(SCORES_PATH.read_text())
        except Exception:
            return {}
    return {}


def _save_scores(scores: dict) -> None:
    SCORES_PATH.write_text(json.dumps(scores))


def compute_scores(rows: list[dict]) -> dict:
    import piq
    from transformers import CLIPProcessor, CLIPModel

    scores = _load_scores()
    clip_iqa_model = None
    clip_processor = None
    clip_model = None

    def _get_clip():
        nonlocal clip_processor, clip_model
        if clip_processor is None:
            print("[blur-bench] loading CLIP-ViT-B/32...")
            clip_processor = CLIPProcessor.from_pretrained("openai/clip-vit-base-patch32")
            clip_model = CLIPModel.from_pretrained("openai/clip-vit-base-patch32").to(DEVICE)
            clip_model.train(False)
        return clip_processor, clip_model

    def _get_clip_iqa():
        nonlocal clip_iqa_model
        if clip_iqa_model is None:
            print("[blur-bench] loading CLIPIQA...")
            clip_iqa_model = piq.CLIPIQA(data_range=1.0).to(DEVICE)
            clip_iqa_model.train(False)
        return clip_iqa_model

    t0 = time.perf_counter()
    n = len(rows)
    new_count = 0
    needed = ["tenengrad_full", "tenengrad_bbox", "brisque_full", "brisque_bbox",
               "clip_iqa_quality", "clip_zs_sharp_vs_blurry"]
    for i, row in enumerate(rows):
        image_id = row["image_id"]
        s = scores.get(image_id, {})
        if all(k in s for k in needed):
            scores[image_id] = s
            continue

        img_path = DATA_DIR / row["filename"]
        if not img_path.exists():
            continue
        try:
            image = Image.open(img_path).convert("RGB")
        except Exception:
            continue

        if row.get("subject_sharpness") is not None:
            s["subject_sharpness"] = float(row["subject_sharpness"])
        if row.get("boundary_sharpness") is not None:
            s["boundary_sharpness"] = float(row["boundary_sharpness"])

        if "tenengrad_full" not in s:
            s["tenengrad_full"] = _tenengrad(image)

        bbox = row.get("bbox")
        crop = _crop_to_bbox(image, bbox) if bbox else image
        if "tenengrad_bbox" not in s:
            s["tenengrad_bbox"] = _tenengrad(crop)

        if "brisque_full" not in s:
            try: s["brisque_full"] = _brisque_score(image)
            except Exception as e: print(f"  brisque_full fail {image_id}: {e}")
        if "brisque_bbox" not in s:
            try: s["brisque_bbox"] = _brisque_score(crop)
            except Exception as e: print(f"  brisque_bbox fail {image_id}: {e}")

        if "clip_iqa_quality" not in s:
            try:
                m = _get_clip_iqa()
                s["clip_iqa_quality"] = _clip_iqa_score(image, m)
            except Exception as e: print(f"  clip_iqa fail {image_id}: {e}")

        if "clip_zs_sharp_vs_blurry" not in s:
            try:
                cp, cm = _get_clip()
                s["clip_zs_sharp_vs_blurry"] = _clip_zs_score(
                    image, cp, cm,
                    pos_prompt="a sharp, in-focus photo of an insect",
                    neg_prompt="a blurry, out-of-focus photo of an insect",
                )
            except Exception as e: print(f"  clip_zs fail {image_id}: {e}")

        scores[image_id] = s
        new_count += 1
        if new_count % 25 == 0:
            elapsed = time.perf_counter() - t0
            print(f"[blur-bench] {i+1}/{n} ({new_count} fresh)  {elapsed:.1f}s")
            _save_scores(scores)
    _save_scores(scores)
    return scores


def report(rows: list[dict], scores: dict) -> None:
    metric_names = sorted({k for s in scores.values() for k in s})
    print("\n# Blur-detector benchmark\n")
    print(f"n={len(rows)} reviewed images, "
          f"{sum(r['y_unusable'] for r in rows)} `_unusable`, "
          f"{sum(r['y_any_blur'] for r in rows)} `any_blur`.\n")
    print("All scores normalised so higher = sharper (BRISQUE is internally negated).\n")
    print("| metric | AUC: unusable | AUC: any blur | n |")
    print("|---|---:|---:|---:|")
    rank = []
    for m in metric_names:
        ys_u, ys_a, vs = [], [], []
        for r in rows:
            s = scores.get(r["image_id"], {})
            if m not in s or s[m] is None or not np.isfinite(s[m]):
                continue
            ys_u.append(r["y_unusable"])
            ys_a.append(r["y_any_blur"])
            vs.append(s[m])
        if not vs or len(set(ys_u)) < 2 or len(set(ys_a)) < 2:
            continue
        auc_u = roc_auc_score(ys_u, [-v for v in vs])
        auc_a = roc_auc_score(ys_a, [-v for v in vs])
        rank.append((m, auc_u, auc_a, len(vs)))
    rank.sort(key=lambda x: -x[1])
    for m, auc_u, auc_a, n in rank:
        print(f"| `{m}` | {auc_u:.3f} | {auc_a:.3f} | {n} |")

    print("\n## Read this as:")
    print("- AUC = 0.5 means no better than coin-flip.")
    print("- AUC >= 0.85 -> ship at a chosen threshold.")
    print("- AUC 0.70-0.84 -> useful as a feature in a small LR.")
    print("- AUC < 0.70 -> unhelpful on its own.\n")


if __name__ == "__main__":
    rows = _load_rows_with_labels()
    scores = compute_scores(rows)
    report(rows, scores)
