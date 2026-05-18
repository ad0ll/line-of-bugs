"""Connection factory: PRAGMAs land as expected, default path resolves."""
from __future__ import annotations
import sqlite3
import tempfile
from pathlib import Path

import pytest


def test_open_conn_sets_pragmas(tmp_path):
    from scripts.detect_subjects.sqlite_db import open_conn
    db_path = tmp_path / "x.db"
    # Create the file so SQLite has somewhere to set WAL.
    sqlite3.connect(db_path).close()
    conn = open_conn(db_path)
    try:
        assert conn.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
        assert conn.execute("PRAGMA foreign_keys").fetchone()[0] == 1
        assert conn.execute("PRAGMA busy_timeout").fetchone()[0] == 5000
        # synchronous=NORMAL is value 1
        assert conn.execute("PRAGMA synchronous").fetchone()[0] == 1
    finally:
        conn.close()


def test_open_conn_default_path_resolves_to_project_db():
    from scripts.detect_subjects.sqlite_db import DEFAULT_DB_PATH
    assert DEFAULT_DB_PATH.name == "line-of-bugs.db"
    assert DEFAULT_DB_PATH.parent.name == "db"


def test_open_conn_returns_sqlite3_connection(tmp_path):
    from scripts.detect_subjects.sqlite_db import open_conn
    db_path = tmp_path / "y.db"
    sqlite3.connect(db_path).close()
    conn = open_conn(db_path)
    try:
        assert isinstance(conn, sqlite3.Connection)
    finally:
        conn.close()
