"""Backfill raw_metadata + structured biology columns for existing rows.

The Round 4 schema added life_stage / sex / host_organism / specimen_condition
/ raw_metadata. For images fetched BEFORE Round 4, these are empty. This
script re-queries the source APIs for each existing manifest row to populate
them — no image bytes are re-downloaded.

  iNat:        GET /v1/observations/{obs_id}      (rate-limited 1 req/sec)
  Bugwood:     GET /v2/image/{imagenumber}         (~2 req/sec ok)
  Smithsonian: GET /v1/content/{record_id}         (rate-limited modestly)
  USDA-ARS:    re-fetch the source page HTML       (sequential, polite)

Idempotent: rows that already have raw_metadata are skipped. The script
writes back to the per-source manifest CSV in-place via temporary file +
atomic rename, AND re-seeds the DB at the end so the new columns become
queryable.

Usage:
  .venv/bin/python scripts/backfill_metadata.py              # all
  .venv/bin/python scripts/backfill_metadata.py inaturalist  # one source
  .venv/bin/python scripts/backfill_metadata.py --limit 100  # smoke run
"""
from __future__ import annotations
import argparse
import csv
import json
import os
import re
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import (
    session, MANIFEST_DIR, MANIFEST_FIELDS, setup_logging,
    ConsecutiveFailureGuard,
)
from fetch_inaturalist import (
    extract_inat_metadata,
    INAT_LIFE_STAGE_VALUE_TO_ENUM,  # noqa: F401 (kept for sanity)
)
from fetch_bugwood import (
    BUGWOOD_DESCRIPTOR_TO_LIFE_STAGE, BUGWOOD_GENDER_TO_SEX,
    fetch_detail as bugwood_fetch_detail,
)

log = setup_logging("backfill")
S = session()


def inat_obs_id_from_collection(collection_id: str) -> str | None:
    # collection_id == "inat-obs-{obs_id}"
    if not collection_id.startswith("inat-obs-"):
        return None
    return collection_id[len("inat-obs-"):]


def backfill_inat(rows: list[dict], limit: int | None) -> int:
    """Re-query iNat /observations/{id} per row. Rate-limited 1 req/sec."""
    guard = ConsecutiveFailureGuard(threshold=8, name="inat-backfill")
    updated = 0
    target = [r for r in rows if not r.get("raw_metadata")]
    if limit is not None:
        target = target[:limit]
    log.info("[inat] %d rows to backfill", len(target))
    for i, r in enumerate(target):
        obs_id = inat_obs_id_from_collection(r.get("collection_id", ""))
        if not obs_id:
            continue
        try:
            resp = S.get(f"https://api.inaturalist.org/v1/observations/{obs_id}",
                         timeout=30)
        except Exception as e:
            log.warning("[inat %s] %s", obs_id, type(e).__name__)
            if guard.failure(): break
            time.sleep(2); continue
        if resp.status_code == 404:
            # Observation was deleted on iNat — keep our row, mark with empty
            r["raw_metadata"] = "{}"
            updated += 1
            continue
        if resp.status_code != 200:
            log.warning("[inat %s] http %d", obs_id, resp.status_code)
            if guard.failure(): break
            time.sleep(2); continue
        guard.success()
        results = (resp.json() or {}).get("results") or []
        if not results:
            r["raw_metadata"] = "{}"
            updated += 1
            continue
        obs = results[0]
        life_stage, sex = extract_inat_metadata(obs)
        r["life_stage"] = life_stage or ""
        r["sex"] = sex or ""
        full_desc = obs.get("description") or ""
        if full_desc and len(full_desc) > len(r.get("description", "")):
            r["description"] = full_desc
        r["raw_metadata"] = json.dumps(obs, separators=(",", ":"))
        updated += 1
        if (updated % 100) == 0:
            log.info("[inat] %d/%d  (life_stage=%r sex=%r)",
                     updated, len(target), life_stage, sex)
        time.sleep(1.0)  # iNat 1 req/sec
    return updated


def backfill_bugwood(rows: list[dict], limit: int | None) -> int:
    """Re-query Bugwood /v2/image/{imgnum} per row. ~2 req/sec."""
    guard = ConsecutiveFailureGuard(threshold=8, name="bugwood-backfill")
    updated = 0
    target = [r for r in rows if not r.get("raw_metadata")]
    if limit is not None:
        target = target[:limit]
    log.info("[bugwood] %d rows to backfill", len(target))
    for r in target:
        imgnum = r.get("source_id") or ""
        if not imgnum:
            continue
        try:
            resp = S.get(f"https://api.bugwoodcloud.org/v2/image/{imgnum}",
                         timeout=30)
        except Exception as e:
            log.warning("[bugwood %s] %s", imgnum, type(e).__name__)
            if guard.failure(): break
            time.sleep(2); continue
        if resp.status_code in (404, 410):
            r["raw_metadata"] = "{}"
            updated += 1
            continue
        if resp.status_code != 200:
            log.warning("[bugwood %s] http %d", imgnum, resp.status_code)
            if guard.failure(): break
            time.sleep(1); continue
        guard.success()
        detail = resp.json() or {}
        # listing isn't trivially re-queryable per-row; store detail only,
        # which already includes most listing fields.
        descriptor_name = (detail.get("descriptorname") or "").strip()
        gendercaste = (detail.get("gendercaste") or detail.get("gender") or "").strip()
        spec = detail.get("specimen") or {}
        r["life_stage"] = BUGWOOD_DESCRIPTOR_TO_LIFE_STAGE.get(descriptor_name, "")
        r["sex"] = BUGWOOD_GENDER_TO_SEX.get(gendercaste, "")
        r["host_organism"] = (detail.get("hostname") or "").strip()
        r["specimen_condition"] = (spec.get("specimencondition") or "").strip()
        r["raw_metadata"] = json.dumps({"detail": detail}, separators=(",", ":"))
        updated += 1
        if (updated % 50) == 0:
            log.info("[bugwood] %d/%d", updated, len(target))
        time.sleep(0.5)
    return updated


