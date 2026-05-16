"""Evaluate the v1 framing detector against human labels.

Phase 0: per-label confusion matrix (P/R/F1) of `suggested_labels` vs the
         human flags in data/cache/labels.json.
Phase 1: optimal-threshold sweeps for each tunable single-knob rule.
         Reports current threshold's F1 alongside the F1-max threshold so
         we can see whether the tuned value is worth committing.

Usage:
    .venv/bin/python -m scripts.detect_subjects.evaluate_pipeline
    .venv/bin/python -m scripts.detect_subjects.evaluate_pipeline --tune  # full sweeps

Output is a markdown-formatted report to stdout. Read it, then call
`recompute_parquet()` to apply tuned thresholds to existing rows.
"""
from __future__ import annotations
import argparse
import json
import sys
from dataclasses import dataclass
from typing import Iterable

import polars as pl

from scripts.detect_subjects.config import (
    BBOX_EDGE_TOLERANCE_NORMALIZED,
    CACHE_DIR,
    CLASSIFY_BUG_TOO_SMALL_EDGE_PX,
    CLASSIFY_CAMOUFLAGED_DELTA,
    CLASSIFY_HIDDEN_AREA,
    CLASSIFY_HIDDEN_CONF,
    CLASSIFY_WIDE_AREA,
    PARQUET_PATH,
)

VARIANT = "v1_dino_insectsam"
PREF_LABEL_FROM_KIND = {"original": "original-good", "cropped": "cropped-good"}
# Labels the v1 system actually tries to predict via suggest_labels().
# Anything outside this set is user-only (we report frequency, not P/R).
SYSTEM_LABELS = {
    "no-bug", "bug-too-small", "multi-bug", "poor-contrast",
    "subject-clipped", "original-good", "cropped-good",
}


# ─── Loading + label normalisation ─────────────────────────────────

def _load_rows() -> list[dict]:
    df = pl.read_parquet(PARQUET_PATH).filter(pl.col("variant") == VARIANT)
    return [r for r in df.iter_rows(named=True)]


def _load_labels() -> dict[str, dict]:
    with open(CACHE_DIR / "labels.json") as f:
        return json.load(f)


def _user_label_set(record: dict | None) -> set[str]:
    """Flatten a user label record into the set of label names that applied."""
    if not record:
        return set()
    out = set(record.get("flags") or [])
    pref = record.get("preference")
    if pref in PREF_LABEL_FROM_KIND:
        out.add(PREF_LABEL_FROM_KIND[pref])
    return out


# ─── Phase 0: confusion ────────────────────────────────────────────

@dataclass(slots=True)
class LabelEval:
    label: str
    tp: int = 0
    fp: int = 0
    fn: int = 0
    tn: int = 0

    @property
    def precision(self) -> float:
        return self.tp / (self.tp + self.fp) if self.tp + self.fp else 0.0

    @property
    def recall(self) -> float:
        return self.tp / (self.tp + self.fn) if self.tp + self.fn else 0.0

    @property
    def f1(self) -> float:
        p, r = self.precision, self.recall
        return 2 * p * r / (p + r) if p + r else 0.0

    @property
    def n_user(self) -> int:
        return self.tp + self.fn

    @property
    def n_system(self) -> int:
        return self.tp + self.fp


def _eval_label(
    label: str, rows: list[dict], labels: dict[str, dict],
    system_predicate=None,
) -> LabelEval:
    """Compare system's prediction (from suggested_labels OR a custom predicate)
    against user's labels for `label`. Skips unlabeled images and `unsure` flags."""
    ev = LabelEval(label=label)
    for row in rows:
        image_id = row["image_id"]
        rec = labels.get(image_id)
        if rec is None:
            continue
        if rec.get("unsure"):
            continue
        user_set = _user_label_set(rec)
        if system_predicate is not None:
            sys_pos = bool(system_predicate(row))
        else:
            sys_pos = label in (row.get("suggested_labels") or [])
        usr_pos = label in user_set
        if sys_pos and usr_pos: ev.tp += 1
        elif sys_pos:           ev.fp += 1
        elif usr_pos:           ev.fn += 1
        else:                   ev.tn += 1
    return ev


