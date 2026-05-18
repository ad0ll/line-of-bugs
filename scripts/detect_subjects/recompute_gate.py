"""Trust-hierarchy gate recompute. Reads image_labels, reports, detections,
predictions, label_thresholds; writes gate_decisions.

Hierarchy (first match wins):
  1. Hand   - image_labels reviewed by a human + unsure=0 (decide_drawability)
  2. Report - at least one unresolved report row
  3. Rule   - detections.suggested_labels contains a reject label
  4. ML     - any tier-1, reliable prediction with p >= threshold
  5. Default - keep ('innocent until proven flagged')

Three entry points:
  recompute_for_image(image_id, conn, now_s) - called by label_server.py + reports backend
  recompute_for_label(label, conn, now_s)    - called by predict.py after retrain
  recompute_all(conn, now_s)                 - manual rebuild

CLI:
  python -m scripts.detect_subjects.recompute_gate --all
  python -m scripts.detect_subjects.recompute_gate --image-id <id>
  python -m scripts.detect_subjects.recompute_gate --label <label>
"""
from __future__ import annotations
import argparse
import json
import sqlite3
import time
from pathlib import Path
from typing import Optional

from scripts.detect_subjects.gate import decide_drawability
from scripts.detect_subjects.sqlite_db import open_conn, DEFAULT_DB_PATH


REJECT_RULE_LABELS = frozenset({
    "bbox-content_no-bug",
    "bbox-content_bbox-multibug_unusable",
    "bbox-content_subject-too-small",
})

_UPSERT_GATE_SQL = (
    "INSERT INTO gate_decisions "
    "(image_id, decision, reason, reason_source, computed_at, "
    "model_version, threshold_v) "
    "VALUES (?, ?, ?, ?, ?, ?, ?) "
    "ON CONFLICT(image_id) DO UPDATE SET "
    "decision=excluded.decision, reason=excluded.reason, "
    "reason_source=excluded.reason_source, "
    "computed_at=excluded.computed_at, "
    "model_version=excluded.model_version, "
    "threshold_v=excluded.threshold_v"
)


def _write(
    conn: sqlite3.Connection, image_id: str, decision: str, reason: str,
    reason_source: str, now_s: int, *,
    model_version: Optional[str] = None, threshold_v: Optional[int] = None,
) -> dict:
    conn.execute(_UPSERT_GATE_SQL, (
        image_id, decision, reason, reason_source, now_s,
        model_version, threshold_v,
    ))
    return {
        "image_id": image_id, "decision": decision, "reason": reason,
        "reason_source": reason_source, "computed_at": now_s,
        "model_version": model_version, "threshold_v": threshold_v,
    }


def _hand_reject_reason(
    col1: Optional[str], col2_count: Optional[str],
    flags: list[str], col3: list[str], col4: list[str],
) -> str:
    """Build a 'hand:<which-failure>' reason string. First failure wins."""
    if col1 and col1 != "bbox_correct-subject_not-clipped":
        return f"hand:bbox:{col1}"
    if col2_count and col2_count != "bbox-content_single":
        return f"hand:count:{col2_count}"
    if "bbox-content_subject-too-small" in flags:
        return "hand:bbox_too_small"
    if col3:
        return f"hand:mask:{col3[0]}"
    if col4:
        return f"hand:ml:{col4[0]}"
    return "hand:reject"


