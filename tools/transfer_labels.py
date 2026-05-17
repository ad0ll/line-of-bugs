"""IoU-based label transfer: auto-carry labels from v1 bboxes to SAM 3 bboxes.

SANITY-CHECK PROTOCOL (READ BEFORE --apply):
============================================

Per Phase 2 spec, the IoU-based label transfer thresholds (0.5, 0.8) are
educated defaults, NOT literature-validated for this dataset. ALWAYS run
the 20-image sanity check before trusting --apply on all 318 labels:

  1. After SAM 3 ships and parquet has sam3__sam3 rows, pick 20 random
     images from your existing labels.json.

  2. Re-label those 20 manually under SAM 3's new bbox in the validator UI
     (bbox-only mode is fastest).

  3. Run this tool with --dry-run --only-image-ids img-A,img-B,... on those 20
     and inspect the proposed transfer.

  4. Compare auto-transferred labels to your fresh labels per image:
     - ≥ 90% agreement → trust transfer; --apply to remaining 298
     - 70-90% → tighten transfer rules (drop the 0.5-0.8 band; require IoU ≥ 0.8)
       and re-run --dry-run
     - < 70% → fall back to full re-label of all 318 (don't --apply)

  5. Whatever you decide, the backup at tools/manual-labels-backups/labels-pre-transfer.json
     lets you roll back if needed.

Transfer logic:
  - IoU(sam3_bbox, v1_bbox) ≥ 0.8 → auto-transfer label as-is
  - 0.5 ≤ IoU < 0.8 → auto-transfer ONLY if old label is "correct"
    (bbox_correct-subject_not-clipped, implicit or explicit) AND new bbox area
    ≥ old bbox area * 0.9 (i.e., new bbox is similar-or-larger; suggests SAM 3
    captured the subject at least as well)
  - IoU < 0.5 → re-review queue (don't auto-transfer)
  - One side has no bbox → re-review queue

Usage:
    .venv/bin/python -m tools.transfer_labels --dry-run
    .venv/bin/python -m tools.transfer_labels --apply
    .venv/bin/python -m tools.transfer_labels --dry-run --only-image-ids img-A,img-B
"""
from __future__ import annotations
import argparse
import json
import shutil
import sys
import time
from pathlib import Path

import polars as pl

from scripts.detect_subjects.config import CACHE_DIR, PARQUET_PATH
from scripts.detect_subjects.metrics import iou_xywh_normalized

LABELS_PATH = CACHE_DIR / "labels.json"
BACKUP_DIR = Path(__file__).resolve().parent / "manual-labels-backups"
REVIEW_QUEUE_PATH = Path(__file__).resolve().parent / "transfer_review_queue.json"

DEFAULT_V1_VARIANT = "grounding_dino__insectsam"
DEFAULT_V2_VARIANT = "sam3__sam3"

STRONG_IOU = 0.8
WEAK_IOU = 0.5

# Labels that count as "correct" (gate-pass column 1). Empty/absent flags + the
# default also count as correct (user accepted the bbox implicitly).
CORRECT_BBOX_LABELS = {"bbox_correct-subject_not-clipped"}


def _bbox_from_row(row: dict | None):
    if not row or row.get("bbox_x") is None:
        return None
    return (row["bbox_x"], row["bbox_y"], row["bbox_w"], row["bbox_h"])


def _bbox_area(bb) -> float:
    return bb[2] * bb[3] if bb else 0.0


def _label_is_correct(flags: list[str]) -> bool:
    """User considered the bbox correct? True if no bbox-rejection flag is set."""
    bbox_flags = {f for f in (flags or []) if f.startswith("bbox_") or f == "bbox-content_no-bug"}
    rejecting = {
        "bbox_wrong-subject",
        "bbox_correct-subject_clipped",
        "bbox-content_no-bug",
    }
    return not (bbox_flags & rejecting)


def classify_transfer(iou: float | None, v1_bbox, v2_bbox, label_record: dict) -> tuple[str, str]:
    """Decide what to do with a labeled image's labels under SAM 3.

    Returns (decision, reason) where decision is one of:
      "auto_strong"     — IoU ≥ 0.8, copy labels as-is
      "auto_conditional" — 0.5 ≤ IoU < 0.8, label was correct + new bbox larger-or-similar
      "review"          — re-review needed
    """
    if v1_bbox is None or v2_bbox is None:
        return "review", "one_side_no_bbox"
    if iou is None:
        return "review", "iou_unknown"

    if iou >= STRONG_IOU:
        return "auto_strong", f"iou={iou:.3f} ≥ {STRONG_IOU}"

    if iou >= WEAK_IOU:
        flags = label_record.get("flags") or []
        if not _label_is_correct(flags):
            return "review", f"iou={iou:.3f} in soft band but label was bbox-rejecting"
        if _bbox_area(v2_bbox) < 0.9 * _bbox_area(v1_bbox):
            return "review", f"iou={iou:.3f} but new bbox smaller than 0.9x old"
        return "auto_conditional", f"iou={iou:.3f}, correct label, new bbox ≥ old"

    return "review", f"iou={iou:.3f} < {WEAK_IOU}"


