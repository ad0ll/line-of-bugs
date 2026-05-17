"""Ablation: do mask features earn the segmenter's keep? (Phase 3 prereq)

For each mask-dependent label (mask_blur_unusable, mask_blur_usable,
mask_poor-contrast), trains TWO LogisticRegression classifiers with 5-fold
stratified CV:

  without_mask: features = [bbox_area_ratio, offcenter, bbox_long_edge_px, subject_sharpness]
  with_mask:    features += [mask_area_ratio, lab_delta_e, boundary_sharpness, mask_iou_score]

Reports AUC per label per feature set (mean across folds + bootstrap CI).

Decision rule per parent spec §337-347:
  ΔAUC = AUC_with_mask - AUC_without_mask
  - ΔAUC ≥ 0.05 → KEEP segmenter (mask features add real signal)
  - ΔAUC < 0.05 → DROP segmenter (mask not worth the inference cost)

Output: markdown report at docs/ablation_mask_features.md + JSON at
docs/ablation_mask_features.json (the latter consumed by Phase 3 to make
the keep-segmenter branch decision).

Usage:
    .venv/bin/python -m tools.ablation_mask_features [--variant V] [--out PATH]
"""
from __future__ import annotations
import argparse
import json
import sys
from pathlib import Path

import numpy as np
import polars as pl
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import StratifiedKFold

from scripts.detect_subjects.config import CACHE_DIR, PARQUET_PATH
from scripts.detect_subjects.evaluation_utils import bootstrap_f1_ci

LABELS_PATH = CACHE_DIR / "labels.json"

WITHOUT_MASK_FEATURES = ["bbox_area_ratio", "offcenter", "bbox_long_edge_px", "subject_sharpness"]
WITH_MASK_FEATURES = WITHOUT_MASK_FEATURES + [
    "mask_area_ratio", "lab_delta_e", "boundary_sharpness", "mask_iou_score",
]

MASK_LABELS = ["mask_blur_unusable", "mask_blur_usable", "mask_poor-contrast"]

DECISION_THRESHOLD = 0.05


def _load_xy(parquet_path: Path, labels_path: Path, variant: str, label: str, feature_cols: list[str]):
    """Build X, y for one label. y=1 if label in user's flags; 0 otherwise. Drops rows with any None feature."""
    df = pl.read_parquet(parquet_path).filter(pl.col("variant") == variant)
    labels = json.loads(labels_path.read_text()) if labels_path.exists() else {}
    X_rows, y_rows = [], []
    for r in df.iter_rows(named=True):
        feats = [r.get(c) for c in feature_cols]
        if any(v is None for v in feats):
            continue
        rec = labels.get(r["image_id"])
        if not rec:
            continue  # unlabeled → skip (no ground truth)
        flags = rec.get("flags") or []
        y_rows.append(1 if label in flags else 0)
        X_rows.append([float(v) for v in feats])
    return np.array(X_rows), np.array(y_rows)


def cross_val_auc(X: np.ndarray, y: np.ndarray, n_folds: int = 5, seed: int = 42) -> tuple[float, list[float]]:
    """Stratified k-fold CV. Returns (mean_auc, per_fold_aucs)."""
    if len(np.unique(y)) < 2:
        return float("nan"), []
    skf = StratifiedKFold(n_splits=n_folds, shuffle=True, random_state=seed)
    per_fold = []
    for tr, te in skf.split(X, y):
        if len(np.unique(y[tr])) < 2 or len(np.unique(y[te])) < 2:
            continue
        clf = LogisticRegression(class_weight="balanced", max_iter=1000, random_state=seed)
        clf.fit(X[tr], y[tr])
        scores = clf.predict_proba(X[te])[:, 1]
        per_fold.append(roc_auc_score(y[te], scores))
    return (float(np.mean(per_fold)) if per_fold else float("nan")), per_fold


