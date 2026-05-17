"""Remote-agent entry point for the Sketchfab enrichment job.

WHY: prod's Hetzner egress IP is bot-blocked by Akamai (Sketchfab's CDN),
so the route handler cannot call Sketchfab live. This script runs from a
non-blocked location (Windmill on a residential link / a Pi at home / a
dev box) and pushes results back to prod via authenticated admin endpoints.

DIFFERENCE FROM scripts/sketchfab_enrichment.py:
  - That script writes directly to a LOCAL SQLite. Used by local dev.
  - THIS script pulls species via HTTP from prod, queries Sketchfab from
    wherever it runs, and POSTs results back over HTTPS. No local DB.

Required environment:
    LINE_OF_BUGS_PROD_URL       base URL of prod, e.g. https://line-of-bugs.com
    LINE_OF_BUGS_ADMIN_USER     admin username (currently always "admin")
    LINE_OF_BUGS_ADMIN_PASSWORD raw admin password (matched against the hash in prod's env)
    SKETCHFAB_API_KEY           the Sketchfab Data API token

Run:
    python -m scripts.sketchfab_enrichment_remote
        [--max-age-days N]   default 1 (daily cron cadence)
        [--limit N]          partial-run cap (omit to process all)
        [--batch-size N]     species per upsert POST, default 200, max 500
        [--workers N]        concurrent Sketchfab queries, default 8

Exit codes:
    0   success (whether 1 species or 5000)
    1   network / auth failure pulling the species list
    2   classify or upsert failed in a way that's worth investigating
"""
from __future__ import annotations

import argparse
import logging
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests

# Reuse the classification + relevance heuristic from the in-repo enrichment
# script. Keeping it in one place is the only protection against the
# precache drifting from the live filter the route would use as a fallback.
from scripts.sketchfab_enrichment import classify_species, SpeciesResult

log = logging.getLogger("sketchfab_enrichment_remote")

UPSERT_MAX_BATCH = 500


def _require_env(name: str) -> str:
    val = os.environ.get(name)
    if not val:
        raise SystemExit(f"required env var {name} is unset")
    return val


def fetch_species_list(
    session: requests.Session, prod_url: str, max_age_days: int, limit: int | None
) -> list[tuple[str, str]]:
    """GET /api/admin/sketchfab/species — returns (scientific, common) pairs."""
    params: dict[str, str | int] = {"max_age_days": max_age_days}
    if limit is not None:
        params["limit"] = limit
    r = session.get(f"{prod_url}/api/admin/sketchfab/species", params=params, timeout=60)
    r.raise_for_status()
    data = r.json()
    return [(s["taxon_species"], s["common_name"]) for s in data["species"]]


def post_batch(
    session: requests.Session, prod_url: str, batch: list[dict]
) -> int:
    """POST /api/admin/sketchfab/upsert — returns the number upserted."""
    r = session.post(
        f"{prod_url}/api/admin/sketchfab/upsert",
        json={"rows": batch},
        timeout=60,
    )
    r.raise_for_status()
    return r.json().get("upserted", 0)


