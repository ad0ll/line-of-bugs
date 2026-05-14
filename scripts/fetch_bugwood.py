"""Fetch ~1000 insect images from Bugwood (api.bugwoodcloud.org).

Production refactor (2026-05-14):
  * Pass `target` now respects existing manifest rows matching that pass's
    (license, subject_type) — fixes the "double-pull" bug.
  * Detail fetch (/image/{id}) per record provides specimen{} + dateacquired
    needed for collection_id.
  * Image downloads (and thumbnail generation) parallelized via
    parallel_download (6 workers).
  * Consecutive-failure guard on the listing endpoint.
  * Per-pass summary + non-zero exit on no progress.
"""
from __future__ import annotations
import re
import sys
import time
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import (
    session, ManifestWriter, IMG_DIR, THUMB_DIR,
    parallel_download, ConsecutiveFailureGuard,
    manifest_count_by, setup_logging, build_filename, slugify,
)

log = setup_logging("bugwood")
S = session()
BASE = "https://api.bugwoodcloud.org/v2"
MAX_WORKERS = 6

INSECT_ORDER_IDS = "39,131,98,92,58,159,121,155,238,369,152,139,52,220,169,341,189,137,340,142,347,343,40,346"
GOOD_DESCRIPTORS = "7,9,57,47,8,77"

PASSES = [
    ("nature",   "2,3", "cc-by-3.0",    "https://creativecommons.org/licenses/by/3.0/us/", 420),
    ("nature",   "1,4", "cc-by-nc-3.0", "https://creativecommons.org/licenses/by-nc/3.0/us/", 280),
    ("specimen", "2,3", "cc-by-3.0",    "https://creativecommons.org/licenses/by/3.0/us/", 180),
    ("specimen", "1,4", "cc-by-nc-3.0", "https://creativecommons.org/licenses/by-nc/3.0/us/", 120),
]

MATING_PATTERNS = re.compile(
    r"\b(mating|copul|courtship|swarm|aggregation|cluster of|colony of|"
    r"group of|multiple adults?|pair (of|on)|couple of|two adults?|three adults?|"
    r"infestation|damage|galler(y|ies))\b",
    re.I,
)

ORDER_HINTS = [
    (re.compile(r"\b(beetle|weevil|chrysomel|carab|cerambycid|curculion|scarab|coccin)", re.I), "Coleoptera"),
    (re.compile(r"\b(moth|butterfly|skipper|caterpillar|lepidopt|sphing|noctu|geometr|tortr|pyral|nymph(al)?id)", re.I), "Lepidoptera"),
    (re.compile(r"\b(bee|wasp|ant|hornet|hymenopt|aphidiid|formic|braconid|ichneumon|chalc|apid|vespid)", re.I), "Hymenoptera"),
    (re.compile(r"\b(stink ?bug|aphid|leafhopper|planthopper|cicada|psyllid|scale|whitefly|hemipt|reduvi|pentatom|cicadellid|aphidid)", re.I), "Hemiptera"),
    (re.compile(r"\b(fly|gnat|midge|mosquito|maggot|dipter|tabanid|tachinid|syrphid|culicid)", re.I), "Diptera"),
    (re.compile(r"\b(dragonfly|damselfly|odonat|libellul|coenagrion)", re.I), "Odonata"),
    (re.compile(r"\b(grasshopper|cricket|locust|katydid|orthopt|acridid|gryllid|tettigon)", re.I), "Orthoptera"),
    (re.compile(r"\b(mantis|mantid|mantodea)", re.I), "Mantodea"),
    (re.compile(r"\b(termite|isopter|reticulit)", re.I), "Isoptera"),
    (re.compile(r"\b(roach|cockroach|blattod|blatell)", re.I), "Blattodea"),
    (re.compile(r"\b(thrips|thysanopter)", re.I), "Thysanoptera"),
    (re.compile(r"\b(lacewing|neuropt|chrysop|antlion)", re.I), "Neuroptera"),
    (re.compile(r"\b(earwig|dermapt)", re.I), "Dermaptera"),
    (re.compile(r"\b(flea|siphonapt|pulicid)", re.I), "Siphonaptera"),
    (re.compile(r"\b(stick insect|walking ?stick|phasmat)", re.I), "Phasmatodea"),
    (re.compile(r"\b(silverfish|firebrat|thysanur)", re.I), "Thysanura"),
    (re.compile(r"\b(stonefly|plecopt)", re.I), "Plecoptera"),
    (re.compile(r"\b(mayfly|ephemeropt)", re.I), "Ephemeroptera"),
    (re.compile(r"\b(caddisfly|trichopt)", re.I), "Trichoptera"),
]


