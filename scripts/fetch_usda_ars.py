"""Scrape USDA-ARS Image Gallery for public-domain insect photos.

Production refactor (2026-05-14):
  * Fail-fast on consecutive page-fetch failures (DNS/connection errors won't
    cause an 11-minute spin anymore — bails after a few in a row).
  * Parallel detail-page fetches + image downloads (3 workers; IIS server is
    smaller than CDN, be polite).
  * Per-source summary + non-zero exit when no progress.
  * collection_id = usda-<K-prefix>  (siblings = "same research story",
    not necessarily same subject).
"""
from __future__ import annotations
import json
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import (
    session, ManifestWriter, IMG_DIR, THUMB_DIR, MEDIUM_DIR,
    parallel_download, ConsecutiveFailureGuard,
    setup_logging, build_filename, slugify,
)

log = setup_logging("usda-ars")
S = session()
SITE = "https://www.ars.usda.gov"
INSECTS_GALLERY = f"{SITE}/oc/images/photos/photos-insects/"
FEATURED_GALLERY = f"{SITE}/oc/images/photos/photos-featured-photo/"
FIELD_GALLERY = f"{SITE}/oc/images/photos/photos-field-research/"
MONTHLY_ARCHIVES = [
    "aug97", "aug98", "dec97", "feb00", "mar00", "mar98", "jan98",
    "jul16", "sep07", "mar04", "jul09", "may19", "sep19", "apr14",
    "oct00", "mar99", "nov22",
]
TARGET = 150
MAX_WORKERS = 3

INSECT_KEYWORDS = re.compile(
    r"\b(insect|bee|honey ?bee|bumble ?bee|wasp|hornet|ant|fire ant|"
    r"beetle|weevil|borer|moth|butterfly|skipper|fly|maggot|gnat|midge|"
    r"mosquito|aphid|leafhopper|planthopper|scale insect|whitefly|"
    r"caterpillar|larva|grub|pupa|cocoon|"
    r"locust|grasshopper|cricket|katydid|mantis|mantid|"
    r"dragonfly|damselfly|cicada|stink bug|true bug|"
    r"earwig|silverfish|firebrat|stonefly|mayfly|caddisfly|"
    r"thrips|psyllid|leafminer|leaf miner|sawfly)\b",
    re.I,
)
EXCLUDE_KEYWORDS = re.compile(
    r"\b(spider|tick|mite|scorpion|harvestman|centipede|millipede|"
    r"chigger|deer tick)\b", re.I,
)
MATING_PATTERNS = re.compile(
    r"\b(mating|copul|swarm|cluster of|group of|multiple|several|pair of|"
    r"two adults?|three adults?|in tandem)\b", re.I,
)

THUMB_RE = re.compile(
    r'<img\s+src="(/ARSUserFiles/oc/(?:images|graphics)/photos/(?:[a-z]{3}\d{2}/)?[KkDd]\d+-\d+x\.jpg)"'
    r'[^>]*alt="([^"]*)"', re.I,
)
IMGNUM_RE = re.compile(r"Image Number\s+([KkDd]\d+-\d+)", re.I)
PHOTO_BY_RE = re.compile(r"Photo by ([^<.]+?)\.", re.I)
HIRES_RE = re.compile(
    r'href="(/ARSUserFiles/oc/graphics/photos/300dpi/[^"]+\.jpg)"', re.I,
)
INLINE_IMG_RE = re.compile(
    r'<img\s+src="(/ARSUserFiles/oc/graphics/photos/(?:[a-z]{3}\d{2}/)?[KkDd]\d+-\d+i\.jpg)"',
    re.I,
)
MEDIUM_URL_RE = re.compile(r'640 pixels wide:\s*\(<a href="([^"]*)"', re.I)
CAPTION_RE = re.compile(
    r"</table>\s*(.*?)(?=<p[^>]*>\s*Photo by|<pre|<hr)", re.I | re.DOTALL,
)
COURTESY_RE = re.compile(r"\bCourtesy\b", re.I)
HTML_TAG_RE = re.compile(r"<[^>]+>")