def result_to_row(scientific: str, result: SpeciesResult) -> dict:
    """Shape: matches the POST /upsert wire format."""
    import json
    return {
        "taxon_species": scientific,
        "has_models": bool(result.has_models),
        "hit_count": int(result.hit_count),
        "hits_json": json.dumps(result.hits) if result.has_models else None,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--max-age-days", type=int, default=1)
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--batch-size", type=int, default=200)
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument(
        "--fail-skipped-pct", type=int, default=50,
        help=("Exit non-zero if >=N%% of attempted species were skipped "
              "(rate-limited / WAF-blocked). Defaults to 50. The xyOps "
              "general-category default action turns non-zero exits into a "
              "Telegram alert, surfacing silent regressions where Sketchfab "
              "is rejecting most of our queries."),
    )
    parser.add_argument(
        "--fail-skipped-min-sample", type=int, default=100,
        help=("Minimum attempted-species count before --fail-skipped-pct is "
              "enforced. Stops smoke tests (--limit 5) from spuriously "
              "failing on a couple of unlucky 429s."),
    )
    args = parser.parse_args(argv)

    if args.batch_size < 1 or args.batch_size > UPSERT_MAX_BATCH:
        parser.error(f"--batch-size must be 1..{UPSERT_MAX_BATCH}")
    if not (0 <= args.fail_skipped_pct <= 100):
        parser.error("--fail-skipped-pct must be in 0..100")

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    prod_url = _require_env("LINE_OF_BUGS_PROD_URL").rstrip("/")
    admin_user = _require_env("LINE_OF_BUGS_ADMIN_USER")
    admin_password = _require_env("LINE_OF_BUGS_ADMIN_PASSWORD")
    sketchfab_key = _require_env("SKETCHFAB_API_KEY")

    session = requests.Session()
    session.auth = (admin_user, admin_password)

    # 1) Pull the list of species needing enrichment.
    try:
        pairs = fetch_species_list(session, prod_url, args.max_age_days, args.limit)
    except requests.HTTPError as e:
        log.error("fetch species list failed: %s (status=%d)", e, e.response.status_code if e.response is not None else -1)
        return 1
    except requests.RequestException as e:
        log.error("network error fetching species list: %s", e)
        return 1

    if not pairs:
        log.info("nothing to enrich (no stale rows + no new species)")
        return 0
    log.info("processing %d species (batch_size=%d, workers=%d)",
             len(pairs), args.batch_size, args.workers)

    # 2) Classify against Sketchfab in parallel; buffer results for batching.
    buffered: list[dict] = []
    classified = 0
    upserted_total = 0
    failures = 0
    t0 = time.time()

    def flush() -> None:
        nonlocal buffered, upserted_total
        if not buffered:
            return
        try:
            n = post_batch(session, prod_url, buffered)
            upserted_total += n
        except requests.HTTPError as e:
            status = e.response.status_code if e.response is not None else -1
            log.error("upsert batch failed (HTTP %d): %s", status, e)
            # Don't crash — keep going. The next run will retry these species
            # because their last_checked_at didn't get updated.
        except requests.RequestException as e:
            log.error("upsert batch network error: %s", e)
        buffered = []

    skipped = 0  # rate-limited species; their last_checked_at stays old
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = {ex.submit(classify_species, sci, com, sketchfab_key): (sci, com)
                for sci, com in pairs}
        for f in as_completed(futs):
            sci, com = futs[f]
            try:
                result = f.result()
            except Exception as e:
                failures += 1
                log.error("classify %r failed: %s", sci, e)
                continue
            if result.rate_limited:
                skipped += 1
                continue
            buffered.append(result_to_row(sci, result))
            classified += 1
            if len(buffered) >= args.batch_size:
                flush()
            if classified % 100 == 0:
                rate = classified / (time.time() - t0)
                log.info("  %d/%d classified, %d upserted, %d skipped (rate-limited), %.1f/s",
                         classified, len(pairs), upserted_total, skipped, rate)

    flush()

    elapsed = time.time() - t0
    log.info("done in %.1fs — %d classified, %d upserted, %d rate-limited (skipped), %d failures",
             elapsed, classified, upserted_total, skipped, failures)

    if failures > 0:
        return 2

    attempted = classified + skipped
    if attempted >= args.fail_skipped_min_sample:
        skipped_pct = 100 * skipped / attempted
        if skipped_pct >= args.fail_skipped_pct:
            log.error(
                "HIGH SKIP RATE: %d/%d (%.1f%%) species were rate-limited or "
                "WAF-blocked (threshold: %d%%). Sketchfab is rejecting most "
                "queries — investigate before next run.",
                skipped, attempted, skipped_pct, args.fail_skipped_pct,
            )
            return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
