"""Unit tests for sketchfab_enrichment — mocks HTTP, asserts UPSERT shape."""
from __future__ import annotations

import sqlite3
import tempfile
from pathlib import Path
from unittest.mock import patch

from scripts.sketchfab_enrichment import (
    classify_species,
    upsert_metadata,
    SpeciesResult,
)


def _make_db(path: Path) -> None:
    conn = sqlite3.connect(path)
    conn.execute(
        """CREATE TABLE species_metadata (
              taxon_species TEXT PRIMARY KEY,
              has_sketchfab_models INTEGER,
              sketchfab_hit_count INTEGER,
              sketchfab_last_checked_at INTEGER
           )"""
    )
    conn.commit()
    conn.close()


def test_classify_returns_true_when_any_strict_relevant_hit():
    fake_results = [
        {"uid": "u1", "name": "Apis mellifera",
         "tags": [{"name": "insect"}],
         "categories": [{"slug": "animals-pets"}]}
    ]
    with patch("scripts.sketchfab_enrichment._query") as mock_q:
        mock_q.return_value = fake_results
        result = classify_species("Apis mellifera", "honey bee", api_key="k")
    assert isinstance(result, SpeciesResult)
    assert result.has_models is True
    assert result.hit_count == 1


def test_classify_returns_false_when_no_relevant_hit():
    with patch("scripts.sketchfab_enrichment._query") as mock_q:
        mock_q.return_value = []
        result = classify_species("Nonexistus speciosus", "fake bug", api_key="k")
    assert result.has_models is False
    assert result.hit_count == 0


def test_classify_returns_false_when_only_irrelevant_hits():
    irrelevant = [{"uid": "n", "name": "Bread", "tags": [{"name": "food"}],
                   "categories": [{"slug": "food-drink"}]}]
    with patch("scripts.sketchfab_enrichment._query") as mock_q:
        mock_q.return_value = irrelevant
        result = classify_species("Vanessa itea", "Yellow Admiral", api_key="k")
    assert result.has_models is False
    assert result.hit_count == 1   # raw hit count includes filtered


def test_upsert_metadata_writes_and_updates():
    with tempfile.TemporaryDirectory() as td:
        db = Path(td) / "t.db"
        _make_db(db)
        upsert_metadata(db, "Apis mellifera",
                        SpeciesResult(has_models=True, hit_count=5))
        upsert_metadata(db, "Apis mellifera",
                        SpeciesResult(has_models=False, hit_count=0))
        with sqlite3.connect(db) as conn:
            row = conn.execute(
                "SELECT has_sketchfab_models, sketchfab_hit_count "
                "FROM species_metadata WHERE taxon_species = ?",
                ("Apis mellifera",),
            ).fetchone()
        assert row == (0, 0)
