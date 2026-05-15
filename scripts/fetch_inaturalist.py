"""Fetch ~3000 insect images from iNaturalist via the v1 search API.

Production refactor (2026-05-14):
  * Existing-manifest counts are read ONCE at startup, cached by taxon_order.
  * Per-page image downloads run in parallel (6 workers → ~5-6× faster on S3).
  * API record fetches stay sequential at 1 req/sec (per iNat docs).
  * Consecutive-failure guard exits non-zero if the API is unreachable.
  * Per-order summary at end.
"""
from __future__ import annotations
import re
import sys
import time
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import (
    session, ManifestWriter, IMG_DIR, THUMB_DIR, MEDIUM_DIR, MIN_LONG_EDGE_DEFAULT,
    parallel_download, ConsecutiveFailureGuard, read_existing_rows,
    setup_logging, build_filename, slugify,
)

log = setup_logging("inat")
S = session()
BASE = "https://api.inaturalist.org/v1/observations"

ORDERS = [
    (47208, "Coleoptera",        350, 2),
    (47157, "Lepidoptera",       450, 2),
    (47157, "Lepidoptera_larva", 250, 6),
    (47792, "Odonata",           250, 2),
    (47201, "Hymenoptera",       300, 2),
    (47822, "Diptera",           250, 2),
    (47744, "Hemiptera",         250, 2),
    (48112, "Mantodea",          150, 2),
    (47651, "Orthoptera",        250, 2),
    (47198, "Phasmatodea",       120, 2),
    (48763, "Neuroptera",        100, 2),
    (81769, "Blattodea",         100, 2),
    (47793, "Dermaptera",         70, 2),
    (62164, "Trichoptera",        60, 2),
    (48011, "Ephemeroptera",      60, 2),
    (47504, "Plecoptera",         40, 2),
]

EVIDENCE_DROP = {23, 25, 26, 27, 28, 29, 31, 32, 35}

MATING_PATTERNS = re.compile(
    r"\b(mating|copul|in cop|in tandem|tandem|courtship|swarm|aggregation|"
    r"cluster of|colony of|nest with|hive of|"
    r"multiple|many adults|several adults|bunch of|"
    r"pair (of|on)|couple of|two adults?|three adults?|"
    r"ovipositing|brood|eggs and adults?)\b",
    re.I,
)

OFV_BAD_NAMES = {
    "behavior: mating", "mating", "mating specimens",
    "paired (in tandem or in copula)", "mating behavior observed?",
    "reproductive behavior of animals",
}
OFV_COUNT_NAMES = {
    "number of individuals recorded", "number of individuals spotted",
    "approximate number of individuals", "number of individuals observed:",
    "number of individuals collected/observed",
    "maximum number of individuals seen at one time during the survey",
}

LICENSE_MAP = {
    "cc0":      ("cc0-1.0",      "https://creativecommons.org/publicdomain/zero/1.0/"),
    "cc-by":    ("cc-by-4.0",    "https://creativecommons.org/licenses/by/4.0/"),
    "cc-by-sa": ("cc-by-sa-4.0", "https://creativecommons.org/licenses/by-sa/4.0/"),
    "cc-by-nc": ("cc-by-nc-4.0", "https://creativecommons.org/licenses/by-nc/4.0/"),
}

MAX_WORKERS = 6  # iNat photos live in AWS S3 — high request ceiling


def keep(obs: dict, photo: dict) -> bool:
    desc = (obs.get("description") or "").lower()
    if MATING_PATTERNS.search(desc):
        return False
    for tag in (obs.get("tags") or []):
        if isinstance(tag, str) and MATING_PATTERNS.search(tag.lower()):
            return False
    for ofv in (obs.get("ofvs") or []):
        name = (ofv.get("name_ci") or ofv.get("name") or "").lower().strip()
        raw_val = ofv.get("value")
        val = (str(raw_val) if raw_val is not None else "").strip().lower()
        if name in OFV_BAD_NAMES and val in ("yes", "y", "true", "1",
                                              "in copula", "in tandem", "mating",
                                              "courting", "courtship"):
            return False
        if name in OFV_COUNT_NAMES:
            for tok in re.findall(r"\d+", val):
                try:
                    if int(tok) > 1:
                        return False
                except ValueError:
                    pass
    for ann in (obs.get("annotations") or []):
        if ann.get("controlled_attribute_id") == 22 and \
           ann.get("controlled_value_id") in EVIDENCE_DROP:
            return False
    od = photo.get("original_dimensions") or {}
    if max(od.get("width") or 0, od.get("height") or 0) < MIN_LONG_EDGE_DEFAULT:
        return False
    if photo.get("license_code") not in LICENSE_MAP:
        return False
    return True


