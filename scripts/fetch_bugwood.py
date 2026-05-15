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
import json
import re
import sys
import time
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import (
    session, ManifestWriter, IMG_DIR, THUMB_DIR, MEDIUM_DIR,
    parallel_download, ConsecutiveFailureGuard,
    manifest_count_by, setup_logging, build_filename, slugify,
)

log = setup_logging("bugwood")
S = session()
BASE = "https://api.bugwoodcloud.org/v2"
MAX_WORKERS = 6

# Order IDs split into 2 batches of 12 because Bugwood's API Gateway / Lambda
# backend reliably 504s when the order= filter has all 24 IDs (29 s timeout,
# 3/3 trials). Batches of ≤22 work; 22 sits at the edge so we use 12 for safety
# margin (each request returns in ~5-7 s, ~0.6 s after Lambda warm-up).
# Verified empirically 2026-05-14.
INSECT_ORDER_BATCHES = [
    "39,131,98,92,58,159,121,155,238,369,152,139",   # 12 IDs: big orders + Mantodea/Neuroptera
    "52,220,169,341,189,137,340,142,347,343,40,346", # 12 IDs: smaller orders + Collembola/Microcoryphia
]
GOOD_DESCRIPTORS = "7,9,57,47,8,77"

# Bugwood descriptorname → normalized life_stage enum.
# `Multiple Life Stages` is excluded by GOOD_DESCRIPTORS, so we don't map it.
BUGWOOD_DESCRIPTOR_TO_LIFE_STAGE = {
    "Adult(s)": "adult",
    "Larva(e)": "larva",
    "Nymph(s)": "nymph",
    "Pupa(e)": "pupa",
    "Egg(s)": "egg",
    "Cocoon(s)": "cocoon",
    "Immature(s)": "juvenile",
}
BUGWOOD_GENDER_TO_SEX = {
    "Male": "male", "Female": "female", "Worker": "worker",
    "male": "male", "female": "female", "worker": "worker",
}

PASSES = [
    # Round 4 (2026-05-15): bumped targets ~11x to grow Bugwood by ~10k.
    # division=1 + the curated ORDER_BATCHES below should keep us strictly
    # in Insecta — the `detect_order` guard rejects records that don't
    # match any known insect-order keyword (belt + suspenders against
    # arachnids slipping in).
    ("wild",     "2,3", "cc-by-3.0",    "https://creativecommons.org/licenses/by/3.0/us/", 5000),
    ("wild",     "1,4", "cc-by-nc-3.0", "https://creativecommons.org/licenses/by-nc/3.0/us/", 3500),
    ("specimen", "2,3", "cc-by-3.0",    "https://creativecommons.org/licenses/by/3.0/us/", 1800),
    ("specimen", "1,4", "cc-by-nc-3.0", "https://creativecommons.org/licenses/by-nc/3.0/us/", 1300),
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
             subject_state: str, license_list: str,
             lic_code: str, lic_url: str, target: int, label: str,
             api_guard: ConsecutiveFailureGuard) -> int:
    """Returns number added in this pass.
    Round-robins across order-ID batches for taxonomic variety + to keep
    each request under Bugwood's backend timeout."""
    needed = max(0, target - existing_in_bucket)
    if needed == 0:
        log.info("[%s] already have %d ≥ target %d — skipping",
                 label, existing_in_bucket, target)
        return 0
    log.info("=== bugwood %s (%s)  need %d / target %d ===",
             subject_state, lic_code, needed, target)

    voucher_value = 1 if subject_state == "specimen" else 0
    kept = 0
    pages_per_batch = [1] * len(INSECT_ORDER_BATCHES)
    exhausted = [False] * len(INSECT_ORDER_BATCHES)
    while kept < needed and not all(exhausted):
      for batch_idx, order_batch in enumerate(INSECT_ORDER_BATCHES):
        if kept >= needed or exhausted[batch_idx]:
            continue
        params = {
            "division": 1,
            "descriptor": GOOD_DESCRIPTORS,
            "order": order_batch,
            "person": 0,
            "voucher": voucher_value,
            "license": license_list,
            "resolution": "4,5",
            "pagesize": 200,
            "page": pages_per_batch[batch_idx],
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
            exhausted[batch_idx] = True
            continue

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
            # Spider/arachnid guard: skip records that don't map to a known
            # insect order. detect_order() only matches insect-order keywords;
            # anything else (including any arachnids that may have slipped
            # through division=1) returns "" and gets rejected here.
            if not detect_order(img):
                continue
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
                subject_state=subject_state,
                common_name=subj_name,
                scientific=scientific,
                suffix_hint=view_label,
            )
            page_jobs.append({
                "url": url,
                "out_path": IMG_DIR / filename,
                "thumb_path": THUMB_DIR / filename,
                "medium_path": MEDIUM_DIR / filename,
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
            descriptor_name = (img.get("descriptorname") or detail.get("descriptorname") or "").strip()
            ctx_bits = [b for b in (descriptor_name, m["image_view"]) if b]
            ctx_prefix = " · ".join(ctx_bits)
            description = (f"{ctx_prefix}. {m['desc_clean']}" if ctx_prefix and m["desc_clean"]
                           else (ctx_prefix or m["desc_clean"]))
            citation = (img.get("citation") or "").strip().rstrip(",")
            spec = detail.get("specimen") or {}
            host_organism = (img.get("hostname") or detail.get("hostname") or "").strip()
            gendercaste = (img.get("gendercaste") or detail.get("gendercaste") or
                           detail.get("gender") or "").strip()
            mw.write({
                "image_id": m["image_id"],
                "collection_id": m["collection_id"],
                "source": "bugwood",
                "source_id": str(img.get("imagenumber") or ""),
                "source_page_url": f"https://www.insectimages.org/browse/detail.cfm?imgnum={img.get('imagenumber')}",
                "image_url": job["url"],
                "filename": f"images/{m['filename']}",
                "thumbnail_filename": f"thumbnails/{m['filename']}",
                "medium_filename": f"medium/{m['filename']}",
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
                "subject_state": subject_state,
                "view_label": m["view_label"],
                "life_stage": BUGWOOD_DESCRIPTOR_TO_LIFE_STAGE.get(descriptor_name, ""),
                "sex": BUGWOOD_GENDER_TO_SEX.get(gendercaste, ""),
                "host_organism": host_organism,
                "specimen_condition": (spec.get("specimencondition") or "").strip(),
                "description": description,
                "captured_date": (detail.get("dateacquired") or "")[:10],
                "raw_metadata": json.dumps({"listing": img, "detail": detail}, separators=(",", ":")),
            })
            kept += 1
            if (kept % 25) == 0:
                log.info("[%s] %d / %d", label, kept, needed)
        pages_per_batch[batch_idx] += 1
        time.sleep(0.5)
    return kept


def main() -> int:
    mw = ManifestWriter("bugwood")
    log.info("Bugwood: resuming with %d already in manifest", mw.count())

    bucket_counts = manifest_count_by(mw.path, "license", "subject_state")
    api_guard = ConsecutiveFailureGuard(threshold=5, name="bugwood-listing")

    summary: list[tuple[str, int, int, int]] = []
    total_added = 0
    for subject_state, lic_ids, lic_code, lic_url, target in PASSES:
        label = f"{subject_state[:3]}-{lic_code}"
        existing = bucket_counts.get((lic_code, subject_state), 0)
        if api_guard.tripped:
            log.error("api guard tripped; skipping %s", label)
            summary.append((label, target, existing, 0))
            continue
        added = run_pass(mw, existing, subject_state, lic_ids, lic_code, lic_url, target, label, api_guard)
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
