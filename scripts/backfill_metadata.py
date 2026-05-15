"""Backfill raw_metadata + structured biology columns for existing rows.

R4 added life_stage / sex / host_organism / specimen_condition / raw_metadata.
For images fetched BEFORE R4, these are empty. This script re-queries the
source APIs and UPDATEs the rows in place — no image bytes re-downloaded,
no CSV intermediate (R5).

  iNat:        GET /v1/observations?id=... (batched 200)
  Bugwood:     GET /v2/image/{imagenumber}
  Smithsonian: GET /v1/content/{record_id}
  USDA-ARS:    re-fetch the source page HTML

Idempotent: rows that already have raw_metadata are skipped.

Usage:
  .venv/bin/python scripts/backfill_metadata.py              # all
  .venv/bin/python scripts/backfill_metadata.py inaturalist  # one source
  .venv/bin/python scripts/backfill_metadata.py --limit 100  # smoke run
"""
from __future__ import annotations
import argparse
import json
import os
import re
import sqlite3
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import session, setup_logging, ConsecutiveFailureGuard
from db import DB_PATH
from fetch_inaturalist import extract_inat_metadata
from fetch_bugwood import (
    BUGWOOD_DESCRIPTOR_TO_LIFE_STAGE, BUGWOOD_GENDER_TO_SEX,
)

log = setup_logging("backfill")
S = session()

# Source key (CLI arg / handler dict) → DB source column value. The
# CSV legacy used "usda_ars" but the DB stores "usda-ars".
SOURCE_DB_VALUE = {
    "inaturalist": "inaturalist",
    "bugwood":     "bugwood",
    "smithsonian": "smithsonian",
    "usda_ars":    "usda-ars",
}


def open_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, isolation_level=None)
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA synchronous = NORMAL")
    conn.execute("PRAGMA busy_timeout = 5000")
    conn.row_factory = sqlite3.Row
    return conn


def load_rows_needing_backfill(conn: sqlite3.Connection, source: str) -> list[dict]:
    """Pull only the columns the backfill handlers touch — never select
    raw_metadata or description into memory wholesale, so iNat's
    millions-of-bytes blob doesn't load for rows we're going to skip."""
    rows = conn.execute(
        "SELECT image_id, collection_id, source_id, source_page_url, "
        "description "
        "FROM images "
        "WHERE source = ? AND (raw_metadata IS NULL OR raw_metadata = '')",
        (source,),
    ).fetchall()
    return [dict(r) for r in rows]


UPDATE_SQL = (
    "UPDATE images SET "
    "life_stage = COALESCE(?, life_stage), "
    "sex = COALESCE(?, sex), "
    "host_organism = COALESCE(?, host_organism), "
    "specimen_condition = COALESCE(?, specimen_condition), "
    "description = COALESCE(?, description), "
    "raw_metadata = ? "
    "WHERE image_id = ?"
)


def _opt(v: str | None) -> str | None:
    """Treat empty string as 'no change' so COALESCE keeps the existing value."""
    return v if v else None


def apply_updates(conn: sqlite3.Connection, updates: list[dict]) -> int:
    if not updates:
        return 0
    payload = []
    for r in updates:
        payload.append((
            _opt(r.get("life_stage")),
            _opt(r.get("sex")),
            _opt(r.get("host_organism")),
            _opt(r.get("specimen_condition")),
            _opt(r.get("description")),
            r.get("raw_metadata") or "{}",
            r["image_id"],
        ))
    conn.executemany(UPDATE_SQL, payload)
    return len(payload)


# ─────────────────────────── iNat ────────────────────────────

def inat_obs_id_from_collection(collection_id: str) -> str | None:
    if not collection_id.startswith("inat-obs-"):
        return None
    return collection_id[len("inat-obs-"):]


INAT_BATCH = 200


