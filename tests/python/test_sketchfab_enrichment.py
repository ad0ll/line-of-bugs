"""Unit tests for sketchfab_enrichment — mocks HTTP, asserts UPSERT shape."""
from __future__ import annotations

import sqlite3
import tempfile
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from scripts.sketchfab_enrichment import (
    classify_species,
    upsert_metadata,
    RateLimitedError,
    SpeciesResult,
    _query,
)


def _make_db(path: Path) -> None:
    conn = sqlite3.connect(path)
    conn.execute(
        """CREATE TABLE species_metadata (
              taxon_species TEXT PRIMARY KEY,
              has_sketchfab_models INTEGER,
              sketchfab_hit_count INTEGER,
              sketchfab_last_checked_at INTEGER,
              sketchfab_hits_json TEXT
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
        # First write with hits — populates hits_json
        upsert_metadata(
            db, "Apis mellifera",
            SpeciesResult(has_models=True, hit_count=5,
                          hits=[{"uid": "u1", "name": "Bee", "matchedBy": "scientific"}]),
        )
        # Second write with no hits — clears hits_json to NULL
        upsert_metadata(
            db, "Apis mellifera",
            SpeciesResult(has_models=False, hit_count=0, hits=[]),
        )
        with sqlite3.connect(db) as conn:
            row = conn.execute(
                "SELECT has_sketchfab_models, sketchfab_hit_count, sketchfab_hits_json "
                "FROM species_metadata WHERE taxon_species = ?",
                ("Apis mellifera",),
            ).fetchone()
        assert row == (0, 0, None)


def test_upsert_metadata_persists_hits_json():
    with tempfile.TemporaryDirectory() as td:
        db = Path(td) / "t.db"
        _make_db(db)
        hits = [
            {"uid": "u1", "name": "Bee", "matchedBy": "both"},
            {"uid": "u2", "name": "Bee 2", "matchedBy": "scientific"},
        ]
        upsert_metadata(
            db, "Apis mellifera",
            SpeciesResult(has_models=True, hit_count=2, hits=hits),
        )
        with sqlite3.connect(db) as conn:
            row = conn.execute(
                "SELECT sketchfab_hits_json FROM species_metadata WHERE taxon_species = ?",
                ("Apis mellifera",),
            ).fetchone()
        import json
        assert json.loads(row[0]) == hits


def test_classify_trims_and_sorts_hits():
    # Single combined query returns 2 hits. matchedBy is derived from each
    # hit's text content against the scientific tokens and the common name.
    sci_only = {
        "uid": "sci",
        "name": "Apis mellifera scan",
        "tags": [{"name": "insect"}],
        "categories": [{"slug": "animals-pets"}],
        "user": {"username": "etain", "displayName": "ETAIN"},
        "thumbnails": {"images": [
            {"width": 256, "height": 144, "url": "https://t/256"},
            {"width": 1024, "height": 576, "url": "https://t/1024"},
        ]},
        "viewerUrl": "https://sketchfab.com/3d-models/sci",
        "license": {"slug": "by"},
    }
    # Text mentions both the scientific name AND the common name → "both".
    in_both = {
        "uid": "both",
        "name": "Apis mellifera honey bee",
        "tags": [{"name": "bee"}],
        "categories": [{"slug": "animals-pets"}],
        "user": {"username": "modeler"},
        "thumbnails": {"images": [{"width": 256, "height": 144, "url": "https://t/b256"}]},
        "viewerUrl": "https://sketchfab.com/3d-models/both",
        "license": None,
    }
    with patch("scripts.sketchfab_enrichment._query") as mock_q:
        mock_q.return_value = [sci_only, in_both]
        result = classify_species("Apis mellifera", "honey bee", api_key="k")
    # Combined query called exactly once with both terms joined.
    assert mock_q.call_count == 1
    assert mock_q.call_args.args[0] == "Apis mellifera honey bee"
    assert result.has_models is True
    assert result.hit_count == 2
    # 'both' must sort first (strongest signal), then 'scientific'
    assert [h["uid"] for h in result.hits] == ["both", "sci"]
    # First-tier fields are present + trimmed correctly
    assert result.hits[0]["matchedBy"] == "both"
    assert result.hits[1]["matchedBy"] == "scientific"
    assert result.hits[1]["thumbnailUrl"] == "https://t/256"  # 256-tier picked
    assert result.hits[1]["author"] == "ETAIN"  # displayName preferred
    assert result.hits[1]["authorUsername"] == "etain"
    assert result.hits[0]["licenseSlug"] is None  # license: None case
    assert result.hits[1]["licenseSlug"] == "by"


@pytest.mark.parametrize("status", [400, 401, 403, 404, 405, 408, 421, 429, 500, 502, 503, 504])
def test_query_raises_rate_limited_on_any_non_200(status):
    """Fail-closed: ANY non-200 → RateLimitedError → species skipped.
    Enumerating "known transient" codes (the old approach) cache-poisoned
    2300 species when 405 wasn't in the list. Anything that isn't a clean
    200 must skip, regardless of code."""
    fake_resp = MagicMock(status_code=status)
    with patch("scripts.sketchfab_enrichment.requests.get", return_value=fake_resp):
        with pytest.raises(RateLimitedError):
            _query("Apis mellifera", api_key="k")


def test_query_raises_rate_limited_on_network_exception():
    """Connection timeouts / DNS failures / TLS errors must also skip,
    not silently return []."""
    import requests as _req
    with patch(
        "scripts.sketchfab_enrichment.requests.get",
        side_effect=_req.exceptions.ConnectTimeout("boom"),
    ):
        with pytest.raises(RateLimitedError):
            _query("Apis mellifera", api_key="k")


def test_query_raises_rate_limited_on_non_json_200():
    """A 200 with an unparseable body is also a non-answer — skip."""
    fake_resp = MagicMock(status_code=200)
    fake_resp.json.side_effect = ValueError("not JSON")
    with patch("scripts.sketchfab_enrichment.requests.get", return_value=fake_resp):
        with pytest.raises(RateLimitedError):
            _query("Apis mellifera", api_key="k")


def test_query_200_empty_results_returns_empty_list():
    """The only path that returns [] is a clean 200 with results=[] — that's
    Sketchfab honestly saying "no models". The caller upserts has_models=False
    for this case, which is correct."""
    fake_resp = MagicMock(status_code=200)
    fake_resp.json.return_value = {"results": []}
    with patch("scripts.sketchfab_enrichment.requests.get", return_value=fake_resp):
        assert _query("Apis mellifera", api_key="k") == []


def test_classify_species_skips_on_rate_limit():
    with patch("scripts.sketchfab_enrichment._query",
               side_effect=RateLimitedError("HTTP 429", status=429)):
        result = classify_species("Apis mellifera", "honey bee", api_key="k")
    assert result.rate_limited is True
    assert result.has_models is False
    assert result.hit_count == 0
    assert result.hits == []
    assert result.skip_status == 429


def test_rate_limited_error_carries_status():
    e = RateLimitedError("HTTP 429", status=429)
    assert e.status == 429
    # network/parse exceptions have no HTTP status — must still work
    e2 = RateLimitedError("network error: timeout")
    assert e2.status is None


@pytest.mark.parametrize("status", [405, 429, 500])
def test_query_attaches_status_to_raised_error(status):
    fake_resp = MagicMock(status_code=status)
    fake_resp.text = '{"detail":"test"}'
    fake_resp.headers = {}
    with patch("scripts.sketchfab_enrichment.requests.get", return_value=fake_resp):
        try:
            _query("Apis mellifera", api_key="k")
        except RateLimitedError as e:
            assert e.status == status
        else:
            raise AssertionError("expected RateLimitedError")