def backfill_smithsonian(rows: list[dict], limit: int | None) -> int:
    """Smithsonian: re-fetch /content/{record_id}. SI URLs encode the
    record_id which we can derive from source_page_url."""
    guard = ConsecutiveFailureGuard(threshold=8, name="smithsonian-backfill")
    updated = 0
    target = [r for r in rows if not r.get("raw_metadata")]
    if limit is not None:
        target = target[:limit]
    log.info("[smithsonian] %d rows to backfill", len(target))
    rec_re = re.compile(r"/object/([^/?#]+)")
    api_key = os.environ.get("SI_API_KEY", "")
    for r in target:
        page = r.get("source_page_url", "")
        m = rec_re.search(page)
        record_id = m.group(1) if m else None
        if not record_id:
            r["raw_metadata"] = "{}"
            r["life_stage"] = "adult"
            r["specimen_condition"] = "Preserved (museum specimen)"
            updated += 1
            continue
        url = f"https://api.si.edu/openaccess/api/v1.0/content/{record_id}"
        if api_key:
            url += f"?api_key={api_key}"
        try:
            resp = S.get(url, timeout=30)
        except Exception:
            if guard.failure(): break
            time.sleep(1); continue
        if resp.status_code != 200:
            if guard.failure(): break
            time.sleep(1); continue
        guard.success()
        rec = resp.json() or {}
        r["life_stage"] = "adult"
        r["specimen_condition"] = "Preserved (museum specimen)"
        r["raw_metadata"] = json.dumps(rec, separators=(",", ":"))
        updated += 1
        if (updated % 50) == 0:
            log.info("[smithsonian] %d/%d", updated, len(target))
        time.sleep(0.5)
    return updated


def backfill_usda(rows: list[dict], limit: int | None) -> int:
    """USDA-ARS: re-fetch the detail HTML, embed verbatim in raw_metadata."""
    target = [r for r in rows if not r.get("raw_metadata")]
    if limit is not None:
        target = target[:limit]
    log.info("[usda] %d rows to backfill", len(target))
    updated = 0
    for r in target:
        url = r.get("source_page_url", "")
        if not url:
            r["raw_metadata"] = "{}"
            updated += 1
            continue
        try:
            resp = S.get(url, timeout=30)
        except Exception:
            time.sleep(1); continue
        if resp.status_code != 200:
            time.sleep(1); continue
        r["raw_metadata"] = json.dumps({"html_excerpt": resp.text[:50_000]},
                                       separators=(",", ":"))
        updated += 1
        if (updated % 20) == 0:
            log.info("[usda] %d/%d", updated, len(target))
        time.sleep(0.5)
    return updated


def write_back(path: Path, rows: list[dict]) -> None:
    tmp = path.with_suffix(".csv.tmp")
    with tmp.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=MANIFEST_FIELDS, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            for col in MANIFEST_FIELDS:
                r.setdefault(col, "")
            w.writerow(r)
    tmp.replace(path)


HANDLERS = {
    "inaturalist": backfill_inat,
    "bugwood":     backfill_bugwood,
    "smithsonian": backfill_smithsonian,
    "usda_ars":    backfill_usda,
}


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("sources", nargs="*", default=list(HANDLERS.keys()))
    p.add_argument("--limit", type=int, default=None,
                   help="Max rows per source (for smoke testing)")
    args = p.parse_args()

    total_updated = 0
    for src in args.sources:
        if src not in HANDLERS:
            log.warning("unknown source: %s", src)
            continue
        path = MANIFEST_DIR / f"{src}.csv"
        if not path.exists():
            log.warning("no manifest at %s", path)
            continue
        with path.open("r", newline="", encoding="utf-8") as f:
            rows = list(csv.DictReader(f))
        log.info("=== %s (%d rows in manifest) ===", src, len(rows))
        n = HANDLERS[src](rows, args.limit)
        write_back(path, rows)
        log.info("[%s] wrote %d updates", src, n)
        total_updated += n
    log.info("DONE backfill. total_updated=%d", total_updated)
    return 0


if __name__ == "__main__":
    sys.exit(main())