def ablation_for_label(parquet_path: Path, labels_path: Path, variant: str, label: str) -> dict:
    X_wo, y_wo = _load_xy(parquet_path, labels_path, variant, label, WITHOUT_MASK_FEATURES)
    X_w, y_w = _load_xy(parquet_path, labels_path, variant, label, WITH_MASK_FEATURES)

    n_pos_wo = int(y_wo.sum()) if len(y_wo) else 0
    n_pos_w = int(y_w.sum()) if len(y_w) else 0

    if n_pos_wo < 5 or n_pos_w < 5:
        return {
            "label": label,
            "skipped": True,
            "reason": f"insufficient positives (without_mask: {n_pos_wo}, with_mask: {n_pos_w}); need ≥5 each",
            "n_total_wo": int(len(y_wo)),
            "n_pos_wo": n_pos_wo,
            "n_total_w": int(len(y_w)),
            "n_pos_w": n_pos_w,
        }

    auc_wo, folds_wo = cross_val_auc(X_wo, y_wo)
    auc_w, folds_w = cross_val_auc(X_w, y_w)
    delta = auc_w - auc_wo

    return {
        "label": label,
        "skipped": False,
        "n_total_wo": int(len(y_wo)),
        "n_pos_wo": n_pos_wo,
        "n_total_w": int(len(y_w)),
        "n_pos_w": n_pos_w,
        "auc_without_mask": auc_wo,
        "auc_with_mask": auc_w,
        "delta_auc": delta,
        "decision_for_label": "keep_mask" if delta >= DECISION_THRESHOLD else "drop_mask",
        "folds_without_mask": folds_wo,
        "folds_with_mask": folds_w,
    }


def render_markdown(results: list[dict], variant: str) -> str:
    lines = [
        "# Mask features ablation",
        "",
        f"Variant: `{variant}`",
        f"Decision threshold: ΔAUC ≥ {DECISION_THRESHOLD} → keep segmenter for that label",
        "",
        "| label | n_pos (wo / w) | AUC w/o mask | AUC w/ mask | ΔAUC | decision |",
        "|---|---:|---:|---:|---:|:---|",
    ]
    keep_any = False
    for r in results:
        if r["skipped"]:
            lines.append(f"| `{r['label']}` | {r['n_pos_wo']} / {r['n_pos_w']} | SKIPPED | SKIPPED | — | {r['reason']} |")
            continue
        lines.append(
            f"| `{r['label']}` | {r['n_pos_wo']} / {r['n_pos_w']} | "
            f"{r['auc_without_mask']:.3f} | {r['auc_with_mask']:.3f} | "
            f"{r['delta_auc']:+.3f} | **{r['decision_for_label']}** |"
        )
        if r["decision_for_label"] == "keep_mask":
            keep_any = True

    lines += [
        "",
        f"## Overall: {'KEEP segmenter' if keep_any else 'DROP segmenter'}",
        "",
        ("Mask features add ≥0.05 AUC on at least one mask-dependent label → segmenter earns its keep."
         if keep_any else
         "No mask-dependent label saw ≥0.05 AUC improvement from mask features → drop segmenter."),
        "",
    ]
    return "\n".join(lines)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--variant", default="grounding_dino__insectsam",
                    help="parquet variant to use (must have populated mask features)")
    ap.add_argument("--out", type=Path, default=Path("docs/ablation_mask_features.md"))
    ap.add_argument("--out-json", type=Path, default=Path("docs/ablation_mask_features.json"))
    args = ap.parse_args()

    results = [ablation_for_label(PARQUET_PATH, LABELS_PATH, args.variant, label) for label in MASK_LABELS]
    md = render_markdown(results, args.variant)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(md)
    args.out_json.write_text(json.dumps({
        "variant": args.variant,
        "decision_threshold": DECISION_THRESHOLD,
        "results": results,
        "keep_segmenter": any(not r.get("skipped") and r.get("decision_for_label") == "keep_mask" for r in results),
    }, indent=2))
    print(md)
    print(f"\nwrote {args.out} and {args.out_json}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