def detail_url_from_thumb(thumb_src: str) -> str:
    p = re.sub(r"x\.jpg$", "", thumb_src, flags=re.I)
    p = re.sub(r"^/ARSUserFiles/oc/(?:images|graphics)/photos/",
               "/oc/images/photos/", p, flags=re.I)
    return p


def collect_candidates() -> tuple[list[tuple[str, str]], bool]:
    """Walk the gallery / featured / field-research / monthly archives,
    pulling unique detail-page URLs. Returns (candidates, ok_flag)."""
    pages = [INSECTS_GALLERY, FEATURED_GALLERY, FIELD_GALLERY] + \
            [f"{SITE}/oc/images/photos/{m}/" for m in MONTHLY_ARCHIVES]
    seen: set[str] = set()
    out: list[tuple[str, str]] = []
    guard = ConsecutiveFailureGuard(threshold=3, name="usda-pages")
    for page_url in pages:
        try:
            r = S.get(page_url, timeout=30)
        except Exception as e:
            log.warning("page fail %s: %s", page_url, type(e).__name__)
            if guard.failure():
                log.error("too many consecutive page-fetch failures; aborting candidate walk")
                return out, False
            continue
        if r.status_code != 200:
            log.warning("page %s http %d", page_url, r.status_code)
            if guard.failure(): return out, False
            continue
        guard.success()
        page_keep = 0
        for m in THUMB_RE.finditer(r.text):
            thumb = m.group(1)
            alt = m.group(2) or ""
            detail = detail_url_from_thumb(thumb)
            if detail in seen: continue
            if page_url == INSECTS_GALLERY:
                pass  # all on insects page are insects
            else:
                if not INSECT_KEYWORDS.search(alt): continue
                if EXCLUDE_KEYWORDS.search(alt): continue
            seen.add(detail)
            out.append((SITE + detail, alt))
            page_keep += 1
        log.info("scanned %s: kept %d", page_url, page_keep)
        time.sleep(0.6)
    return out, True


def parse_detail(html: str) -> dict | None:
    if COURTESY_RE.search(html):
        return None
    m_id = IMGNUM_RE.search(html)
    if not m_id: return None
    imgnum = m_id.group(1).upper()
    m_caps = CAPTION_RE.search(html)
    caption = ""
    if m_caps:
        caption = HTML_TAG_RE.sub(" ", m_caps.group(1)).strip()
        caption = re.sub(r"\s+", " ", caption)
    if MATING_PATTERNS.search(caption): return None
    photog = ""
    m_ph = PHOTO_BY_RE.search(html)
    if m_ph: photog = m_ph.group(1).strip()
    if not photog: return None
    hires_match = HIRES_RE.search(html)
    medium_match = MEDIUM_URL_RE.search(html)
    inline_match = INLINE_IMG_RE.search(html)
    hires = SITE + hires_match.group(1) if hires_match else None
    medium = None
    if medium_match and medium_match.group(1):
        medium = SITE + medium_match.group(1)
    elif inline_match:
        derived = re.sub(r"i\.jpg$", ".jpg", inline_match.group(1))
        medium = SITE + derived
    return {"imgnum": imgnum, "caption": caption, "photographer": photog,
            "hires": hires, "medium": medium}


def fetch_detail_html(url: str) -> str | None:
    try:
        r = S.get(url, timeout=30)
        if r.status_code == 200:
            return r.text
    except Exception:
        pass
    return None


