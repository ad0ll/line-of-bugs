"""SQLite connection helper for the detect_subjects ML pipeline.

Single source of truth for the PRAGMA set used by every Python module
that opens a connection to data/db/line-of-bugs.db. Mirrors db/index.ts
on the Next.js side and scripts/db.py:DbWriter on the fetcher side.

Convention: every function that takes a `db_path` argument should default
it to None and resolve to `DEFAULT_DB_PATH` at CALL TIME (not as a default
argument value). This makes monkeypatching `DEFAULT_DB_PATH` in tests
actually work — Python binds default-arg values at function-definition
time, so `def f(db: Path = DEFAULT_DB_PATH)` would capture the original
constant and ignore any later monkeypatch.
"""
from __future__ import annotations
import sqlite3
from pathlib import Path
from typing import Optional

ROOT = Path(__file__).resolve().parent.parent.parent
DEFAULT_DB_PATH = ROOT / "data" / "db" / "line-of-bugs.db"


def open_conn(db_path: Optional[Path] = None) -> sqlite3.Connection:
    """Return a sqlite3.Connection with WAL + foreign_keys + busy_timeout
    set. Use this everywhere instead of bare sqlite3.connect()."""
    if db_path is None:
        db_path = DEFAULT_DB_PATH
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA synchronous = NORMAL")
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA busy_timeout = 5000")
    return conn