def recompute_for_image(
    image_id: str, conn: sqlite3.Connection, *, now_s: int,
) -> dict:
    """Compute and write one gate_decisions row. Returns the row dict."""
    # Tier 1: Hand label.
    # unsure=1 means the user marked the card "can't decide" - it is NOT a
    # confirmed hand signal; fall through to lower tiers (rule/ML/default).
    row = conn.execute(
        "SELECT col1, col2_count, col2_flags, col3, col4 "
        "FROM image_labels "
        "WHERE image_id = ? AND reviewed_at IS NOT NULL "
        "  AND user_edited = 1 AND unsure = 0",
        (image_id,),
    ).fetchone()
    if row:
        col1, col2_count, flags_j, col3_j, col4_j = row
        flags = json.loads(flags_j or "[]")
        col3 = json.loads(col3_j or "[]")
        col4 = json.loads(col4_j or "[]")
        decision_enum = decide_drawability({
            "bbox": col1 or "",
            "bbox_content_count": col2_count or "",
            "bbox_too_small": "bbox-content_subject-too-small" in flags,
            "mask_labels": col3,
            "ml_labels": col4,
            "bbox_content_image_multi_bug": "bbox-content_image-multi-bug" in flags,
        })
        if decision_enum.value == "keep":
            return _write(conn, image_id, "keep", "hand:pass", "hand", now_s)
        return _write(
            conn, image_id, "reject",
            _hand_reject_reason(col1, col2_count, flags, col3, col4),
            "hand", now_s,
        )

    # Tier 2: Unresolved report
    rep = conn.execute(
        "SELECT category FROM reports "
        "WHERE image_id = ? AND resolved_at IS NULL "
        "ORDER BY category LIMIT 1",
        (image_id,),
    ).fetchone()
    if rep:
        return _write(conn, image_id, "reject", f"report:{rep[0]}",
                      "report", now_s)

    # Tier 3: Rule
    det = conn.execute(
        "SELECT suggested_labels FROM detections WHERE image_id = ?",
        (image_id,),
    ).fetchone()
    if det:
        rule_labels = json.loads(det[0] or "[]")
        for lbl in rule_labels:
            if lbl in REJECT_RULE_LABELS:
                return _write(conn, image_id, "reject", f"rule:{lbl}",
                              "rule", now_s)

    # Tier 4: ML
    ml = conn.execute(
        "SELECT p.label, p.p, p.model_version, t.threshold, t.threshold_v "
        "FROM predictions p "
        "JOIN label_thresholds t ON p.label = t.label "
        "WHERE p.image_id = ? AND p.unreliable = 0 AND t.tier = 1 "
        "ORDER BY p.label",
        (image_id,),
    ).fetchall()
    for label, p, mv, thresh, thresh_v in ml:
        if p >= thresh:
            return _write(
                conn, image_id, "reject",
                f"ml:{label}:{p:.3f}", "ml", now_s,
                model_version=mv, threshold_v=thresh_v,
            )

    # Tier 5: Default keep
    return _write(conn, image_id, "keep", "defaults_pass", "default", now_s)


def recompute_for_label(
    label: str, conn: sqlite3.Connection, *, now_s: int,
) -> int:
    """Recompute every image with a prediction row for `label`. Returns count."""
    rows = conn.execute(
        "SELECT image_id FROM predictions WHERE label = ?",
        (label,),
    ).fetchall()
    conn.execute("BEGIN")
    try:
        for (image_id,) in rows:
            recompute_for_image(image_id, conn, now_s=now_s)
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    return len(rows)


def recompute_all(conn: sqlite3.Connection, *, now_s: int) -> dict:
    """Recompute every image in `images`. Returns {kept, rejected, elapsed_s}."""
    t0 = time.perf_counter()
    image_ids = [r[0] for r in conn.execute("SELECT image_id FROM images")]
    kept = 0
    rejected = 0
    conn.execute("BEGIN")
    try:
        for image_id in image_ids:
            row = recompute_for_image(image_id, conn, now_s=now_s)
            if row["decision"] == "keep":
                kept += 1
            else:
                rejected += 1
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    elapsed = time.perf_counter() - t0
    print(f"[recompute_gate] {len(image_ids)} images: "
          f"{kept} kept, {rejected} rejected ({elapsed:.1f}s)")
    return {"kept": kept, "rejected": rejected, "elapsed_s": round(elapsed, 1)}


def _cli() -> None:
    ap = argparse.ArgumentParser()
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--all", action="store_true",
                   help="Recompute every image in images.")
    g.add_argument("--image-id", help="Recompute one image.")
    g.add_argument("--label", help="Recompute all rows with a prediction "
                   "for this label.")
    args = ap.parse_args()
    conn = open_conn()
    now_s = int(time.time())
    try:
        if args.all:
            recompute_all(conn, now_s=now_s)
        elif args.image_id:
            row = recompute_for_image(args.image_id, conn, now_s=now_s)
            conn.commit()
            print(json.dumps(row, indent=2))
        else:
            n = recompute_for_label(args.label, conn, now_s=now_s)
            print(f"[recompute_gate] {n} rows touched for label={args.label!r}")
    finally:
        conn.close()


if __name__ == "__main__":
    _cli()
