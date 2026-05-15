"""Fetch CC0 insect specimen photos from Smithsonian Open Access (S3 + ids.si.edu).

Production refactor (2026-05-14):
  * Parallel shard downloads (8 shards × ~12 s sequentially → ~2 s in parallel).
  * Parallel image downloads (4 workers — ids.si.edu is custom-server, polite).
  * collection_id = smithsonian-spec-<USNM barcode>.
  * Multi-media: iterate all media[], filter out labels/genitalia/pin views.
  * Prefer "Screen Image" resource (~1200px ~200KB); never grab the
    "High-resolution JPEG" mega-files (~80 MB).
  * Consecutive-failure guard + non-zero exit.
"""
from __future__ import annotations
import json
import random
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import (
    session, IMG_DIR, THUMB_DIR, MEDIUM_DIR,
    parallel_download, ConsecutiveFailureGuard,
    setup_logging, build_filename, slugify,
)
from db import DbWriter
from taxonomy_subgroup import classify as classify_subgroup

log = setup_logging("smithsonian")
S = session()
BUCKET = "https://smithsonian-open-access.s3-us-west-2.amazonaws.com/metadata/edan/nmnhento"
SHARDS = ["00", "20", "40", "60", "80", "a0", "c0", "f0"]
ALLOWED_PREP = {"Pinned", "pinned", "Envelope", "envelope"}

EXCLUDED_VIEW_TOKENS = (
    "_labels", "_label", "labels_",
    "_genitalia", "genitalia",
    "_pin", "_pin_label", "_locality_label",
)
VIEW_TOKENS = [
    ("dorsal", "dorsal"), ("_d.jp", "dorsal"),
    ("lateral", "lateral"), ("_l.jp", "lateral"),
    ("frontal", "frontal"), ("_f.jp", "frontal"),
    ("ventral", "ventral"), ("_v.jp", "ventral"),
    ("face", "face"), ("head", "head"), ("_h.jp", "head"),
    ("habitus", "habitus"),
    ("oblique", "oblique"),
    ("posterior", "posterior"),
    ("anterior", "anterior"),
]

MAX_WORKERS = 4  # ids.si.edu, polite
TARGET_RECORDS = 300


def load_shard(shard: str) -> list[dict]:
    log.info("loading shard %s.txt …", shard)
    try:
        r = S.get(f"{BUCKET}/{shard}.txt", timeout=300)
        r.raise_for_status()
    except Exception as e:
        log.warning("shard %s failed: %s", shard, type(e).__name__)
        return []
    out: list[dict] = []
    for line in r.text.splitlines():
        line = line.strip()
        if not line: continue
        try:
            rec = json.loads(line)
        except Exception:
            continue
        content = rec.get("content") or {}
        indexed = content.get("indexedStructured") or {}
        freetext = content.get("freetext") or {}
        descNR = content.get("descriptiveNonRepeating") or {}
        if "Insecta" not in (indexed.get("tax_class") or []): continue
        media = ((descNR.get("online_media") or {}).get("media")) or []
        if not media: continue
        preps = [pd.get("content") for pd in (freetext.get("physicalDescription") or [])
                 if pd.get("label") == "Preparation"]
        if not any(p in ALLOWED_PREP for p in preps): continue
        out.append(rec)
    log.info("  shard %s kept %d candidates", shard, len(out))
    return out


def detect_view_label(url: str) -> str:
    u = url.lower()
    for tok, lbl in VIEW_TOKENS:
        if tok in u: return lbl
    return ""


def is_excluded_view(url: str) -> bool:
    u = url.lower()
    return any(tok in u for tok in EXCLUDED_VIEW_TOKENS)


def pick_url(media: dict) -> str | None:
    for res in (media.get("resources") or []):
        if "Screen Image" in (res.get("label") or ""):
            return res.get("url")
    return media.get("content")


