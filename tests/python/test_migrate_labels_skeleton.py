"""Verify migrate_labels.py skeleton has the required structure."""
from __future__ import annotations
import subprocess
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT = REPO_ROOT / "tools" / "migrate_labels.py"


def test_migrate_labels_file_exists():
    assert SCRIPT.exists(), f"tools/migrate_labels.py not found at {SCRIPT}"


def test_migrate_labels_raises_not_implemented_on_apply(tmp_path):
    """--apply raises NotImplementedError since mapping table is empty."""
    labels_file = tmp_path / "labels.json"
    labels_file.write_text('{"img-1": {"flags": ["no-bug"]}}')
    result = subprocess.run(
        [sys.executable, str(SCRIPT), "--apply", "--labels", str(labels_file)],
        capture_output=True, text=True, cwd=str(REPO_ROOT),
    )
    assert result.returncode != 0, "expected non-zero exit on --apply"
    combined = (result.stderr + result.stdout).lower()
    assert "notimplementederror" in combined or "not yet defined" in combined, \
        f"expected NotImplementedError mention, got: stderr={result.stderr!r} stdout={result.stdout!r}"


def test_migrate_labels_dry_run_exits_zero(tmp_path):
    """--dry-run must succeed (no rename mapping needed for dry-run)."""
    labels_file = tmp_path / "labels.json"
    labels_file.write_text('{"img-1": {"flags": ["no-bug"]}}')
    result = subprocess.run(
        [sys.executable, str(SCRIPT), "--dry-run", "--labels", str(labels_file)],
        capture_output=True, text=True, cwd=str(REPO_ROOT),
    )
    assert result.returncode == 0, f"dry-run failed: {result.stderr}"