def phase0(rows: list[dict], labels: dict[str, dict]) -> None:
    print("# Phase 0 — Per-label confusion vs human labels\n")
    reviewed = [r for r in rows if r["image_id"] in labels and not labels[r["image_id"]].get("unsure")]
    print(f"Reviewed images: **{len(reviewed)}** of {len(rows)} v1 rows "
          f"(`unsure` and unlabeled excluded).\n")

    # ── System-predicted labels: full P/R/F1
    print("## System-predicted labels (precision / recall / F1)\n")
    print("| label | user-labeled | system-predicted | TP | FP | FN | precision | recall | F1 |")
    print("|---|---:|---:|---:|---:|---:|---:|---:|---:|")
    system_evals = []
    for label in sorted(SYSTEM_LABELS):
        ev = _eval_label(label, rows, labels)
        system_evals.append(ev)
        print(f"| `{label}` | {ev.n_user} | {ev.n_system} | "
              f"{ev.tp} | {ev.fp} | {ev.fn} | "
              f"{ev.precision:.2f} | {ev.recall:.2f} | {ev.f1:.2f} |")

    # ── User-only labels: just frequency (system never predicts these)
    print("\n## User-only labels (system doesn't predict — frequency only)\n")
    user_only_counts: dict[str, int] = {}
    for image_id in labels:
        rec = labels[image_id]
        if rec.get("unsure"):
            continue
        for f in _user_label_set(rec):
            if f not in SYSTEM_LABELS:
                user_only_counts[f] = user_only_counts.get(f, 0) + 1
    print("| label | count |")
    print("|---|---:|")
    for k in sorted(user_only_counts, key=lambda x: -user_only_counts[x]):
        print(f"| `{k}` | {user_only_counts[k]} |")

    # ── Weakness call-outs
    print("\n## Weakness summary\n")
    weak = [ev for ev in system_evals if ev.f1 < 0.7]
    if weak:
        for ev in sorted(weak, key=lambda e: e.f1):
            print(f"- **{ev.label}**: F1={ev.f1:.2f} "
                  f"(precision {ev.precision:.2f}, recall {ev.recall:.2f}). "
                  f"User says yes on {ev.n_user}, system says yes on {ev.n_system}, "
                  f"{ev.tp} agree.")
    else:
        print("- All system-predicted labels at F1 ≥ 0.70.")


# ─── Phase 1: threshold sweeps ─────────────────────────────────────

def _bbox_touches_edge(row, tol: float) -> bool:
    bx, by, bw, bh = row.get("bbox_x"), row.get("bbox_y"), row.get("bbox_w"), row.get("bbox_h")
    if bx is None: return False
    return bx < tol or by < tol or (bx + bw) > (1.0 - tol) or (by + bh) > (1.0 - tol)


def _sweep(label: str, rows: list[dict], labels: dict[str, dict],
           thresholds: Iterable[float], predicate_factory,
           current_threshold: float | None = None) -> tuple[float, float, float]:
    """Sweep a single-knob predicate. Returns (best_t, best_f1, current_f1)."""
    best_t, best_f1 = None, -1.0
    current_f1 = None
    rows_sorted = list(thresholds)
    for t in rows_sorted:
        pred = predicate_factory(t)
        ev = _eval_label(label, rows, labels, system_predicate=pred)
        if ev.f1 > best_f1:
            best_t, best_f1 = t, ev.f1
        if current_threshold is not None and abs(t - current_threshold) < 1e-9:
            current_f1 = ev.f1
    return best_t, best_f1, current_f1


def _sweep_2d(label: str, rows: list[dict], labels: dict[str, dict],
              a_grid: Iterable[float], b_grid: Iterable[float],
              predicate_factory,
              current_a: float | None = None, current_b: float | None = None,
              ) -> tuple[float, float, float, float | None]:
    """2D sweep. predicate_factory takes (a, b). Returns (best_a, best_b, best_f1, current_f1)."""
    best = (None, None, -1.0)
    current_f1 = None
    for a in a_grid:
        for b in b_grid:
            pred = predicate_factory(a, b)
            ev = _eval_label(label, rows, labels, system_predicate=pred)
            if ev.f1 > best[2]:
                best = (a, b, ev.f1)
            if (current_a is not None and current_b is not None
                    and abs(a - current_a) < 1e-9 and abs(b - current_b) < 1e-9):
                current_f1 = ev.f1
    return best[0], best[1], best[2], current_f1