def plan_transfer(
    parquet_path: Path,
    labels_path: Path,
    v1_variant: str,
    v2_variant: str,
    only_image_ids: set[str] | None = None,
) -> dict:
    """Compute the planned action per labeled image; do not write anything."""
    df = pl.read_parquet(parquet_path)
    df_v1 = df.filter(pl.col("variant") == v1_variant)
    df_v2 = df.filter(pl.col("variant") == v2_variant)
    v1_idx = {r["image_id"]: r for r in df_v1.iter_rows(named=True)}
    v2_idx = {r["image_id"]: r for r in df_v2.iter_rows(named=True)}

    labels = json.loads(labels_path.read_text()) if labels_path.exists() else {}

    actions: dict[str, dict] = {}
    for image_id, rec in labels.items():
        if only_image_ids and image_id not in only_image_ids:
            continue
        v1_bbox = _bbox_from_row(v1_idx.get(image_id))
        v2_bbox = _bbox_from_row(v2_idx.get(image_id))
        iou = None
        if v1_bbox and v2_bbox:
            iou = iou_xywh_normalized(v1_bbox, v2_bbox)
        decision, reason = classify_transfer(iou, v1_bbox, v2_bbox, rec)
        actions[image_id] = {
            "decision": decision,
            "reason": reason,
            "iou": iou,
            "label_flags": rec.get("flags") or [],
        }
    return {
        "n_labels": len(labels),
        "n_planned": len(actions),
        "actions": actions,
    }


def apply_transfer(plan: dict, labels_path: Path, v2_variant: str) -> dict:
    """Apply the plan: backup labels.json, write transferred labels, write review queue."""
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    backup_path = BACKUP_DIR / f"labels-pre-transfer-{int(time.time())}.json"
    shutil.copy2(str(labels_path), str(backup_path))
    print(f"[transfer_labels] backup: {backup_path}", file=sys.stderr)

    labels = json.loads(labels_path.read_text())
    transferred = 0
    review_queue: dict[str, dict] = {}
    for image_id, action in plan["actions"].items():
        rec = labels.get(image_id, {})
        if action["decision"] in ("auto_strong", "auto_conditional"):
            rec = dict(rec)
            rec["transferred_at"] = int(time.time() * 1000)
            rec["transferred_from_variant"] = v2_variant.split("__")[0]  # rough lineage
            rec["transfer_iou"] = action["iou"]
            rec["transfer_decision"] = action["decision"]
            labels[image_id] = rec
            transferred += 1
        else:
            review_queue[image_id] = {
                "reason": action["reason"],
                "iou": action["iou"],
                "existing_flags": action["label_flags"],
            }

    tmp = labels_path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(labels, indent=2))
    tmp.replace(labels_path)
    REVIEW_QUEUE_PATH.write_text(json.dumps(review_queue, indent=2))
    print(f"[transfer_labels] transferred: {transferred}", file=sys.stderr)
    print(f"[transfer_labels] review queue: {len(review_queue)} → {REVIEW_QUEUE_PATH}", file=sys.stderr)
    return {"transferred": transferred, "review_queue_size": len(review_queue)}


def render_summary(plan: dict) -> str:
    counts = {"auto_strong": 0, "auto_conditional": 0, "review": 0}
    for a in plan["actions"].values():
        counts[a["decision"]] += 1
    n = plan["n_planned"]
    return "\n".join([
        f"# Label transfer plan ({n} labeled images considered)",
        "",
        f"- auto_strong (IoU ≥ {STRONG_IOU}):       **{counts['auto_strong']}** ({counts['auto_strong']/n*100:.1f}%)" if n else "",
        f"- auto_conditional (soft band, eligible): **{counts['auto_conditional']}** ({counts['auto_conditional']/n*100:.1f}%)" if n else "",
        f"- review queue:                            **{counts['review']}** ({counts['review']/n*100:.1f}%)" if n else "",
        "",
    ])


def main() -> int:
    ap = argparse.ArgumentParser(description="IoU-based label transfer. READ MODULE DOCSTRING FIRST.")
    ap.add_argument("--dry-run", action="store_true", default=True)
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--v1-variant", default=DEFAULT_V1_VARIANT)
    ap.add_argument("--v2-variant", default=DEFAULT_V2_VARIANT)
    ap.add_argument("--only-image-ids", default=None, help="comma-separated subset")
    ap.add_argument("--parquet", type=Path, default=PARQUET_PATH)
    ap.add_argument("--labels", type=Path, default=LABELS_PATH)
    args = ap.parse_args()

    only = set(args.only_image_ids.split(",")) if args.only_image_ids else None
    plan = plan_transfer(args.parquet, args.labels, args.v1_variant, args.v2_variant, only)
    print(render_summary(plan))
    for image_id, a in list(plan["actions"].items())[:10]:
        iou_str = f"{a['iou']:.3f}" if a["iou"] is not None else "—"
        print(f"  {image_id}: {a['decision']} (iou={iou_str}, {a['reason']})")
    if len(plan["actions"]) > 10:
        print(f"  ... and {len(plan['actions']) - 10} more")

    if args.apply:
        result = apply_transfer(plan, args.labels, args.v2_variant)
        print(f"\nAPPLIED: {result['transferred']} transferred, {result['review_queue_size']} → review queue")
    else:
        print("\n[dry-run; pass --apply to write]")
    return 0


if __name__ == "__main__":
    sys.exit(main())
