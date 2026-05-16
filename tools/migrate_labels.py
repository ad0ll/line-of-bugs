#!/usr/bin/env python3
"""Migrate labels.json to the Phase 2a label vocabulary.

The rename mapping table is NOT yet defined here — that lands in Phase 2a.
This script ships the full migration infrastructure (atomic write, backup,
dry-run mode) so Phase 2a only needs to fill in RENAME_MAP and DROP_LABELS.

Current state: --dry-run works (reports what WOULD be done). --apply raises
NotImplementedError because the mapping table is empty.

Usage:
    .venv/bin/python tools/migrate_labels.py --dry-run [--labels PATH]
    .venv/bin/python tools/migrate_labels.py --apply   [--labels PATH]

Delete after running in Phase 2a per repo convention.
"""
from __future__ import annotations
import argparse
import json
import os
import shutil
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_LABELS = ROOT / "data" / "cache" / "labels.json"
BACKUP_DIR = ROOT / "tools" / "manual-labels-backups"

# ─── Phase 2a: fill in RENAME_MAP and DROP_LABELS ──────────────────
# RENAME_MAP: {old_label_string: new_label_string}
# DROP_LABELS: set of label strings to drop entirely (not renamed)
# No rename mapping defined yet — fill in for Phase 2a.
RENAME_MAP: dict[str, str] = {}
DROP_LABELS: set[str] = set()
# ───────────────────────────────────────────────────────────────────


def _collect_all_labels(labels: dict) -> set[str]:
    """Return the set of all label strings present across all image records."""
    all_labels: set[str] = set()
    for rec in labels.values():
        if isinstance(rec, dict):
            for flag in rec.get("flags") or []:
                all_labels.add(flag)
            if rec.get("preference"):
                all_labels.add(rec["preference"])
    return all_labels


def _migrate_record(rec: dict) -> dict:
    """Apply RENAME_MAP and DROP_LABELS to a single image label record."""
    new_rec = dict(rec)
    old_flags = list(rec.get("flags") or [])
    new_flags = []
    for f in old_flags:
        if f in DROP_LABELS:
            continue
        new_flags.append(RENAME_MAP.get(f, f))
    new_rec["flags"] = new_flags
    pref = rec.get("preference")
    if pref is not None:
        if pref in DROP_LABELS:
            new_rec["preference"] = None
        else:
            new_rec["preference"] = RENAME_MAP.get(pref, pref)
    return new_rec


def run(labels_path: Path, dry_run: bool) -> None:
    if not labels_path.exists():
        print(f"[migrate_labels] ERROR: {labels_path} not found", file=sys.stderr)
        sys.exit(1)

    labels: dict = json.loads(labels_path.read_text() or "{}")
    print(f"[migrate_labels] loaded {len(labels)} image records from {labels_path}")

    if not RENAME_MAP and not DROP_LABELS:
        print("[migrate_labels] WARNING: RENAME_MAP and DROP_LABELS are both empty.")
        print("[migrate_labels] This is expected for the Phase 2-prep skeleton.")
        print("[migrate_labels] Fill in the mapping table before running --apply.")

    all_labels = _collect_all_labels(labels)
    rename_count = sum(1 for l in all_labels if l in RENAME_MAP)
    drop_count = sum(1 for l in all_labels if l in DROP_LABELS)
    unmatched = all_labels - set(RENAME_MAP) - DROP_LABELS - set(RENAME_MAP.values())

    print(f"[migrate_labels] labels in file: {sorted(all_labels)}")
    print(f"[migrate_labels] would rename {rename_count} label type(s)")
    print(f"[migrate_labels] would drop {drop_count} label type(s)")
    print(f"[migrate_labels] passthrough (no change): {sorted(unmatched)}")

    if dry_run:
        print("[migrate_labels] DRY RUN complete — no files written")
        return

    if not RENAME_MAP and not DROP_LABELS:
        raise NotImplementedError(
            "RENAME_MAP and DROP_LABELS are not yet defined. "
            "This is a Phase 2-prep skeleton. Fill in tools/migrate_labels.py "
            "RENAME_MAP and DROP_LABELS before using --apply."
        )

    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    backup_path = BACKUP_DIR / "labels-pre-phase2.json"
    shutil.copy2(str(labels_path), str(backup_path))
    print(f"[migrate_labels] backed up to {backup_path}")

    migrated = {image_id: _migrate_record(rec) for image_id, rec in labels.items()}

    tmp_fd, tmp_path = tempfile.mkstemp(
        prefix="migrate_labels.", suffix=".json.tmp",
        dir=str(labels_path.parent),
    )
    os.close(tmp_fd)
    try:
        with open(tmp_path, "w") as f:
            json.dump(migrated, f, indent=2)
        os.replace(tmp_path, str(labels_path))
    except Exception:
        try:
            os.unlink(tmp_path)
        except FileNotFoundError:
            pass
        raise

    print(f"[migrate_labels] wrote {len(migrated)} records to {labels_path}")
    print("[migrate_labels] done. Delete this script: tools/migrate_labels.py")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dry-run", action="store_true",
                    help="Show what would be renamed/dropped without writing")
    ap.add_argument("--apply", action="store_true",
                    help="Apply the migration (requires RENAME_MAP to be filled in)")
    ap.add_argument("--labels", default=str(DEFAULT_LABELS),
                    help="Path to labels.json")
    args = ap.parse_args()

    if args.apply and args.dry_run:
        print("[migrate_labels] ERROR: cannot use --apply and --dry-run together", file=sys.stderr)
        sys.exit(1)
    if not args.apply and not args.dry_run:
        print("[migrate_labels] ERROR: specify --dry-run or --apply", file=sys.stderr)
        sys.exit(1)

    try:
        run(Path(args.labels), dry_run=args.dry_run)
    except NotImplementedError as e:
        print(f"[migrate_labels] NotImplementedError: {e}", file=sys.stderr)
        sys.exit(2)


if __name__ == "__main__":
    main()