def phase1(rows: list[dict], labels: dict[str, dict]) -> dict[str, dict]:
    print("\n# Phase 1 — Threshold sweeps\n")
    print("For each tunable knob: scan a reasonable range, report the F1-max "
          "threshold next to the currently-configured one. F1 is computed "
          "against the human label that the rule produces.\n")
    out: dict[str, dict] = {}

    # ── no-bug ← CLASSIFY_HIDDEN_CONF (low conf → no-bug)
    def _no_bug_pred(t):
        return lambda r: (r.get("confidence") is None or r.get("bbox_area_ratio") is None or r["confidence"] < t)
    best_t, best_f1, cur_f1 = _sweep(
        "no-bug", rows, labels,
        [round(x * 0.01, 2) for x in range(5, 60)],
        _no_bug_pred,
        current_threshold=CLASSIFY_HIDDEN_CONF,
    )
    out["CLASSIFY_HIDDEN_CONF"] = {"current": CLASSIFY_HIDDEN_CONF, "current_f1": cur_f1,
                                    "best": best_t, "best_f1": best_f1, "label": "no-bug"}
    print(f"- **`CLASSIFY_HIDDEN_CONF`** (no-bug gate): "
          f"current = {CLASSIFY_HIDDEN_CONF} (F1={cur_f1:.2f}) → "
          f"best = {best_t} (F1={best_f1:.2f})")

    # ── bug-too-small ← AREA × LONG_EDGE 2D sweep
    def _bts_pred(area_th, edge_th):
        def pred(r):
            if r.get("confidence") is None or r.get("bbox_area_ratio") is None:
                return False
            if r["confidence"] < CLASSIFY_HIDDEN_CONF:
                return False  # no-bug shadows bug-too-small
            return r["bbox_area_ratio"] < area_th or (
                r.get("bbox_long_edge_px") is not None
                and r["bbox_long_edge_px"] < edge_th)
        return pred
    a_grid = [round(x * 0.005, 3) for x in range(1, 12)]   # 0.005 → 0.055
    e_grid = list(range(256, 1024 + 1, 64))                # 256 → 1024
    best_a, best_e, best_f1, cur_f1 = _sweep_2d(
        "bug-too-small", rows, labels, a_grid, e_grid, _bts_pred,
        current_a=CLASSIFY_HIDDEN_AREA, current_b=CLASSIFY_BUG_TOO_SMALL_EDGE_PX,
    )
    out["CLASSIFY_HIDDEN_AREA"] = {"current": CLASSIFY_HIDDEN_AREA, "best": best_a}
    out["CLASSIFY_BUG_TOO_SMALL_EDGE_PX"] = {"current": CLASSIFY_BUG_TOO_SMALL_EDGE_PX, "best": best_e,
                                              "current_f1": cur_f1, "best_f1": best_f1,
                                              "label": "bug-too-small"}
    print(f"- **`CLASSIFY_HIDDEN_AREA` × `CLASSIFY_BUG_TOO_SMALL_EDGE_PX`** "
          f"(bug-too-small gate): current = ({CLASSIFY_HIDDEN_AREA}, {CLASSIFY_BUG_TOO_SMALL_EDGE_PX}) "
          f"F1={cur_f1:.2f} → best = ({best_a}, {best_e}) F1={best_f1:.2f}")

    # ── poor-contrast ← CLASSIFY_CAMOUFLAGED_DELTA
    def _pc_pred(t):
        return lambda r: (
            r.get("mask_area_ratio") is not None
            and r.get("lab_delta_e") is not None
            and r["lab_delta_e"] < t
        )
    best_t, best_f1, cur_f1 = _sweep(
        "poor-contrast", rows, labels,
        [round(x * 0.5, 1) for x in range(2, 31)],  # 1.0 → 15.0
        _pc_pred, current_threshold=CLASSIFY_CAMOUFLAGED_DELTA,
    )
    out["CLASSIFY_CAMOUFLAGED_DELTA"] = {"current": CLASSIFY_CAMOUFLAGED_DELTA, "current_f1": cur_f1,
                                          "best": best_t, "best_f1": best_f1, "label": "poor-contrast"}
    print(f"- **`CLASSIFY_CAMOUFLAGED_DELTA`** (poor-contrast gate): "
          f"current = {CLASSIFY_CAMOUFLAGED_DELTA} (F1={cur_f1:.2f}) → "
          f"best = {best_t} (F1={best_f1:.2f})")

    # ── subject-clipped ← BBOX_EDGE_TOLERANCE_NORMALIZED
    def _sc_pred(t):
        return lambda r: _bbox_touches_edge(r, t)
    best_t, best_f1, cur_f1 = _sweep(
        "subject-clipped", rows, labels,
        [round(x * 0.001, 3) for x in range(1, 81)],  # 0.001 → 0.08
        _sc_pred, current_threshold=BBOX_EDGE_TOLERANCE_NORMALIZED,
    )
    out["BBOX_EDGE_TOLERANCE_NORMALIZED"] = {"current": BBOX_EDGE_TOLERANCE_NORMALIZED, "current_f1": cur_f1,
                                              "best": best_t, "best_f1": best_f1, "label": "subject-clipped"}
    print(f"- **`BBOX_EDGE_TOLERANCE_NORMALIZED`** (subject-clipped gate): "
          f"current = {BBOX_EDGE_TOLERANCE_NORMALIZED} (F1={cur_f1:.2f}) → "
          f"best = {best_t} (F1={best_f1:.2f})")

    # ── cropped-good vs original-good ← CLASSIFY_WIDE_AREA
    # When no problems fire, area < T → cropped-good; else original-good.
    # We optimise the SPLIT against the cropped-good label.
    def _cg_pred(t):
        def pred(r):
            if r.get("confidence") is None or r.get("bbox_area_ratio") is None:
                return False
            if r["confidence"] < CLASSIFY_HIDDEN_CONF:
                return False
            # Use CURRENT problem-detection rules to identify "no problems" cases
            from scripts.detect_subjects.rule_labeler import suggest_labels
            sl = suggest_labels(
                confidence=r["confidence"], bbox_area_ratio=r["bbox_area_ratio"],
                bbox_long_edge_px=r.get("bbox_long_edge_px"),
                n_distinct_detections=r["n_distinct_detections"],
                mask_area_ratio=r.get("mask_area_ratio"),
                lab_delta_e=r.get("lab_delta_e"),
                bbox_touches_edge=r.get("bbox_touches_edge"),
            )
            problems = {"no-bug", "bug-too-small", "multi-bug", "poor-contrast", "subject-clipped"}
            if any(p in sl for p in problems):
                return False
            return r["bbox_area_ratio"] < t
        return pred
    best_t, best_f1, cur_f1 = _sweep(
        "cropped-good", rows, labels,
        [round(x * 0.02, 2) for x in range(2, 26)],  # 0.04 → 0.50
        _cg_pred, current_threshold=CLASSIFY_WIDE_AREA,
    )
    out["CLASSIFY_WIDE_AREA"] = {"current": CLASSIFY_WIDE_AREA, "current_f1": cur_f1,
                                  "best": best_t, "best_f1": best_f1, "label": "cropped-good"}
    print(f"- **`CLASSIFY_WIDE_AREA`** (cropped-good vs original-good): "
          f"current = {CLASSIFY_WIDE_AREA} (F1={cur_f1:.2f}) → "
          f"best = {best_t} (F1={best_f1:.2f})")
    return out