def detect_order(record: dict) -> str:
    text = " ".join(filter(None, [
        record.get("subjectdisplayname") or "",
        record.get("subjectname") or "",
        record.get("scientificname") or "",
    ]))
    for pat, label in ORDER_HINTS:
        if pat.search(text):
            return label
    return ""


def html_strip(s: str) -> str:
    if not s:
        return ""
    return re.sub(r"<[^>]+>", "", s).strip()


def build_collection_id(detail: dict, listing: dict) -> str:
    s = detail.get("specimen") or {}
    repo_num = (s.get("repositorynumber") or "").strip()
    repo = (s.get("repository") or "").strip()
    if repo_num and repo:
        return f"bugwood-specimen-{slugify(repo)}-{slugify(repo_num)}"
    pisid = detail.get("photographerimagesystemid") or 0
    subj = detail.get("subjectid") or listing.get("subjectid") or 0
    descr = detail.get("descriptorid") or 0
    day = (detail.get("dateacquired") or "")[:10]
    return f"bugwood-session-{pisid}-{subj}-{descr}-{slugify(day)}"


def fetch_detail(imgnum: str, backoff_budget: float = 30.0) -> dict:
    start = time.time()
    attempt = 0
    while time.time() - start < backoff_budget:
        try:
            r = S.get(f"{BASE}/image/{imgnum}", timeout=20)
            if r.status_code == 200:
                return r.json() or {}
            if r.status_code in (404, 410):
                return {}
        except Exception:
            pass
        attempt += 1
        time.sleep(min(2 ** attempt, 8))
    return {}


def view_to_label(view: str) -> str:
    if not view: return ""
    v = view.lower()
    if "dorsal" in v: return "dorsal"
    if "lateral" in v: return "lateral"
    if "ventral" in v: return "ventral"
    if "anterior" in v or "apical" in v: return "anterior"
    if "posterior" in v or "basal" in v: return "posterior"
    if "face" in v: return "face"
    if "close-up" in v or "closeup" in v: return "close-up"
    if "oblique" in v: return "oblique"
    return slugify(view)