def main() -> int:
    mw = ManifestWriter("usda_ars")
    log.info("USDA-ARS: resuming with %d already", mw.count())
    candidates, ok = collect_candidates()
    log.info("USDA-ARS: %d candidate detail URLs (ok=%s)", len(candidates), ok)
    if not ok:
        return 2
    if not candidates:
        log.error("no candidates collected — likely a sitemap or network issue")
        return 2

    # Parallel detail-page fetch (3 workers — polite)
    detail_data: dict[str, str] = {}
    detail_guard = ConsecutiveFailureGuard(threshold=5, name="usda-detail")
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as ex:
        futures = {ex.submit(fetch_detail_html, u): (u, alt) for u, alt in candidates}
        for fut in as_completed(futures):
            url, alt = futures[fut]
            html = fut.result()
            if html is None:
                if detail_guard.failure():
                    log.error("too many detail-fetch failures; aborting")
                    return 2
                continue
            detail_guard.success()
            detail_data[url] = html

    log.info("fetched %d detail pages", len(detail_data))

    # Build download jobs from parsed details (sequential parse, parallel download)
    jobs: list[dict] = []
    for url, alt in candidates:
        if len(jobs) >= TARGET: break
        html = detail_data.get(url)
        if not html: continue
        info = parse_detail(html)
        if not info: continue
        imgnum = info["imgnum"]
        image_id = f"usda-{slugify(imgnum)}"
        if mw.has(image_id): continue
        collection_id = "usda-" + imgnum.rsplit("-", 1)[0]
        image_url = info["hires"] or info["medium"]
        if not image_url: continue
        filename = build_filename(
            source="usda-ars",
            source_id=imgnum,
            subject_state="wild",
            common_name=alt,
            scientific="",
        )
        jobs.append({
            "url": image_url,
            "out_path": IMG_DIR / filename,
            "thumb_path": THUMB_DIR / filename,
            "medium_path": MEDIUM_DIR / filename,
            "min_edge": 1200,
            "_meta": {
                "image_id": image_id, "collection_id": collection_id,
                "imgnum": imgnum, "info": info, "alt": alt,
                "filename": filename, "detail_url": url,
            },
        })

    log.info("USDA-ARS: %d download jobs", len(jobs))
    downloads = parallel_download(S, jobs, max_workers=MAX_WORKERS)
    kept = 0
    for job, (_item, dl) in zip(jobs, downloads):
        if dl is None:
            # Fallback to medium-res
            info = job["_meta"]["info"]
            if info["medium"] and info["medium"] != job["url"]:
                fb = parallel_download(S, [{
                    "url": info["medium"],
                    "out_path": job["out_path"], "thumb_path": job["thumb_path"],
                    "min_edge": 900,
                }], max_workers=1)
                dl = fb[0][1]
                if dl is None: continue
                job["url"] = info["medium"]
            else:
                continue
        m = job["_meta"]; info = m["info"]
        mw.write({
            "image_id": m["image_id"],
            "collection_id": m["collection_id"],
            "source": "usda-ars",
            "source_id": m["imgnum"],
            "source_page_url": m["detail_url"],
            "image_url": job["url"],
            "filename": f"images/{m['filename']}",
            "thumbnail_filename": f"thumbnails/{m['filename']}",
            "medium_filename": f"medium/{m['filename']}",
            "file_size_bytes": dl["file_size_bytes"],
            "file_sha256": dl["file_sha256"],
            "width": dl["width"],
            "height": dl["height"],
            "license": "public-domain-usgov",
            "license_url": "https://www.usa.gov/government-works",
            "photographer_attribution": f"Photo by {info['photographer']}, USDA-ARS",
            "photographer": info["photographer"],
            "institution": "USDA Agricultural Research Service",
            "taxon_order": "",
            "taxon_species": "",
            "common_name": m["alt"],
            "subject_state": "wild",
            "view_label": "",
            "life_stage": "",
            "sex": "",
            "host_organism": "",
            "specimen_condition": "",
            "description": info["caption"],
            "captured_date": "",
            "raw_metadata": json.dumps(info, separators=(",", ":")),
        })
        kept += 1
        if (kept % 10) == 0:
            log.info("USDA-ARS  %d / %d", kept, TARGET)
    mw.close()
    log.info("DONE USDA-ARS. total=%d  added_this_run=%d", mw.count(), kept)
    return 0 if kept > 0 else 2


if __name__ == "__main__":
    sys.exit(main())
