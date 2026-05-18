"""One-shot: migrate data/cache/labels.json → SQLite image_labels.

After this runs once successfully and label_server.py is rewired to
SQLite (Task 11), this script is deleted from the repo (Task 12) per
the CLAUDE.md "delete one-shot scripts after they run" convention.

Behavior:
  - Read labels.json
  - For each record, upsert into image_labels (skipping orphan image_ids
    whose images-table row is missing)
  - Write a sibling backup labels.json.bak-pre-sqlite-migration-<ts>
  - Print a summary

Idempotent — upsert means a re-run is a no-op if the DB already matches.
labels.json is intentionally NOT deleted by this script; the operator
deletes it in Task 12 after confirming label_server.py is working off
SQLite.
"""
from __future__ import annotations
import json
import shutil
import sys
import time
from pathlib import Path

from scripts.detect_subjects.sqlite_db import open_conn, DEFAULT_DB_PATH
from scripts.detect_subjects.image_labels_io import upsert_label

DEFAULT_LABELS_PATH = Path(__file__).resolve().parent.parent / "data" / "cache" / "labels.json"


def migrate(
    labels_path: Path = DEFAULT_LABELS_PATH,
    db_path: Path = DEFAULT_DB_PATH,
) -> dict:
    """Run the migration. Returns {migrated, skipped_orphans}."""
    if not labels_path.exists():
        raise FileNotFoundError(f"labels.json not found at {labels_path}")
    labels = json.loads(labels_path.read_text())
    ts = int(time.time())
    backup = labels_path.with_suffix(f".json.bak-pre-sqlite-migration-{ts}")
    shutil.copy2(labels_path, backup)
    print(f"[migrate] backed up labels.json → {backup}")

    conn = open_conn(db_path)
    try:
        existing_image_ids = {
            r[0] for r in conn.execute("SELECT image_id FROM images")
        }
        migrated = 0
        skipped_orphans = 0
        conn.execute("BEGIN")
        try:
            for image_id, record in labels.items():
                if image_id not in existing_image_ids:
                    print(f"[migrate] WARN orphan label, skipping: {image_id}")
                    skipped_orphans += 1
                    continue
                upsert_label(conn, image_id, record)
                migrated += 1
            conn.commit()
        except Exception:
            conn.rollback()
            raise
    finally:
        conn.close()

    print(f"[migrate] {migrated} migrated, {skipped_orphans} orphans skipped")
    return {"migrated": migrated, "skipped_orphans": skipped_orphans}


if __name__ == "__main__":
    summary = migrate()
    sys.exit(0 if summary["migrated"] > 0 else 1)
