"""Populate species_metadata.has_sketchfab_models + sketchfab_hits_json for
every distinct taxon_species in the images table.

The hits_json column is what the prod route handler serves from — prod's
Hetzner egress IP is bot-blocked by Akamai (Sketchfab's CDN), so the
route cannot call Sketchfab live and depends entirely on this precache.

Run: .venv/bin/python -m scripts.sketchfab_enrichment [--limit N] [--max-age-days D]

Concurrency: 8 outer workers × 2 inner (sci+common queries) = 16 in-flight
Sketchfab requests at a time. Within fair-use observed ≤70 req/s.
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


def _query(q: str, api_key: str) -> list[dict]:
    """One Sketchfab search call. Returns first-page results or []."""
    try:
        r = requests.get(
            "https://api.sketchfab.com/v3/search",
            params={"type": "models", "q": q, "count": 12},
            headers={"Authorization": f"Token {api_key}"},
            timeout=20,
        )
        if r.status_code != 200:
            log.warning("query %r → HTTP %d (treating as zero hits — cache may be poisoned)",
                        q, r.status_code)
            return []
        return r.json().get("results", []) or []
    except Exception as e:
        log.warning("query %r failed: %s", q, e)
        return []


def _is_strict_relevant(hit: dict, scientific: str, common: str) -> bool:
    text_parts = [
        hit.get("name", "") or "",
        hit.get("description", "") or "",
        " ".join(t.get("name", "") for t in hit.get("tags", [])),
        " ".join(c.get("name", "") for c in hit.get("categories", [])),
    ]
    text = " ".join(text_parts).lower()
    sci_toks = scientific.lower().split()
    if len(sci_toks) >= 2 and sci_toks[0] in text and sci_toks[-1] in text:
        return True
    com = common.lower().strip()
    if len(com.split()) >= 2 and com in text:
        return True
    if len(com.split()) == 1 and com in text:
        tag_set = {t.get("name", "").lower() for t in hit.get("tags", [])}
        cat_slugs = {c.get("slug", "") for c in hit.get("categories", [])}
        if tag_set & INSECT_HINTS or cat_slugs & INSECT_CATEGORY_SLUGS:
            return True
    return False


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
    """Run both queries in parallel; return aggregate relevance + trimmed hits."""
    with ThreadPoolExecutor(max_workers=2) as inner:
        f_sci = inner.submit(_query, scientific, api_key)
        f_com = inner.submit(_query, common, api_key)
        sci_hits = f_sci.result()
        com_hits = f_com.result()

    # uid → (raw hit, matched_by_sci, matched_by_common)
    by_uid: dict[str, tuple[dict, bool, bool]] = {}
    for h in sci_hits:
        uid = h.get("uid", "")
        if not uid:
            continue
        by_uid[uid] = (h, True, False)
    for h in com_hits:
        uid = h.get("uid", "")
        if not uid:
            continue
        if uid in by_uid:
            prev_hit, sci_f, _ = by_uid[uid]
            by_uid[uid] = (prev_hit, sci_f, True)
        else:
            by_uid[uid] = (h, False, True)

    raw = len(by_uid)
    trimmed: list[dict] = []
    for hit, sci_f, com_f in by_uid.values():
        if not _is_strict_relevant(hit, scientific, common):
            continue
        if sci_f and com_f:
            matched = "both"
        elif sci_f:
            matched = "scientific"
        else:
            matched = "common"
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
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = {ex.submit(classify_species, sci, com, api_key): (sci, com)
                for sci, com in pairs}
        for f in as_completed(futs):
            sci, com = futs[f]
            try:
                result = f.result()
                upsert_metadata(db_path, sci, result)
            except Exception as e:
                log.error("classify %r failed: %s", sci, e)
                continue
            done += 1
            if done % 100 == 0:
                log.info("  %d/%d  (%.1f/s)", done, len(pairs), done / (time.time() - t0))

    log.info("done in %.1fs — %d species processed", time.time() - t0, done)
    return 0


if __name__ == "__main__":
    sys.exit(main())
