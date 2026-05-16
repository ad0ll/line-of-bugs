"""Fetch ~3000 insect images from iNaturalist via the v1 search API.

Production refactor (2026-05-14):
  * Existing-manifest counts are read ONCE at startup, cached by taxon_order.
  * Per-page image downloads run in parallel (6 workers → ~5-6× faster on S3).
  * API record fetches stay sequential at 1 req/sec (per iNat docs).
  * Consecutive-failure guard exits non-zero if the API is unreachable.
  * Per-order summary at end.
"""
from __future__ import annotations
import json
import os
import re
import sys
import time
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

# SCALE multiplier — set INAT_SCALE=10 to roughly 10× every per-order target.
# Useful to expand the dataset without editing the per-order table.
SCALE = float(os.environ.get("INAT_SCALE", "1"))

# When set, every row gets re-UPSERTed even if image_id already exists
# locally — useful when upstream relicensed photos or fixed attribution.
# Default skips known image_ids for speed.
INAT_REFRESH = os.environ.get("INAT_REFRESH", "").lower() in ("1", "true", "yes")

# Mode toggle: "wild" (default — what we've always done) vs "captive" (zoos,
# butterfly conservatories, lab insectariums, hand-held macro shots). When
# captive: send captive=true to the API + write subject_state="captive" so
# the gallery can filter them as a separate axis. By default we shrink the
# per-order targets to 30% of wild because the captive pool is smaller and
# we don't need parity in volume — user overrides via INAT_SCALE.
INAT_MODE = os.environ.get("INAT_MODE", "wild")
assert INAT_MODE in ("wild", "captive"), f"INAT_MODE must be wild|captive, got {INAT_MODE!r}"
SUBJECT_STATE = "captive" if INAT_MODE == "captive" else "wild"
if INAT_MODE == "captive":
    SCALE = SCALE * 0.3
from common import (
    session, IMG_DIR, THUMB_DIR, MEDIUM_DIR, MIN_LONG_EDGE_DEFAULT,
    parallel_download, ConsecutiveFailureGuard,
    setup_logging, build_filename, slugify, ensure_data_dirs,
)
from db import DbWriter
from taxonomy_subgroup import classify as classify_subgroup

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

# Synthetic-label → (taxon_order, life_stage) for DB write time.
# Internal `label` values used as iNat query keys aren't always the true
# taxonomic order — e.g. "Lepidoptera_larva" is our project's way of
# pulling caterpillars under term_id=1 / term_value_id=6, but the real
# taxon_order is still "Lepidoptera". Without this split, gallery
# queries like `WHERE taxon_order='Lepidoptera'` miss caterpillar rows.
# taxonomy_subgroup.classify() continues to see the synthetic label so
# its "Lepidoptera_larva → caterpillar" mapping still fires.
LABEL_TO_TAXON_ORDER_AND_LIFE_STAGE: dict[str, tuple[str, str]] = {
    "Lepidoptera_larva": ("Lepidoptera", "larva"),
}

EVIDENCE_DROP = {23, 25, 26, 27, 28, 29, 31, 32, 35}

# iNat controlled-term mappings into our normalized enums.
# attr_id=1 (Life Stage). Subimago + Teneral both map to adult (immature
# flying forms of mayflies / newly-emerged adults respectively).
INAT_LIFE_STAGE_VALUE_TO_ENUM = {
    2: "adult", 3: "adult", 4: "pupa", 5: "nymph",
    6: "larva", 7: "egg", 8: "juvenile", 16: "adult",
}
# attr_id=9 (Sex)
INAT_SEX_VALUE_TO_ENUM = {10: "female", 11: "male", 20: "unknown"}


def extract_inat_metadata(obs: dict) -> tuple[str | None, str | None]:
    """Extract (life_stage, sex) from an observation's annotations array."""
    life_stage: str | None = None
    sex: str | None = None
    for ann in (obs.get("annotations") or []):
        attr = ann.get("controlled_attribute_id")
        val = ann.get("controlled_value_id")
        if attr == 1 and val in INAT_LIFE_STAGE_VALUE_TO_ENUM and life_stage is None:
            life_stage = INAT_LIFE_STAGE_VALUE_TO_ENUM[val]
        elif attr == 9 and val in INAT_SEX_VALUE_TO_ENUM and sex is None:
            sex = INAT_SEX_VALUE_TO_ENUM[val]
    return life_stage, sex

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


