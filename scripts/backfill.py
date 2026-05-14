"""One-shot backfill: rename files to new convention, generate missing
thumbnails, populate collection_id / view_label / thumbnail_filename on
pre-schema rows.

This script is idempotent: re-running it is a no-op on already-migrated rows.

Per-source backfill rules:
  • iNaturalist: collection_id parsed from source_page_url
    (".../observations/<id>"). No detail-fetch needed.
  • Bugwood: for rows missing collection_id, fetch /image/{id} for
    specimen{} + dateacquired (parallelized 4-wide).
  • Smithsonian: rows already migrated — skip.
  • USDA-ARS: collection_id = strip trailing -N from source_id.

Run: .venv/bin/python scripts/backfill.py [--source inaturalist|bugwood|smithsonian|usda-ars]
"""
from __future__ import annotations
import csv
import re
import shutil
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import (
    ROOT, IMG_DIR, THUMB_DIR, MANIFEST_DIR, MANIFEST_FIELDS,
    session, build_filename, slugify, make_thumbnail, image_dims,
    setup_logging, read_existing_rows,
)

log = setup_logging("backfill")
S = session()
BACKFILL_WORKERS = 6


# ── per-source collection_id derivation ─────────────────────────

OBS_URL_RE = re.compile(r"/observations/(\d+)")


def collection_id_inat(row: dict) -> str:
    if row.get("collection_id"):
        return row["collection_id"]
    m = OBS_URL_RE.search(row.get("source_page_url", "") or "")
    if m:
        return f"inat-obs-{m.group(1)}"
    return ""


def collection_id_smithsonian(row: dict) -> str:
    if row.get("collection_id"):
        return row["collection_id"]
    sid = row.get("source_id", "")
    return f"smithsonian-spec-{slugify(sid)}" if sid else ""


def collection_id_usda(row: dict) -> str:
    if row.get("collection_id"):
        return row["collection_id"]
    sid = row.get("source_id", "")
    if not sid:
        return ""
    return "usda-" + sid.rsplit("-", 1)[0]


def fetch_bugwood_detail(imgnum: str) -> dict:
    try:
        r = S.get(f"https://api.bugwoodcloud.org/v2/image/{imgnum}", timeout=20)
        if r.status_code == 200:
            return r.json() or {}
    except Exception:
        pass
    return {}


def collection_id_bugwood(detail: dict, row: dict) -> str:
    s = detail.get("specimen") or {}
    repo_num = (s.get("repositorynumber") or "").strip()
    repo = (s.get("repository") or "").strip()
    if repo_num and repo:
        return f"bugwood-specimen-{slugify(repo)}-{slugify(repo_num)}"
    pisid = detail.get("photographerimagesystemid") or 0
    subj = detail.get("subjectid") or 0
    descr = detail.get("descriptorid") or 0
    day = (detail.get("dateacquired") or "")[:10]
    return f"bugwood-session-{pisid}-{subj}-{descr}-{slugify(day)}"


# ── per-row backfill ────────────────────────────────────────────

def _expected_old_paths(row: dict, source: str) -> list[Path]:
    """Where might the file currently live? Try declared filename + legacy patterns."""
    candidates: list[Path] = []
    declared = row.get("filename") or ""
    if declared:
        # filename is stored relative to data/, e.g. "images/inat-20362.jpg"
        candidates.append(ROOT / "data" / declared.lstrip("./"))
    image_id = row.get("image_id") or ""
    if image_id:
        candidates.append(IMG_DIR / f"{image_id}.jpg")
    return candidates


def _resolve_filename_from_row(row: dict, source_name: str) -> str:
    return build_filename(
        source=source_name,
        source_id=row.get("source_id", "") or row.get("image_id", ""),
        subject_type=row.get("subject_type", "nature"),
        common_name=row.get("common_name", ""),
        scientific=row.get("taxon_species", ""),
        suffix_hint=row.get("view_label", ""),
    )


def backfill_row(row: dict, source_name: str, bugwood_detail: dict | None = None) -> bool:
    """Returns True if row needed updating, False if already migrated / unrecoverable."""
    # Compute desired filename
    new_filename = _resolve_filename_from_row(row, source_name)
    target_path = IMG_DIR / new_filename
    target_thumb = THUMB_DIR / new_filename
    declared_filename = row.get("filename", "") or ""
    declared_basename = Path(declared_filename).name
    already_migrated = (
        declared_basename == new_filename
        and bool(row.get("thumbnail_filename"))
        and bool(row.get("collection_id"))
    )
    if already_migrated and target_path.exists() and target_thumb.exists():
        return False

    # Find the file on disk
    src_path: Path | None = None
    for p in _expected_old_paths(row, source_name):
        if p.exists():
            src_path = p; break
    if src_path is None:
        # Maybe already at target?
        if target_path.exists():
            src_path = target_path
        else:
            log.warning("file missing for %s — skipping", row.get("image_id"))
            return False

    # Rename if needed
    if src_path != target_path:
        target_path.parent.mkdir(parents=True, exist_ok=True)
        if target_path.exists():
            # both exist — keep new, delete old
            src_path.unlink(missing_ok=True)
        else:
            shutil.move(str(src_path), str(target_path))

    # Generate thumbnail if missing
    if not target_thumb.exists():
        make_thumbnail(target_path, target_thumb)

    # collection_id
    cid = row.get("collection_id", "")
    if not cid:
        if source_name == "inaturalist":
            cid = collection_id_inat(row)
        elif source_name == "smithsonian":
            cid = collection_id_smithsonian(row)
        elif source_name == "usda-ars" or source_name == "usda_ars":
            cid = collection_id_usda(row)
        elif source_name == "bugwood":
            cid = collection_id_bugwood(bugwood_detail or {}, row)

    # Width / height: refresh from disk if empty
    w = row.get("width"); h = row.get("height")
    if not w or not h:
        ww, hh = image_dims(target_path)
        if ww and hh:
            w, h = str(ww), str(hh)

    row["filename"] = f"images/{new_filename}"
    row["thumbnail_filename"] = f"thumbnails/{new_filename}"
    if cid:
        row["collection_id"] = cid
    if w and h:
        row["width"] = str(w)
        row["height"] = str(h)
    return True