def backfill_inat(rows: list[dict], limit: int | None,
                  conn: sqlite3.Connection) -> int:
    """Batched 200/req — ~140 requests for 27k rows instead of 27k."""
    guard = ConsecutiveFailureGuard(threshold=5, name="inat-backfill")
    target = rows[:limit] if limit is not None else rows
    log.info("[inat] %d rows to backfill (batch=%d)", len(target), INAT_BATCH)

    by_obs: dict[str, dict] = {}
    no_obs_id = 0
    for r in target:
        obs_id = inat_obs_id_from_collection(r.get("collection_id", ""))
        if not obs_id:
            no_obs_id += 1
            continue
        by_obs[obs_id] = r
    log.info("[inat] %d unique obs ids (%d skipped — bad collection_id)",
             len(by_obs), no_obs_id)

    updated = 0
    pending: list[dict] = []
    obs_ids = list(by_obs.keys())
    for i in range(0, len(obs_ids), INAT_BATCH):
        chunk = obs_ids[i:i + INAT_BATCH]
        try:
            resp = S.get(
                "https://api.inaturalist.org/v1/observations",
                params={"id": ",".join(chunk), "per_page": INAT_BATCH},
                timeout=60,
            )
        except Exception as e:
            log.warning("[inat batch %d] %s", i, type(e).__name__)
            if guard.failure(): break
            time.sleep(3); continue
        if resp.status_code != 200:
            log.warning("[inat batch %d] http %d", i, resp.status_code)
            if guard.failure(): break
            time.sleep(3); continue
        guard.success()
        results = (resp.json() or {}).get("results") or []
        returned_ids: set[str] = set()
        for obs in results:
            obs_id = str(obs.get("id"))
            returned_ids.add(obs_id)
            r = by_obs.get(obs_id)
            if r is None:
                continue
            life_stage, sex = extract_inat_metadata(obs)
            full_desc = obs.get("description") or ""
            # Only overwrite description if longer than what we have
            keep_desc = full_desc if len(full_desc) > len(r.get("description") or "") else None
            pending.append({
                "image_id": r["image_id"],
                "life_stage": life_stage,
                "sex": sex,
                "description": keep_desc,
                "raw_metadata": json.dumps(obs, separators=(",", ":")),
            })
        # iNat dropped these rows (deleted obs); mark with empty json so we
        # don't re-query them next run.
        for missing in (set(chunk) - returned_ids):
            r = by_obs.get(missing)
            if r is not None:
                pending.append({
                    "image_id": r["image_id"],
                    "raw_metadata": "{}",
                })
        if len(pending) >= 500:
            updated += apply_updates(conn, pending)
            pending.clear()
        log.info("[inat] batch %d-%d  staged=%d", i, i + len(chunk), updated + len(pending))
        time.sleep(1.1)  # 1 req/sec
    if pending:
        updated += apply_updates(conn, pending)
    return updated


# ─────────────────────────── Bugwood ─────────────────────────

def backfill_bugwood(rows: list[dict], limit: int | None,
                     conn: sqlite3.Connection) -> int:
    guard = ConsecutiveFailureGuard(threshold=8, name="bugwood-backfill")
    target = rows[:limit] if limit is not None else rows
    log.info("[bugwood] %d rows to backfill", len(target))
    updated = 0
    pending: list[dict] = []
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
            pending.append({"image_id": r["image_id"], "raw_metadata": "{}"})
            updated += 1
            continue
        if resp.status_code != 200:
            log.warning("[bugwood %s] http %d", imgnum, resp.status_code)
            if guard.failure(): break
            time.sleep(1); continue
        guard.success()
        detail = resp.json() or {}
        descriptor_name = (detail.get("descriptorname") or "").strip()
        gendercaste = (detail.get("gendercaste") or detail.get("gender") or "").strip()
        spec = detail.get("specimen") or {}
        pending.append({
            "image_id": r["image_id"],
            "life_stage": BUGWOOD_DESCRIPTOR_TO_LIFE_STAGE.get(descriptor_name, ""),
            "sex": BUGWOOD_GENDER_TO_SEX.get(gendercaste, ""),
            "host_organism": (detail.get("hostname") or "").strip(),
            "specimen_condition": (spec.get("specimencondition") or "").strip(),
            "raw_metadata": json.dumps({"detail": detail}, separators=(",", ":")),
        })
        updated += 1
        if (updated % 100) == 0:
            apply_updates(conn, pending)
            pending.clear()
            log.info("[bugwood] %d/%d", updated, len(target))
        time.sleep(0.5)
    if pending:
        apply_updates(conn, pending)
    return updated