# ─── Apply tuned thresholds + recompute parquet ─────────────────────

def recompute_parquet(rows: list[dict],
                       tuned: dict[str, float] | None = None,
                       out_path=PARQUET_PATH) -> None:
    """Recompute suggested_labels + framing_quality using current config (or
    tuned overrides) and rewrite the parquet for VARIANT rows in place."""
    from scripts.detect_subjects import config as cfg
    from scripts.detect_subjects.rule_labeler import suggest_labels, classify_framing
    if tuned:
        for k, v in tuned.items():
            setattr(cfg, k, v)

    full = pl.read_parquet(out_path)
    other = full.filter(pl.col("variant") != VARIANT)
    v1 = full.filter(pl.col("variant") == VARIANT)
    updated = []
    for row in v1.iter_rows(named=True):
        # Recompute bbox_touches_edge with possibly-tuned tolerance.
        tol = cfg.BBOX_EDGE_TOLERANCE_NORMALIZED
        new_touches = _bbox_touches_edge(row, tol) if row.get("bbox_x") is not None else None
        row["bbox_touches_edge"] = new_touches
        row["suggested_labels"] = suggest_labels(
            confidence=row["confidence"], bbox_area_ratio=row["bbox_area_ratio"],
            bbox_long_edge_px=row.get("bbox_long_edge_px"),
            n_distinct_detections=row["n_distinct_detections"],
            mask_area_ratio=row.get("mask_area_ratio"),
            lab_delta_e=row.get("lab_delta_e"),
            bbox_touches_edge=row["bbox_touches_edge"],
        )
        row["framing_quality"] = classify_framing(
            confidence=row["confidence"], bbox_area_ratio=row["bbox_area_ratio"],
            bbox_long_edge_px=row.get("bbox_long_edge_px"),
            n_distinct_detections=row["n_distinct_detections"],
            mask_area_ratio=row.get("mask_area_ratio"),
            lab_delta_e=row.get("lab_delta_e"),
            bbox_touches_edge=row["bbox_touches_edge"],
        )
        updated.append(row)
    new_v1 = pl.from_dicts(updated, schema=v1.schema)
    combined = pl.concat([other, new_v1])
    combined.write_parquet(out_path, compression="snappy")
    print(f"[recompute] rewrote {len(updated)} v1 rows in {out_path}")


# ─── CLI ───────────────────────────────────────────────────────────

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true",
                    help="After tuning, recompute parquet with the chosen thresholds.")
    args = ap.parse_args()

    rows = _load_rows()
    labels = _load_labels()
    phase0(rows, labels)
    tuned = phase1(rows, labels)
    if args.apply:
        chosen = {k: v["best"] for k, v in tuned.items() if v.get("best") is not None}
        print(f"\n[apply] recomputing parquet with: {chosen}")
        recompute_parquet(rows, tuned=chosen)
