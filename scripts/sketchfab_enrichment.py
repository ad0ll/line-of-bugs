"""Populate species_metadata.has_sketchfab_models + sketchfab_hits_json for
every distinct taxon_species in the images table.

The hits_json column is what the prod route handler serves from — prod's
Hetzner egress IP is rate-limited by Sketchfab's CDN (CloudFront), so the
route cannot call Sketchfab live and depends entirely on this precache.

Run: .venv/bin/python -m scripts.sketchfab_enrichment [--limit N] [--max-age-days D]

Each species costs ONE Sketchfab request — `q="<scientific> <common>"`
with count=24. The combined query returns models scoring high on either
axis; `matchedBy` is computed per-hit from the model's text (name +
description + tags + categories), not from which query returned it.
At --workers=8 that's 8 in-flight requests, half the prior 16.
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import sqlite3
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[1]
# Local dev uses .env.local; the prod deploy symlinks .env -> shared/.env
# inside each release. SKETCHFAB_API_KEY env var also wins if set.
ENV_PATHS = [ROOT / ".env.local", ROOT / ".env"]
DEFAULT_DB = ROOT / "data" / "db" / "line-of-bugs.db"

log = logging.getLogger("sketchfab_enrichment")

INSECT_HINTS = {
    "insect", "insects", "insecta", "bug", "bugs", "beetle", "butterfly",
    "moth", "bee", "wasp", "ant", "spider", "fly", "grasshopper", "cricket", "mantis",
    "ladybug", "ladybird", "weevil", "dragonfly", "caterpillar", "entomology",
    "arthropod", "arthropoda", "pollinator", "pollinators",
}
INSECT_CATEGORY_SLUGS = {"animals-pets", "nature-plants"}

# Mirrors the TS `SketchfabHit` shape in lib/sketchfab/types.ts. Stored
# inside species_metadata.sketchfab_hits_json so the route can ship them
# straight to the UI without re-shaping.
_RANK = {"both": 0, "scientific": 1, "common": 2}


@dataclass
class SpeciesResult:
    has_models: bool
    hit_count: int  # raw, pre-filter
    hits: list[dict] = field(default_factory=list)  # trimmed, post-filter, sorted
    # True when the Sketchfab query hit a non-200 / non-answer. Callers
    # MUST NOT upsert — last_checked_at stays old so the next run retries
    # instead of poisoning the cache with a false negative.
    rate_limited: bool = False
    # HTTP status code (or None for network/parse exceptions) that caused
    # the skip. Surfaced so the runner can build a status-code histogram
    # and identify when burst budget is exhausted vs. a real outage.
    skip_status: int | None = None


def _load_api_key() -> str:
    env_key = os.environ.get("SKETCHFAB_API_KEY")
    if env_key:
        return env_key.strip()
    for path in ENV_PATHS:
        if not path.exists():
            continue
        for line in path.read_text().splitlines():
            if line.startswith("SKETCHFAB_API_KEY="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise SystemExit(
        f"SKETCHFAB_API_KEY not set in env or any of {[str(p) for p in ENV_PATHS]}",
    )


class RateLimitedError(Exception):
    """Raised whenever Sketchfab failed to give us a real answer — any non-200
    HTTP status, any network/parse exception. The caller MUST skip the
    species rather than upserting `has_models=False` from a non-answer.

    Known shapes observed in the wild (Sketchfab fronts on CloudFront, origin
    is gunicorn):
      - 429 with body `{"detail":"Too many requests."}` — origin rate-limit.
              Verified 2026-05-18 via probe (verbose response capture).
      - 408 with body `{}` — `x-cache: Error from cloudfront`, origin-fetch
              timeout, response synthesized at CloudFront edge.
      - 405 — observed in production runs alongside 429s; body content not
              yet captured cleanly. Hypothesis pending: may be the same
              origin-throttle expressed differently for certain request
              shapes, OR a parallel CloudFront-edge response. The verbose
              `_query` warning now captures the body + cf headers so we
              can resolve this next time it appears in a real run.

    The .status attribute carries the HTTP code (or None for network/parse
    exceptions) so the runner can build a per-status histogram.
    """

    def __init__(self, msg: str, status: int | None = None) -> None:
        super().__init__(msg)
        self.status = status


def _query(q: str, api_key: str, count: int = 24) -> list[dict]:
    """One Sketchfab search call. Returns first-page results, or [] when
    Sketchfab gave us a real 200 response saying "no models match" — which
    is the ONLY way the caller is allowed to mark `has_models=False`.

    Any non-200 status OR any exception → RateLimitedError. The caller skips
    the species so last_checked_at stays old and the next run retries.
    This is deliberately defensive — enumerating "transient" status codes
    one-by-one (the prior approach) cache-poisoned 2300 species when
    Sketchfab started returning HTTP 405 on multi-word queries, because
    405 wasn't in the allowlist. Fail-closed eliminates that entire bug
    class — only a clean 200 with parsed JSON is allowed to write a row.
    """
    try:
        r = requests.get(
            "https://api.sketchfab.com/v3/search",
            params={"type": "models", "q": q, "count": count},
            headers={"Authorization": f"Token {api_key}"},
            timeout=20,
        )
    except Exception as e:
        log.warning("query %r request failed: %s (skipping)", q, e)
        raise RateLimitedError(f"network error: {e}") from e

    if r.status_code != 200:
        # Capture the full Sketchfab response, not just a preview, so we never
        # need to re-run a probe to figure out what was different about this
        # failure. cf-id uniquely identifies a CloudFront edge response —
        # Sketchfab support can look up the request if asked. Headers other
        # than the noisy CSP-report-only one go in verbatim; body capped at
        # 1024 chars (Sketchfab error bodies are tiny JSON in practice).
        headers_for_log = {
            k: v for k, v in r.headers.items()
            if k.lower() != "content-security-policy-report-only"
        }
        body_capture = (r.text or "")[:1024].replace("\n", " ").replace("\r", " ")
        log.warning(
            "query %r → HTTP %d headers=%s body=%r",
            q, r.status_code, headers_for_log, body_capture,
        )
        raise RateLimitedError(f"HTTP {r.status_code}", status=r.status_code)

    try:
        return r.json().get("results", []) or []
    except Exception as e:
        log.warning("query %r → 200 but non-JSON / unparseable: %s (skipping)", q, e)
        raise RateLimitedError(f"parse error: {e}") from e


def _classify_match(hit: dict, scientific: str, common: str) -> str | None:
    """Return 'both' / 'scientific' / 'common' / None per the same text rules
    `_is_strict_relevant` used. Now derived from the model's text rather than
    which query returned it, because we only fire one combined query.
    """
    text_parts = [
        hit.get("name", "") or "",
        hit.get("description", "") or "",
        " ".join(t.get("name", "") for t in hit.get("tags", [])),
        " ".join(c.get("name", "") for c in hit.get("categories", [])),
    ]
    text = " ".join(text_parts).lower()

    sci_toks = scientific.lower().split()
    sci_match = (
        len(sci_toks) >= 2 and sci_toks[0] in text and sci_toks[-1] in text
    )

    com = common.lower().strip()
    com_words = com.split()
    com_match = False
    if len(com_words) >= 2 and com in text:
        com_match = True
    elif len(com_words) == 1 and com in text:
        tag_set = {t.get("name", "").lower() for t in hit.get("tags", [])}
        cat_slugs = {c.get("slug", "") for c in hit.get("categories", [])}
        if tag_set & INSECT_HINTS or cat_slugs & INSECT_CATEGORY_SLUGS:
            com_match = True

    if sci_match and com_match:
        return "both"
    if sci_match:
        return "scientific"
    if com_match:
        return "common"
    return None


def _pick_thumbnail(hit: dict) -> str:
    """256x144 if available, else the smallest tier. Mirrors TS pickThumbnail."""
    imgs = (hit.get("thumbnails") or {}).get("images") or []
    for img in imgs:
        if img.get("width") == 256:
            return img.get("url", "")
    if not imgs:
        return ""
    return sorted(imgs, key=lambda i: i.get("width", 0))[0].get("url", "")


def _trim_hit(hit: dict, matched_by: str) -> dict:
    """Trim a raw Sketchfab hit down to the SketchfabHit shape stored in the cache."""
    user = hit.get("user") or {}
    license_ = hit.get("license") or {}
    return {
        "uid": hit.get("uid", ""),
        "name": hit.get("name", "") or "",
        "author": user.get("displayName") or user.get("username") or "",
        "authorUsername": user.get("username", "") or "",
        "thumbnailUrl": _pick_thumbnail(hit),
        "viewerUrl": hit.get("viewerUrl", "") or "",
        "licenseSlug": license_.get("slug") if isinstance(license_, dict) else None,
        "matchedBy": matched_by,
    }


def classify_species(scientific: str, common: str, api_key: str) -> SpeciesResult:
    """Fire ONE combined Sketchfab query and classify hits by text content.

    The combined query `q="<scientific> <common>"` returns up to 24 models
    ranked by overall keyword relevance. We then independently check each
    hit's text against the scientific tokens and the common name to derive
    `matchedBy` — same semantic as before, just sourced from the hit text
    instead of which sub-query returned it.

    On a transient Sketchfab failure (rate-limit, CDN origin timeout),
    returns rate_limited=True with empty hits — the caller should skip the
    upsert so last_checked_at stays old and the next run retries.
    """
    q = " ".join(part for part in (scientific.strip(), common.strip()) if part)
    try:
        hits = _query(q, api_key, count=24)
    except RateLimitedError as e:
        return SpeciesResult(has_models=False, hit_count=0, hits=[], rate_limited=True, skip_status=e.status)

    # Dedupe by uid — Sketchfab shouldn't return dupes on a single page but
    # be defensive. First occurrence wins (rank order is preserved).
    by_uid: dict[str, dict] = {}
    for h in hits:
        uid = h.get("uid", "")
        if not uid:
            continue
        by_uid.setdefault(uid, h)

    raw = len(by_uid)
    trimmed: list[dict] = []
    for hit in by_uid.values():
        matched = _classify_match(hit, scientific, common)
        if matched is None:
            continue
        trimmed.append(_trim_hit(hit, matched))

    # Stable ordering: both first (strongest signal), then scientific, then common.
    trimmed.sort(key=lambda h: _RANK[h["matchedBy"]])

    return SpeciesResult(has_models=len(trimmed) > 0, hit_count=raw, hits=trimmed)


def upsert_metadata(db_path: Path, taxon_species: str, result: SpeciesResult) -> None:
    now = int(time.time())
    # NULL hits_json when has_models is false — keeps "no data" semantic clean.
    hits_json = json.dumps(result.hits) if result.has_models else None
    with sqlite3.connect(db_path) as conn:
        conn.execute(
            """INSERT INTO species_metadata
                 (taxon_species, has_sketchfab_models, sketchfab_hit_count,
                  sketchfab_hits_json, sketchfab_last_checked_at)
               VALUES (?, ?, ?, ?, ?)
               ON CONFLICT(taxon_species) DO UPDATE SET
                 has_sketchfab_models = excluded.has_sketchfab_models,
                 sketchfab_hit_count = excluded.sketchfab_hit_count,
                 sketchfab_hits_json = excluded.sketchfab_hits_json,
                 sketchfab_last_checked_at = excluded.sketchfab_last_checked_at""",
            (taxon_species, 1 if result.has_models else 0, result.hit_count,
             hits_json, now),
        )


def _list_species(db_path: Path, max_age_days: int, limit: int | None) -> list[tuple[str, str]]:
    """Return (scientific, common) pairs that need (re)checking."""
    cutoff = int(time.time()) - max_age_days * 86400
    with sqlite3.connect(db_path) as conn:
        sql = """
            SELECT DISTINCT i.taxon_species, i.common_name
            FROM images i
            LEFT JOIN species_metadata sm ON sm.taxon_species = i.taxon_species
            WHERE i.taxon_species IS NOT NULL
              AND i.common_name IS NOT NULL
              AND TRIM(i.taxon_species) <> ''
              AND TRIM(i.common_name) <> ''
              AND (sm.sketchfab_last_checked_at IS NULL
                   OR sm.sketchfab_last_checked_at < ?)
        """
        params: list = [cutoff]
        if limit is not None:
            sql += " LIMIT ?"
            params.append(limit)
        return [(r[0], r[1]) for r in conn.execute(sql, params).fetchall()]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", default=str(DEFAULT_DB), help="SQLite db path")
    parser.add_argument("--limit", type=int, default=None, help="cap species processed")
    parser.add_argument("--max-age-days", type=int, default=1,
                        help="skip species checked within this window (default 1 = daily cron)")
    parser.add_argument("--workers", type=int, default=8)
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    api_key = _load_api_key()
    db_path = Path(args.db)

    pairs = _list_species(db_path, args.max_age_days, args.limit)
    log.info("processing %d species", len(pairs))
    t0 = time.time()

    done = 0
    skipped = 0
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = {ex.submit(classify_species, sci, com, api_key): (sci, com)
                for sci, com in pairs}
        for f in as_completed(futs):
            sci, com = futs[f]
            try:
                result = f.result()
            except Exception as e:
                log.error("classify %r failed: %s", sci, e)
                continue
            if result.rate_limited:
                skipped += 1
                continue
            try:
                upsert_metadata(db_path, sci, result)
            except Exception as e:
                log.error("upsert %r failed: %s", sci, e)
                continue
            done += 1
            if done % 100 == 0:
                log.info("  %d/%d  (%.1f/s, %d skipped)",
                         done, len(pairs), done / (time.time() - t0), skipped)

    log.info("done in %.1fs — %d processed, %d skipped (rate-limited; retry next run)",
             time.time() - t0, done, skipped)
    return 0


if __name__ == "__main__":
    sys.exit(main())