def fetch_order(mw: ManifestWriter, existing_by_label: Counter,
                taxon_id: int, label: str, target: int, life_value: int,
                api_guard: ConsecutiveFailureGuard) -> tuple[int, int]:
    """Returns (final_count_for_label, new_downloads_this_run)."""
    already = existing_by_label[label]
    needed = max(0, target - already)
    if needed == 0:
        log.info("[%s] already have %d ≥ target %d — skipping", label, already, target)
        return already, 0

    log.info("=== %s (taxon %d) need %d / target %d ===", label, taxon_id, needed, target)
    last_id = 0
    kept_run = 0
    while kept_run < needed:
        params = {
            "taxon_id": taxon_id,
            "photo_license": "cc0,cc-by,cc-by-sa,cc-by-nc",
            "quality_grade": "research",
            "term_id": 1,
            "term_value_id": life_value,
            "captive": "false",
            "per_page": 200,
            "order": "asc",
            "order_by": "id",
            "id_above": last_id,
        }
        try:
            r = S.get(BASE, params=params, timeout=45)
        except Exception as e:
            log.warning("[%s] api err %s — backoff+retry", label, type(e).__name__)
            time.sleep(3)
            if api_guard.failure():
                log.error("API guard tripped — too many consecutive failures, aborting %s", label)
                return already + kept_run, kept_run
            continue
        if r.status_code != 200:
            log.warning("[%s] http %d — backoff+retry", label, r.status_code)
            time.sleep(2)
            if api_guard.failure():
                return already + kept_run, kept_run
            continue
        api_guard.success()
        results = (r.json() or {}).get("results") or []
        if not results:
            log.info("[%s] exhausted at id=%d", label, last_id)
            break
        last_id = max(o["id"] for o in results)

        # Build a batch of download jobs for this page
        batch: list[dict] = []
        page_meta: list[dict] = []
        for obs in results:
            if kept_run >= needed:
                break
            photos = obs.get("photos") or []
            if not photos:
                continue
            ph = photos[0]
            if not keep(obs, ph):
                continue
            photo_id = ph.get("id")
            if photo_id is None:
                continue
            image_id = f"inat-{photo_id}"
            if mw.has(image_id):
                continue
            url = (ph.get("url") or "").replace("/square.", "/original.")
            if not url or "/square" in url:
                continue
            taxon = obs.get("taxon") or {}
            common_name = taxon.get("preferred_common_name") or ""
            scientific = taxon.get("name") or ""
            filename = build_filename(
                source="inaturalist",
                source_id=str(photo_id),
                subject_type="nature",
                common_name=common_name,
                scientific=scientific,
            )
            out_path = IMG_DIR / filename
            thumb_path = THUMB_DIR / filename
            medium_path = MEDIUM_DIR / filename
            batch.append({"url": url, "out_path": out_path,
                          "thumb_path": thumb_path, "medium_path": medium_path})
            page_meta.append({
                "obs": obs, "photo": ph, "photo_id": photo_id,
                "image_id": image_id, "filename": filename,
                "url": url, "scientific": scientific, "common_name": common_name,
                "taxon": taxon,
            })

        # Fan-out downloads
        downloaded = parallel_download(S, batch, max_workers=MAX_WORKERS)
        for meta, (_item, dl) in zip(page_meta, downloaded):
            if dl is None:
                continue
            obs = meta["obs"]; ph = meta["photo"]; taxon = meta["taxon"]
            lic_code, lic_url = LICENSE_MAP[ph["license_code"]]
            user = obs.get("user") or {}
            mw.write({
                "image_id": meta["image_id"],
                "collection_id": f"inat-obs-{obs['id']}",
                "source": "inaturalist",
                "source_id": str(meta["photo_id"]),
                "source_page_url": f"https://www.inaturalist.org/observations/{obs['id']}",
                "image_url": meta["url"],
                "filename": f"images/{meta['filename']}",
                "thumbnail_filename": f"thumbnails/{meta['filename']}",
                "medium_filename": f"medium/{meta['filename']}",
                "file_size_bytes": dl["file_size_bytes"],
                "file_sha256": dl["file_sha256"],
                "width": dl["width"],
                "height": dl["height"],
                "license": lic_code,
                "license_url": lic_url,
                "photographer_attribution": ph.get("attribution") or "",
                "photographer": user.get("name") or user.get("login") or "",
                "institution": "iNaturalist (citizen science)",
                "taxon_order": label,
                "taxon_species": meta["scientific"],
                "common_name": meta["common_name"],
                "subject_type": "nature",
                "view_label": "",
                "description": (obs.get("description") or "")[:500],
                "captured_date": (obs.get("observed_on") or "")[:10],
            })
            kept_run += 1
            if (kept_run % 25) == 0:
                log.info("[%s] %d/%d", label, already + kept_run, target)

        time.sleep(1.1)  # iNat API politeness (1 req/sec)
    return already + kept_run, kept_run


def main() -> int:
    mw = ManifestWriter("inaturalist")
    log.info("iNat: resuming with %d already in manifest", mw.count())

    # One-shot startup pre-flight: per-label counts
    existing_by_label = Counter()
    for row in read_existing_rows(mw.path):
        existing_by_label[row.get("taxon_order", "")] += 1

    api_guard = ConsecutiveFailureGuard(threshold=6, name="inat-api")
    summary: dict[str, tuple[int, int, int]] = {}
    total_added = 0
    for taxon_id, label, target, life_value in ORDERS:
        if api_guard.tripped:
            log.error("api guard already tripped — skipping %s", label)
            summary[label] = (target, existing_by_label[label], 0)
            continue
        final_count, run_added = fetch_order(
            mw, existing_by_label, taxon_id, label, target, life_value, api_guard,
        )
        existing_by_label[label] = final_count
        summary[label] = (target, final_count, run_added)
        total_added += run_added
        log.info("[%s] FINAL: %d (target %d, +%d this run)", label, final_count, target, run_added)

    mw.close()
    log.info("DONE iNat. manifest=%d   added_this_run=%d", mw.count(), total_added)
    log.info("── per-order ── label / target / final / added_this_run")
    for label, (target, final, added) in summary.items():
        log.info("  %-22s  %4d / %4d / %4d", label, target, final, added)
    if api_guard.tripped:
        log.error("Exiting non-zero: api guard tripped during run.")
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