def fetch_order(mw: DbWriter, existing_by_label: Counter,
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
            # iNat tags captive observations as quality_grade=casual by
            # definition, so the captive pass can't filter on grade. We
            # rely on min-image-size + life-stage + license filters
            # already in `keep()` to gate quality.
            **({} if INAT_MODE == "captive" else {"quality_grade": "research"}),
            "term_id": 1,
            "term_value_id": life_value,
            "captive": "true" if INAT_MODE == "captive" else "false",
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
            if mw.has(image_id) and not INAT_REFRESH:
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
                subject_state=SUBJECT_STATE,
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
        # Wrap the page's UPSERTs in a single transaction — one fsync
        # per page instead of one per row.
        with mw.batch():
            for meta, (_item, dl) in zip(page_meta, downloaded):
                if dl is None:
                    continue
                obs = meta["obs"]; ph = meta["photo"]; taxon = meta["taxon"]
                lic_code, lic_url = LICENSE_MAP[ph["license_code"]]
                user = obs.get("user") or {}
                life_stage, sex = extract_inat_metadata(obs)
                # Split synthetic labels like "Lepidoptera_larva" into their
                # real (taxon_order, life_stage) for DB write — the gallery
                # filters on the real order. Annotated life_stage from iNat
                # wins; the synthetic split is a fallback for rows that
                # didn't carry an explicit annotation.
                db_taxon_order, synthetic_life_stage = (
                    LABEL_TO_TAXON_ORDER_AND_LIFE_STAGE.get(label, (label, ""))
                )
                effective_life_stage = life_stage or synthetic_life_stage
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
                    "taxon_order": db_taxon_order,
                    "taxon_species": meta["scientific"],
                    "common_name": meta["common_name"],
                    "subject_state": SUBJECT_STATE,
                    "taxon_subgroup": classify_subgroup(
                        label, taxon.get("ancestor_ids") or []
                    ),
                    "view_label": "",
                    "life_stage": effective_life_stage,
                    "sex": sex or "",
                    "host_organism": "",
                    "specimen_condition": "",
                    "description": (obs.get("description") or ""),
                    "captured_date": (obs.get("observed_on") or "")[:10],
                    "raw_metadata": json.dumps(obs, separators=(",", ":")),
                }, refresh=INAT_REFRESH)
                kept_run += 1
                if (kept_run % 25) == 0:
                    log.info("[%s] %d/%d", label, already + kept_run, target)

        time.sleep(1.1)  # iNat API politeness (1 req/sec)
    return already + kept_run, kept_run


def main() -> int:
    ensure_data_dirs()
    mw = DbWriter("inaturalist")
    log.info("iNat: mode=%s, resuming with %d already in DB (across all states)",
             INAT_MODE, mw.count())

    # One-shot startup pre-flight: per-label counts for THIS mode's subject_state.
    # Wild and captive are independent pools; we mustn't let wild rows count
    # against the captive target.
    # Note: synthetic labels (e.g. Lepidoptera_larva) are stored in DB as
    # (taxon_order='Lepidoptera', life_stage='larva'), so we need to split
    # the count back out per synthetic label.
    existing_by_label = Counter()
    for label, n in mw.conn.execute(
        "SELECT taxon_order, COUNT(*) FROM images "
        "WHERE source = 'inaturalist' AND subject_state = ? "
        "  AND (life_stage IS NULL OR life_stage != 'larva') "
        "GROUP BY taxon_order",
        (SUBJECT_STATE,),
    ):
        existing_by_label[label or ""] = n
    # Pull the synthetic Lepidoptera_larva count from the split fields.
    larva_count = mw.conn.execute(
        "SELECT COUNT(*) FROM images "
        "WHERE source = 'inaturalist' AND subject_state = ? "
        "  AND taxon_order = 'Lepidoptera' AND life_stage = 'larva'",
        (SUBJECT_STATE,),
    ).fetchone()[0]
    if larva_count:
        existing_by_label["Lepidoptera_larva"] = larva_count

    api_guard = ConsecutiveFailureGuard(threshold=6, name="inat-api")
    summary: dict[str, tuple[int, int, int]] = {}
    total_added = 0
    for taxon_id, label, base_target, life_value in ORDERS:
        target = int(round(base_target * SCALE))
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