def run_pass(mw: ManifestWriter, existing_in_bucket: int,
             subject_type: str, license_list: str,
             lic_code: str, lic_url: str, target: int, label: str,
             api_guard: ConsecutiveFailureGuard) -> int:
    """Returns number added in this pass."""
    needed = max(0, target - existing_in_bucket)
    if needed == 0:
        log.info("[%s] already have %d ≥ target %d — skipping",
                 label, existing_in_bucket, target)
        return 0
    log.info("=== bugwood %s (%s)  need %d / target %d ===",
             subject_type, lic_code, needed, target)

    voucher_value = 1 if subject_type == "specimen" else 0
    kept = 0
    page = 1
    while kept < needed:
        params = {
            "division": 1,
            "descriptor": GOOD_DESCRIPTORS,
            "order": INSECT_ORDER_IDS,
            "person": 0,
            "voucher": voucher_value,
            "license": license_list,
            "resolution": "4,5",
            "pagesize": 200,
            "page": page,
        }
        try:
            r = S.get(f"{BASE}/image", params=params, timeout=45)
        except Exception as e:
            log.warning("[%s] http err %s — retry", label, type(e).__name__)
            time.sleep(3)
            if api_guard.failure(): return kept
            continue
        if r.status_code != 200:
            log.warning("[%s] http %d — retry", label, r.status_code)
            time.sleep(2)
            if api_guard.failure(): return kept
            continue
        api_guard.success()
        j = r.json()
        data = j.get("data") or []
        if not data:
            log.info("[%s] exhausted at page %d", label, page)
            break

        # First pass: filter + detail-fetch (sequential, per-image API call)
        page_jobs: list[dict] = []
        for img in data:
            if kept >= needed: break
            imgnum = str(img.get("imagenumber") or "")
            if not imgnum: continue
            image_id = f"bugwood-{slugify(imgnum)}"
            if mw.has(image_id): continue
            desc_clean = html_strip(img.get("description") or "")
            if MATING_PATTERNS.search(desc_clean): continue
            detail = fetch_detail(imgnum)
            collection_id = build_collection_id(detail, img)
            res_str = img.get("maxresolutionpath") or "3072x2048"
            url = f"https://bugwoodcloud.org/images/{res_str}/{imgnum}.jpg"
            subj_name = img.get("subjectname") or img.get("subjectdisplayname") or ""
            scientific = img.get("scientificname") or ""
            if not scientific:
                sd = img.get("subjectdisplayname") or ""
                m = re.search(r"\(([A-Z][a-z]+ [a-z]+(?:[ a-z]+)?)", sd)
                if m: scientific = m.group(1)
            image_view = (img.get("imageview") or "").strip()
            view_label = view_to_label(image_view)
            filename = build_filename(
                source="bugwood",
                source_id=imgnum,
                subject_type=subject_type,
                common_name=subj_name,
                scientific=scientific,
                suffix_hint=view_label,
            )
            page_jobs.append({
                "url": url,
                "out_path": IMG_DIR / filename,
                "thumb_path": THUMB_DIR / filename,
                "min_edge": 1200,
                "_meta": {
                    "img": img, "detail": detail,
                    "image_id": image_id, "collection_id": collection_id,
                    "filename": filename, "scientific": scientific,
                    "subj_name": subj_name, "view_label": view_label,
                    "image_view": image_view, "desc_clean": desc_clean,
                },
            })

        # Fan-out downloads
        downloads = parallel_download(S, page_jobs, max_workers=MAX_WORKERS)
        for job, (_item, dl) in zip(page_jobs, downloads):
            if dl is None:
                # Try smaller resolution variant
                imgnum = job["_meta"]["img"]["imagenumber"]
                url2 = f"https://bugwoodcloud.org/images/1536x1024/{imgnum}.jpg"
                fallback = parallel_download(
                    S, [{"url": url2, "out_path": job["out_path"], "thumb_path": job["thumb_path"], "min_edge": 1000}],
                    max_workers=1,
                )
                dl = fallback[0][1]
                if dl is None: continue
                job["url"] = url2

            m = job["_meta"]; img = m["img"]; detail = m["detail"]
            descriptor_name = (img.get("descriptorname") or "").strip()
            ctx_bits = [b for b in (descriptor_name, m["image_view"]) if b]
            ctx_prefix = " · ".join(ctx_bits)
            description = (f"{ctx_prefix}. {m['desc_clean']}" if ctx_prefix and m["desc_clean"]
                           else (ctx_prefix or m["desc_clean"]))
            citation = (img.get("citation") or "").strip().rstrip(",")
            mw.write({
                "image_id": m["image_id"],
                "collection_id": m["collection_id"],
                "source": "bugwood",
                "source_id": str(img.get("imagenumber") or ""),
                "source_page_url": f"https://www.insectimages.org/browse/detail.cfm?imgnum={img.get('imagenumber')}",
                "image_url": job["url"],
                "filename": f"images/{m['filename']}",
                "thumbnail_filename": f"thumbnails/{m['filename']}",
                "file_size_bytes": dl["file_size_bytes"],
                "file_sha256": dl["file_sha256"],
                "width": dl["width"],
                "height": dl["height"],
                "license": lic_code,
                "license_url": lic_url,
                "photographer_attribution": citation,
                "photographer": img.get("photographer") or "",
                "institution": img.get("organization") or "",
                "taxon_order": detect_order(img),
                "taxon_species": m["scientific"],
                "common_name": m["subj_name"],
                "subject_type": subject_type,
                "view_label": m["view_label"],
                "description": description[:500],
                "captured_date": (detail.get("dateacquired") or "")[:10],
            })
            kept += 1
            if (kept % 25) == 0:
                log.info("[%s] %d / %d", label, kept, needed)
        page += 1
        time.sleep(0.6)
    return kept


def main() -> int:
    mw = ManifestWriter("bugwood")
    log.info("Bugwood: resuming with %d already in manifest", mw.count())

    bucket_counts = manifest_count_by(mw.path, "license", "subject_type")
    api_guard = ConsecutiveFailureGuard(threshold=5, name="bugwood-listing")

    summary: list[tuple[str, int, int, int]] = []
    total_added = 0
    for subject_type, lic_ids, lic_code, lic_url, target in PASSES:
        label = f"{subject_type[:3]}-{lic_code}"
        existing = bucket_counts.get((lic_code, subject_type), 0)
        if api_guard.tripped:
            log.error("api guard tripped; skipping %s", label)
            summary.append((label, target, existing, 0))
            continue
        added = run_pass(mw, existing, subject_type, lic_ids, lic_code, lic_url, target, label, api_guard)
        summary.append((label, target, existing + added, added))
        total_added += added
        log.info("[%s] FINAL +%d (now %d / target %d)", label, added, existing + added, target)
    mw.close()
    log.info("DONE Bugwood. manifest=%d  added_this_run=%d", mw.count(), total_added)
    log.info("── per-pass ── label / target / total_now / added_this_run")
    for label, target, total_now, added in summary:
        log.info("  %-22s  %4d / %4d / %4d", label, target, total_now, added)
    if api_guard.tripped:
        log.error("api guard tripped during run.")
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
