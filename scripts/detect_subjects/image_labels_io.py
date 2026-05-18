"""Read/write the `image_labels` table.

The validator UI emits labels as JSON dicts with this shape:
  {
    "col1": "bbox_correct-subject_not-clipped",
    "col2_count": "bbox-content_single",
    "col2_flags": [...],   # JSON array
    "col3": [...],         # JSON array
    "col4": [...],         # JSON array
    "unsure": bool,
    "reviewed_at": int_ms_or_None,
    "user_edited": bool,
    "variant_tag": str,
  }

This module is the single source of truth for translating that shape
to/from SQLite. JSON columns (col2_flags, col3, col4) are stored as
TEXT with JSON content — Python does the encoding here so consumers
can deal in native dicts/lists.
"""
from __future__ import annotations
import json
import sqlite3
from typing import Optional


_COLS = (
    "image_id", "col1", "col2_count", "col2_flags", "col3", "col4",
    "unsure", "reviewed_at", "user_edited", "variant_tag",
)
_UPDATE_COLS = tuple(c for c in _COLS if c != "image_id")

_UPSERT_SQL = (
    f"INSERT INTO image_labels ({', '.join(_COLS)}) "
    f"VALUES ({', '.join('?' for _ in _COLS)}) "
    f"ON CONFLICT(image_id) DO UPDATE SET "
    + ", ".join(f"{c}=excluded.{c}" for c in _UPDATE_COLS)
)


def _decode_row(row: tuple) -> dict:
    """Turn a SELECT row into the JSON-flavoured dict the UI uses."""
    (col1, col2_count, col2_flags_j, col3_j, col4_j,
     unsure, reviewed_at, user_edited, variant_tag) = row
    return {
        "col1": col1,
        "col2_count": col2_count,
        "col2_flags": json.loads(col2_flags_j) if col2_flags_j else [],
        "col3": json.loads(col3_j) if col3_j else [],
        "col4": json.loads(col4_j) if col4_j else [],
        "unsure": bool(unsure),
        "reviewed_at": reviewed_at,
        "user_edited": bool(user_edited),
        "variant_tag": variant_tag,
    }


def fetch_label(conn: sqlite3.Connection, image_id: str) -> Optional[dict]:
    row = conn.execute(
        "SELECT col1, col2_count, col2_flags, col3, col4, "
        "unsure, reviewed_at, user_edited, variant_tag "
        "FROM image_labels WHERE image_id = ?",
        (image_id,),
    ).fetchone()
    if row is None:
        return None
    return _decode_row(row)


def upsert_label(
    conn: sqlite3.Connection, image_id: str, record: dict,
) -> None:
    """Upsert one image_labels row from a UI-shaped dict.

    Does NOT commit — callers are responsible for the transaction boundary.
    This matters for batch saves (label_server POST) where we want all-or-
    nothing semantics matching the legacy labels.json atomic-rename behavior.
    """
    values = (
        image_id,
        record.get("col1"),
        record.get("col2_count"),
        json.dumps(record.get("col2_flags") or []),
        json.dumps(record.get("col3") or []),
        json.dumps(record.get("col4") or []),
        int(bool(record.get("unsure", False))),
        record.get("reviewed_at"),
        int(bool(record.get("user_edited", False))),
        record.get("variant_tag"),
    )
    conn.execute(_UPSERT_SQL, values)


def delete_labels_not_in(
    conn: sqlite3.Connection, keep_ids: set[str],
) -> int:
    """Delete image_labels rows whose image_id is NOT in keep_ids. Returns
    the count deleted. Used by the POST /api/labels handler to honor the
    legacy 'POST body is the full state' semantic — if the UI removed a key
    from its LABELS dict (user cleared every label on a card), we must
    remove the corresponding row instead of leaving it orphaned.

    Does NOT commit."""
    if not keep_ids:
        cur = conn.execute("DELETE FROM image_labels")
        return cur.rowcount
    # SQLite parameter limit is high (32k+) — fine for our ~300 keys.
    placeholders = ",".join("?" * len(keep_ids))
    cur = conn.execute(
        f"DELETE FROM image_labels WHERE image_id NOT IN ({placeholders})",
        tuple(keep_ids),
    )
    return cur.rowcount


def fetch_all_reviewed_labels(
    conn: sqlite3.Connection,
    variant_tag: Optional[str] = None,
) -> dict[str, dict]:
    """Return {image_id: record_dict} for rows where reviewed_at IS NOT NULL.

    If variant_tag is given, also filters by it (useful for the
    sam3-only training selector)."""
    sql = (
        "SELECT image_id, col1, col2_count, col2_flags, col3, col4, "
        "unsure, reviewed_at, user_edited, variant_tag "
        "FROM image_labels WHERE reviewed_at IS NOT NULL"
    )
    args: tuple = ()
    if variant_tag is not None:
        sql += " AND variant_tag = ?"
        args = (variant_tag,)
    out: dict[str, dict] = {}
    for row in conn.execute(sql, args):
        out[row[0]] = _decode_row(row[1:])
    return out
