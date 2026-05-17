"""Tests for scripts.sketchfab_enrichment_remote — the remote-agent script.

Focus on the HTTP helpers + result-shaping. main() is end-to-end glue that's
exercised in real runs from Windmill.
"""
from __future__ import annotations

import json
from unittest.mock import MagicMock, patch

from scripts.sketchfab_enrichment import SpeciesResult
from scripts.sketchfab_enrichment_remote import (
    fetch_species_list,
    post_batch,
    result_to_row,
)


def test_fetch_species_list_parses_response():
    session = MagicMock()
    session.get.return_value.json.return_value = {
        "species": [
            {"taxon_species": "Apis mellifera", "common_name": "honey bee", "last_checked_at": None},
            {"taxon_species": "Bombus impatiens", "common_name": "bumble bee", "last_checked_at": 12345},
        ],
        "count": 2,
    }
    session.get.return_value.raise_for_status = lambda: None

    pairs = fetch_species_list(session, "https://prod", max_age_days=1, limit=None)
    assert pairs == [
        ("Apis mellifera", "honey bee"),
        ("Bombus impatiens", "bumble bee"),
    ]
    session.get.assert_called_once_with(
        "https://prod/api/admin/sketchfab/species",
        params={"max_age_days": 1},
        timeout=60,
    )


def test_fetch_species_list_passes_limit_when_provided():
    session = MagicMock()
    session.get.return_value.json.return_value = {"species": [], "count": 0}
    session.get.return_value.raise_for_status = lambda: None

    fetch_species_list(session, "https://prod", max_age_days=7, limit=50)
    session.get.assert_called_once_with(
        "https://prod/api/admin/sketchfab/species",
        params={"max_age_days": 7, "limit": 50},
        timeout=60,
    )


def test_post_batch_sends_rows_and_returns_count():
    session = MagicMock()
    session.post.return_value.json.return_value = {"upserted": 3}
    session.post.return_value.raise_for_status = lambda: None

    batch = [
        {"taxon_species": "S1", "has_models": True, "hit_count": 5, "hits_json": "[]"},
        {"taxon_species": "S2", "has_models": False, "hit_count": 0, "hits_json": None},
        {"taxon_species": "S3", "has_models": True, "hit_count": 1, "hits_json": "[]"},
    ]
    n = post_batch(session, "https://prod", batch)
    assert n == 3
    session.post.assert_called_once_with(
        "https://prod/api/admin/sketchfab/upsert",
        json={"rows": batch},
        timeout=60,
    )


def test_result_to_row_has_models_includes_hits_json():
    hits = [{"uid": "u1", "name": "Bee", "matchedBy": "both"}]
    row = result_to_row("Apis mellifera", SpeciesResult(has_models=True, hit_count=2, hits=hits))
    assert row == {
        "taxon_species": "Apis mellifera",
        "has_models": True,
        "hit_count": 2,
        "hits_json": json.dumps(hits),
    }


def test_result_to_row_no_models_sets_hits_json_null():
    row = result_to_row(
        "Nonexistus speciosus",
        SpeciesResult(has_models=False, hit_count=3, hits=[]),
    )
    assert row["hits_json"] is None
    assert row["has_models"] is False
    assert row["hit_count"] == 3