# ── source orchestrators ────────────────────────────────────────

def backfill_simple(source_name: str) -> int:
    """For iNat / Smithsonian / USDA-ARS: no extra API call needed."""
    path = MANIFEST_DIR / f"{source_name}.csv"
    rows = read_existing_rows(path)
    log.info("[%s] %d rows in manifest", source_name, len(rows))
    changed_n = 0

    # Renames + collection_id are cheap; thumbnail gen is CPU-bound but Pillow
    # releases the GIL during JPEG encode → ThreadPoolExecutor works.
    def _one(row: dict):
        return backfill_row(row, source_name)

    with ThreadPoolExecutor(max_workers=BACKFILL_WORKERS) as ex:
        futures = {ex.submit(_one, row): row for row in rows}
        for i, fut in enumerate(as_completed(futures), 1):
            if fut.result():
                changed_n += 1
            if i % 200 == 0:
                log.info("[%s] processed %d / %d  (changed %d)", source_name, i, len(rows), changed_n)

    # Rewrite manifest with canonical schema
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=MANIFEST_FIELDS, extrasaction="ignore")
        w.writeheader()
        for row in rows:
            for fname in MANIFEST_FIELDS:
                row.setdefault(fname, "")
            w.writerow(row)
    log.info("[%s] DONE — %d rows backfilled", source_name, changed_n)
    return changed_n


def backfill_bugwood() -> int:
    """For Bugwood: rows missing collection_id need /image/{id} detail fetch."""
    path = MANIFEST_DIR / "bugwood.csv"
    rows = read_existing_rows(path)
    log.info("[bugwood] %d rows in manifest", len(rows))

    # Stage 1: fetch details for rows missing collection_id, in parallel
    need_detail = [r for r in rows if not r.get("collection_id") and r.get("source_id")]
    log.info("[bugwood] %d rows need detail-fetch", len(need_detail))
    details: dict[str, dict] = {}

    with ThreadPoolExecutor(max_workers=BACKFILL_WORKERS) as ex:
        futures = {ex.submit(fetch_bugwood_detail, r["source_id"]): r["source_id"]
                   for r in need_detail}
        for i, fut in enumerate(as_completed(futures), 1):
            sid = futures[fut]
            try:
                d = fut.result()
            except Exception:
                d = {}
            details[sid] = d
            if i % 50 == 0:
                log.info("[bugwood] detail fetched %d / %d", i, len(need_detail))

    # Stage 2: per-row backfill (rename + thumb + collection_id)
    changed_n = 0
    def _one(row: dict):
        return backfill_row(row, "bugwood",
                            bugwood_detail=details.get(row.get("source_id", "")))
    with ThreadPoolExecutor(max_workers=BACKFILL_WORKERS) as ex:
        futures = {ex.submit(_one, row): row for row in rows}
        for i, fut in enumerate(as_completed(futures), 1):
            if fut.result():
                changed_n += 1
            if i % 100 == 0:
                log.info("[bugwood] processed %d / %d  (changed %d)", i, len(rows), changed_n)

    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=MANIFEST_FIELDS, extrasaction="ignore")
        w.writeheader()
        for row in rows:
            for fname in MANIFEST_FIELDS:
                row.setdefault(fname, "")
            w.writerow(row)
    log.info("[bugwood] DONE — %d rows backfilled", changed_n)
    return changed_n


def main() -> int:
    sources = sys.argv[1:] if len(sys.argv) > 1 else ["inaturalist", "bugwood", "smithsonian", "usda-ars"]
    total = 0
    for src in sources:
        src = src.lower().replace("-", "_")
        if src == "inaturalist":
            total += backfill_simple("inaturalist")
        elif src == "bugwood":
            total += backfill_bugwood()
        elif src == "smithsonian":
            total += backfill_simple("smithsonian")
        elif src in ("usda_ars", "usda-ars"):
            total += backfill_simple("usda_ars")
        else:
            log.warning("unknown source %s — skipping", src)
    log.info("backfill grand total: %d rows updated", total)
    return 0


if __name__ == "__main__":
    sys.exit(main())