# ─────────────────────────── Smithsonian ─────────────────────

def backfill_smithsonian(rows: list[dict], limit: int | None,
                         conn: sqlite3.Connection) -> int:
    guard = ConsecutiveFailureGuard(threshold=8, name="smithsonian-backfill")
    target = rows[:limit] if limit is not None else rows
    log.info("[smithsonian] %d rows to backfill", len(target))
    rec_re = re.compile(r"/object/([^/?#]+)")
    api_key = os.environ.get("SI_API_KEY", "")
    updated = 0
    pending: list[dict] = []
    for r in target:
        page = r.get("source_page_url", "")
        m = rec_re.search(page)
        record_id = m.group(1) if m else None
        if not record_id:
            # ARK-style URL — we don't have an easy lookup. Still mark
            # life_stage + specimen_condition so the gallery filters work.
            pending.append({
                "image_id": r["image_id"],
                "life_stage": "adult",
                "specimen_condition": "Preserved (museum specimen)",
                "raw_metadata": "{}",
            })
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
        pending.append({
            "image_id": r["image_id"],
            "life_stage": "adult",
            "specimen_condition": "Preserved (museum specimen)",
            "raw_metadata": json.dumps(rec, separators=(",", ":")),
        })
        updated += 1
        if (updated % 100) == 0:
            apply_updates(conn, pending)
            pending.clear()
            log.info("[smithsonian] %d/%d", updated, len(target))
        time.sleep(0.5)
    if pending:
        apply_updates(conn, pending)
    return updated


# ─────────────────────────── USDA ────────────────────────────

def backfill_usda(rows: list[dict], limit: int | None,
                  conn: sqlite3.Connection) -> int:
    target = rows[:limit] if limit is not None else rows
    log.info("[usda] %d rows to backfill", len(target))
    updated = 0
    pending: list[dict] = []
    for r in target:
        url = r.get("source_page_url", "")
        if not url:
            pending.append({"image_id": r["image_id"], "raw_metadata": "{}"})
            updated += 1
            continue
        try:
            resp = S.get(url, timeout=30)
        except Exception:
            time.sleep(1); continue
        if resp.status_code != 200:
            time.sleep(1); continue
        pending.append({
            "image_id": r["image_id"],
            "raw_metadata": json.dumps({"html_excerpt": resp.text[:50_000]},
                                       separators=(",", ":")),
        })
        updated += 1
        if (updated % 20) == 0:
            apply_updates(conn, pending)
            pending.clear()
            log.info("[usda] %d/%d", updated, len(target))
        time.sleep(0.5)
    if pending:
        apply_updates(conn, pending)
    return updated


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

    conn = open_conn()
    total_updated = 0
    for src in args.sources:
        if src not in HANDLERS:
            log.warning("unknown source: %s", src)
            continue
        db_source = SOURCE_DB_VALUE[src]
        rows = load_rows_needing_backfill(conn, db_source)
        log.info("=== %s (%d rows need backfill) ===", src, len(rows))
        n = HANDLERS[src](rows, args.limit, conn)
        log.info("[%s] applied %d updates", src, n)
        total_updated += n
    conn.close()
    log.info("DONE backfill. total_updated=%d", total_updated)
    return 0


if __name__ == "__main__":
    sys.exit(main())
