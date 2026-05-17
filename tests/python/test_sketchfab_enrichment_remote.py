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
    main,
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


# ---------------------------------------------------------------------------
# main() exit-code gate: fail when most species got rate-limited / WAF-blocked
# ---------------------------------------------------------------------------

def _run_main_with_skip_pct(
    *, n_total: int, n_skipped: int, fail_pct: int = 50, min_sample: int = 100
) -> int:
    """Helper: stub fetch + classify so main() sees n_total species, of which
    n_skipped come back rate_limited, and return its exit code."""
    pairs = [(f"S{i}", f"c{i}") for i in range(n_total)]
    results = (
        [SpeciesResult(has_models=False, hit_count=0, hits=[], rate_limited=True)] * n_skipped
        + [SpeciesResult(has_models=True, hit_count=1, hits=[{"uid": "u", "matchedBy": "scientific"}])]
        * (n_total - n_skipped)
    )

    env = {
        "LINE_OF_BUGS_PROD_URL": "https://prod",
        "LINE_OF_BUGS_ADMIN_USER": "admin",
        "LINE_OF_BUGS_ADMIN_PASSWORD": "pw",
        "SKETCHFAB_API_KEY": "k",
    }

    with patch.dict("os.environ", env, clear=False), \
         patch("scripts.sketchfab_enrichment_remote.fetch_species_list", return_value=pairs), \
         patch("scripts.sketchfab_enrichment_remote.classify_species", side_effect=results), \
         patch("scripts.sketchfab_enrichment_remote.post_batch", return_value=n_total - n_skipped):
        return main(
            ["--max-age-days", "1",
             "--fail-skipped-pct", str(fail_pct),
             "--fail-skipped-min-sample", str(min_sample)]
        )


def test_main_exits_nonzero_when_skip_rate_exceeds_threshold():
    # 60 of 100 skipped = 60% > 50% threshold → exit 2 (triggers TG alert)
    assert _run_main_with_skip_pct(n_total=100, n_skipped=60) == 2


def test_main_exits_zero_when_skip_rate_below_threshold():
    # 30 of 100 skipped = 30% < 50% threshold → exit 0
    assert _run_main_with_skip_pct(n_total=100, n_skipped=30) == 0


def test_main_skip_threshold_ignored_for_small_samples():
    # 5 of 5 skipped = 100% but below min-sample of 10 → exit 0
    # (smoke tests with --limit 5 must not trip the gate)
    assert _run_main_with_skip_pct(n_total=5, n_skipped=5, min_sample=10) == 0


def test_main_skip_threshold_at_exactly_boundary_fails():
    # Exactly 50% with --fail-skipped-pct 50 should fail (>= comparison).
    assert _run_main_with_skip_pct(n_total=100, n_skipped=50) == 2
