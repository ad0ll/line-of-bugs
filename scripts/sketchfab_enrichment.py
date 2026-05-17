"""Populate species_metadata.has_sketchfab_models for every distinct
taxon_species in the images table.

Run: .venv/bin/python -m scripts.sketchfab_enrichment [--limit N] [--max-age-days D]

Concurrency: 8 workers, well within Sketchfab fair-use.
"""
from __future__ import annotations

import argparse
import logging
import sqlite3
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[1]
ENV_PATH = ROOT / ".env.local"
DEFAULT_DB = ROOT / "data" / "db" / "line-of-bugs.db"

log = logging.getLogger("sketchfab_enrichment")

INSECT_HINTS = {
    "insect", "insects", "insecta", "bug", "bugs", "beetle", "butterfly",
    "moth", "bee", "wasp", "ant", "spider", "fly", "grasshopper", "cricket", "mantis",
    "ladybug", "ladybird", "weevil", "dragonfly", "caterpillar", "entomology",
    "arthropod", "arthropoda", "pollinator", "pollinators",
}
INSECT_CATEGORY_SLUGS = {"animals-pets", "nature-plants"}


@dataclass
class SpeciesResult:
    has_models: bool
    hit_count: int  # raw, pre-filter


def _load_api_key() -> str:
    for line in ENV_PATH.read_text().splitlines():
        if line.startswith("SKETCHFAB_API_KEY="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise SystemExit("SKETCHFAB_API_KEY missing from .env.local")


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


def classify_species(scientific: str, common: str, api_key: str) -> SpeciesResult:
    """Run both queries (in parallel); return aggregate relevance + raw hit count."""
    with ThreadPoolExecutor(max_workers=2) as inner:
        f_sci = inner.submit(_query, scientific, api_key)
        f_com = inner.submit(_query, common, api_key)
        sci_hits = f_sci.result()
        com_hits = f_com.result()
    seen_uids: set[str] = set()
    raw = 0
    relevant = 0
    for h in (*sci_hits, *com_hits):
        uid = h.get("uid", "")
        if uid in seen_uids:
            continue
        seen_uids.add(uid)
        raw += 1
        if _is_strict_relevant(h, scientific, common):
            relevant += 1
    return SpeciesResult(has_models=relevant > 0, hit_count=raw)


def upsert_metadata(db_path: Path, taxon_species: str, result: SpeciesResult) -> None:
    now = int(time.time())
    with sqlite3.connect(db_path) as conn:
        conn.execute(
            """INSERT INTO species_metadata
                 (taxon_species, has_sketchfab_models, sketchfab_hit_count,
                  sketchfab_last_checked_at)
               VALUES (?, ?, ?, ?)
               ON CONFLICT(taxon_species) DO UPDATE SET
                 has_sketchfab_models = excluded.has_sketchfab_models,
                 sketchfab_hit_count = excluded.sketchfab_hit_count,
                 sketchfab_last_checked_at = excluded.sketchfab_last_checked_at""",
            (taxon_species, 1 if result.has_models else 0, result.hit_count, now),
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
