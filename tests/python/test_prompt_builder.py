"""Tests for prompt_builder.py."""
from __future__ import annotations
import sqlite3

import pytest

from scripts.detect_subjects.prompt_builder import (
    NEGATIVE_CLASSES,
    LIFE_STAGES,
    ORDER_TO_COMMON_NAMES,
    build_insect_prompt,
)


def _make_db(tmp_path, orders):
    db = tmp_path / "test.db"
    con = sqlite3.connect(str(db))
    con.execute("CREATE TABLE images (image_id TEXT, taxon_order TEXT)")
    for i, order in enumerate(orders):
        con.execute("INSERT INTO images VALUES (?, ?)", (f"img-{i}", order))
    con.commit()
    con.close()
    return db


def test_empty_db_returns_baseline_phrases(tmp_path):
    """NEGATIVE_CLASSES intentionally excluded from SAM 3 prompt — see prompt_builder docstring."""
    db = _make_db(tmp_path, [])
    phrases, version = build_insect_prompt(db)
    expected_base = {"an insect"} | set(LIFE_STAGES)
    assert set(phrases) == expected_base
    # NEGATIVE_CLASSES still exported for UI overlay use, not in the prompt
    assert all(neg not in phrases for neg in NEGATIVE_CLASSES)
    assert len(version) == 8


def test_orders_add_common_names(tmp_path):
    db = _make_db(tmp_path, ["Coleoptera", "Lepidoptera"])
    phrases, _ = build_insect_prompt(db)
    assert "a beetle" in phrases
    assert "a butterfly" in phrases
    assert "a moth" in phrases


def test_unmatched_order_warns_but_continues(tmp_path, capsys):
    db = _make_db(tmp_path, ["Coleoptera", "FakeOrder"])
    phrases, _ = build_insect_prompt(db)
    assert "a beetle" in phrases
    captured = capsys.readouterr()
    assert "FakeOrder" in captured.err


def test_version_hash_stable(tmp_path):
    db = _make_db(tmp_path, ["Coleoptera"])
    phrases1, v1 = build_insect_prompt(db)
    phrases2, v2 = build_insect_prompt(db)
    assert v1 == v2
    assert phrases1 == phrases2


def test_version_changes_when_orders_change(tmp_path):
    db1 = _make_db(tmp_path, ["Coleoptera"])
    sub = tmp_path / "sub"
    sub.mkdir()
    db2 = _make_db(sub, ["Coleoptera", "Lepidoptera"])
    _, v1 = build_insect_prompt(db1)
    _, v2 = build_insect_prompt(db2)
    assert v1 != v2