def main() -> int:
    mw = DbWriter("smithsonian")
    log.info("Smithsonian: resuming with %d already", mw.count())

    # Parallel shard load
    candidates: list[dict] = []
    shard_guard = ConsecutiveFailureGuard(threshold=4, name="smithsonian-shards")
    with ThreadPoolExecutor(max_workers=min(8, len(SHARDS))) as ex:
        futures = {ex.submit(load_shard, s): s for s in SHARDS}
        for fut in as_completed(futures):
            shard = futures[fut]
            try:
                items = fut.result() or []
            except Exception as e:
                log.warning("shard %s exception: %s", shard, e)
                items = []
            if not items:
                if shard_guard.failure():
                    log.error("too many shard failures; aborting")
                    return 2
            else:
                shard_guard.success()
                candidates.extend(items)

    log.info("Smithsonian: %d total candidates from %d shards", len(candidates), len(SHARDS))
    if not candidates:
        log.error("no candidates loaded; aborting")
        return 2
    random.seed(0xb01b00)
    random.shuffle(candidates)

    kept_records = 0
    kept_media = 0
    skipped_view = 0

    # Per record: build a batch of media[] download jobs (after view filtering),
    # then fan out per-record (multi-angle), write manifest as results come in.
    for rec in candidates:
        if kept_records >= TARGET_RECORDS: break
        content = rec["content"]
        descNR = content["descriptiveNonRepeating"]
        indexed = content.get("indexedStructured") or {}
        freetext = content.get("freetext") or {}
        media_list = descNR["online_media"]["media"]

        record_id = descNR.get("record_ID", "")
        usnm = ""
        for ident in (freetext.get("identifier") or []):
            if ident.get("label") == "USNM Number":
                usnm = ident.get("content") or ""
                break
        if not usnm: usnm = record_id
        usnm_clean = usnm.replace(" ", "_")
        collection_id = f"smithsonian-spec-{slugify(usnm_clean)}"

        sci = (indexed.get("scientific_name") or [""])[0]
        order = (indexed.get("tax_order") or [""])[0]
        date_str = ""
        for d in (freetext.get("date") or []):
            if d.get("label") == "Collection Date":
                date_str = (d.get("content") or "")[:30]; break
        record_link = descNR.get("record_link") or f"https://www.si.edu/object/{record_id}"
        credit_tail = f", {usnm}" if usnm and usnm != record_id else ""
        credit = (f"Smithsonian National Museum of Natural History, "
                  f"Department of Entomology{credit_tail}, CC0")

        rec_jobs: list[dict] = []
        for media in media_list:
            url = pick_url(media)
            if not url: continue
            if is_excluded_view(url):
                skipped_view += 1; continue
            ids_id = media.get("idsId") or media.get("id") or ""
            view = detect_view_label(url)
            ids_suffix = slugify(ids_id.replace("ark:/65665/", ""))[:10] or slugify(view) or "v0"
            image_id = f"smithsonian-{slugify(usnm_clean)}-{ids_suffix}"
            if mw.has(image_id): continue
            # Include ids_suffix in the filename hint so multi-media specimens
            # don't collide on disk when view labels are empty/identical
            # (bug seen 2026-05-14: 75 files overwrote each other before).
            view_hint = "-".join(p for p in (view, ids_suffix) if p)
            filename = build_filename(
                source="smithsonian",
                source_id=usnm_clean,
                subject_state="specimen",
                common_name="",
                scientific=sci,
                suffix_hint=view_hint,
            )
            rec_jobs.append({
                "url": url,
                "out_path": IMG_DIR / filename,
                "thumb_path": THUMB_DIR / filename,
                "medium_path": MEDIUM_DIR / filename,
                "min_edge": 1000,
                "max_bytes": 12_000_000,  # tighter cap; Screen Images are <1MB
                "_meta": {
                    "image_id": image_id, "filename": filename,
                    "view": view, "url": url,
                },
            })

        if not rec_jobs: continue
        downloads = parallel_download(S, rec_jobs, max_workers=MAX_WORKERS)
        any_kept_this_record = False
        for job, (_item, dl) in zip(rec_jobs, downloads):
            if dl is None: continue
            m = job["_meta"]
            mw.write({
                "image_id": m["image_id"],
                "collection_id": collection_id,
                "source": "smithsonian",
                "source_id": usnm_clean,
                "source_page_url": record_link,
                "image_url": m["url"],
                "filename": f"images/{m['filename']}",
                "thumbnail_filename": f"thumbnails/{m['filename']}",
                "medium_filename": f"medium/{m['filename']}",
                "file_size_bytes": dl["file_size_bytes"],
                "file_sha256": dl["file_sha256"],
                "width": dl["width"],
                "height": dl["height"],
                "license": "cc0-1.0",
                "license_url": "https://creativecommons.org/publicdomain/zero/1.0/",
                "photographer_attribution": credit,
                "photographer": "",
                "institution": "Smithsonian NMNH — Department of Entomology",
                "taxon_order": order,
                "taxon_subgroup": classify_subgroup(order, []),
                "taxon_species": sci,
                "common_name": "",
                "subject_state": "specimen",
                "view_label": m["view"],
                "life_stage": "adult",
                "sex": "",
                "host_organism": "",
                "specimen_condition": "Preserved (museum specimen)",
                "description": "",
                "captured_date": date_str,
                "raw_metadata": json.dumps(rec, separators=(",", ":")),
            })
            kept_media += 1
            any_kept_this_record = True
        if any_kept_this_record:
            kept_records += 1
            if (kept_records % 25) == 0:
                log.info("Smithsonian %d/%d records  (%d images, %d view-skipped)",
                         kept_records, TARGET_RECORDS, kept_media, skipped_view)
    mw.close()
    log.info("DONE Smithsonian. records=%d / %d  images=%d  view-skipped=%d",
             kept_records, TARGET_RECORDS, kept_media, skipped_view)
    return 0 if kept_records > 0 else 2


if __name__ == "__main__":
    sys.exit(main())
