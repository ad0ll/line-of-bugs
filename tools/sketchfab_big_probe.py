"""100-species sweep comparing 4 query strategies against Sketchfab search.

Strategies:
  S1: q=<scientific>
  S2: q=<scientific> + categories=animals-pets
  S3: q=<common>
  S4: q=<common> + categories=animals-pets

For each (species, strategy) pair we record:
  - hit_count (first page only — count<=24)
  - top_5 hits with name, user, tags, categories
  - relevance flag (binomial present in metadata)

Reads SKETCHFAB_API_KEY from .env.local. Writes /tmp/sketchfab_big_probe.json.
Concurrent (8 workers).
"""

from __future__ import annotations

import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[1]
ENV_PATH = ROOT / ".env.local"
SAMPLE_PATH = Path("/tmp/big_species_sample.tsv")


def load_api_key() -> str:
    for line in ENV_PATH.read_text().splitlines():
        if line.startswith("SKETCHFAB_API_KEY="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise SystemExit("no key")


def load_sample() -> list[tuple[str, str, int, str]]:
    rows = []
    for ln in SAMPLE_PATH.read_text().splitlines():
        if not ln.strip():
            continue
        parts = ln.split("\t")
        if len(parts) < 4:
            continue
        sci, com, n, tier = parts[0], parts[1], int(parts[2]), parts[3]
        rows.append((sci, com, n, tier))
    return rows


def is_relevant(hit: dict, scientific: str, common: str) -> bool:
    """Loose insect-correctness check: binomial OR (insect signal + name overlap)."""
    text = " ".join(
        [
            hit.get("name", "") or "",
            hit.get("description", "") or "",
            " ".join(t.get("name", "") for t in hit.get("tags", [])),
            " ".join(c.get("name", "") for c in hit.get("categories", [])),
        ]
    ).lower()
    sci_tokens = scientific.lower().split()
    if len(sci_tokens) >= 2 and sci_tokens[0] in text and sci_tokens[-1] in text:
        return True
    if common.lower() in text:
        return True
    insect_hints = {"insect", "bug", "beetle", "butterfly", "moth", "bee", "wasp",
                    "ant", "fly", "grasshopper", "cricket", "mantis", "ladybug",
                    "weevil", "dragonfly", "entomology", "arthropod"}
    has_insect = any(h in text for h in insect_hints)
    common_tokens = [t for t in common.lower().split() if len(t) >= 5]
    has_name_overlap = (
        (sci_tokens and sci_tokens[0] in text)
        or any(t in text for t in common_tokens)
    )
    return has_insect and has_name_overlap


def query(session: requests.Session, params: dict) -> dict:
    try:
        r = session.get("https://api.sketchfab.com/v3/search", params=params, timeout=20)
        if r.status_code == 429:
            return {"status": 429, "results": [], "next": None}
        r.raise_for_status()
        d = r.json()
        return {"status": 200, "results": d.get("results", []), "next": d.get("next")}
    except Exception as e:
        return {"status": -1, "error": str(e), "results": [], "next": None}


STRATEGIES = [
    ("S1_sci",        lambda sci, com: {"type": "models", "q": sci, "count": 5}),
    ("S2_sci_cat",    lambda sci, com: {"type": "models", "q": sci, "categories": "animals-pets", "count": 5}),
    ("S3_com",        lambda sci, com: {"type": "models", "q": com, "count": 5}),
    ("S4_com_cat",    lambda sci, com: {"type": "models", "q": com, "categories": "animals-pets", "count": 5}),
]


def main() -> None:
    api_key = load_api_key()
    sample = load_sample()
    print(f"loaded {len(sample)} species", file=sys.stderr)

    session = requests.Session()
    session.headers["Authorization"] = f"Token {api_key}"

    # 100 species × 4 strategies = 400 requests
    jobs = []
    for sci, com, n, tier in sample:
        for strat_name, build in STRATEGIES:
            jobs.append((sci, com, n, tier, strat_name, build(sci, com)))

    print(f"submitting {len(jobs)} jobs", file=sys.stderr)
    t0 = time.time()
    results: list[dict] = []
    with ThreadPoolExecutor(max_workers=8) as ex:
        futs = {ex.submit(query, session, j[5]): j for j in jobs}
        for i, f in enumerate(as_completed(futs)):
            sci, com, n, tier, strat, params = futs[f]
            res = f.result()
            hits = res["results"]
            top_relevant = sum(1 for h in hits if is_relevant(h, sci, com))
            results.append({
                "scientific": sci,
                "common": com,
                "image_count": n,
                "tier": tier,
                "strategy": strat,
                "status": res["status"],
                "hit_count": len(hits),
                "top_relevant": top_relevant,
                "hits": [
                    {
                        "uid": h.get("uid"),
                        "name": h.get("name"),
                        "user": (h.get("user") or {}).get("username"),
                        "tags": [t.get("name") for t in h.get("tags", [])][:8],
                        "categories": [c.get("name") for c in h.get("categories", [])],
                        "thumbnail_256": next(
                            (img["url"] for img in (h.get("thumbnails") or {}).get("images", [])
                             if img.get("width") == 256),
                            None,
                        ),
                        "embedUrl": h.get("embedUrl"),
                        "viewerUrl": h.get("viewerUrl"),
                        "license": (h.get("license") or {}).get("slug") if isinstance(h.get("license"), dict) else None,
                        "isDownloadable": h.get("isDownloadable"),
                    }
                    for h in hits
                ],
            })
            if (i + 1) % 50 == 0:
                print(f"  {i+1}/{len(jobs)} done", file=sys.stderr)
    elapsed = time.time() - t0
    print(f"done in {elapsed:.1f}s", file=sys.stderr)

    Path("/tmp/sketchfab_big_probe.json").write_text(json.dumps(results, indent=2))

    # Aggregate per (tier, strategy)
    from collections import defaultdict
    agg = defaultdict(lambda: {"n_species": 0, "n_any_hit": 0, "n_any_relevant": 0, "total_hits": 0})
    for r in results:
        k = (r["tier"], r["strategy"])
        agg[k]["n_species"] += 1
        if r["hit_count"] > 0:
            agg[k]["n_any_hit"] += 1
        if r["top_relevant"] > 0:
            agg[k]["n_any_relevant"] += 1
        agg[k]["total_hits"] += r["hit_count"]

    print("\n" + "=" * 95)
    print(f"{'tier':8s} {'strategy':12s} {'species':>8s} {'≥1 hit':>8s} {'≥1 rel':>8s} {'total_hits':>11s} {'precision':>10s}")
    print("=" * 95)
    for (tier, strat), a in sorted(agg.items()):
        prec = (a["n_any_relevant"] / max(1, a["n_any_hit"])) * 100
        print(f"{tier:8s} {strat:12s} {a['n_species']:>8d} {a['n_any_hit']:>8d} {a['n_any_relevant']:>8d} {a['total_hits']:>11d} {prec:>9.1f}%")

    print("\nRaw: /tmp/sketchfab_big_probe.json", file=sys.stderr)


if __name__ == "__main__":
    main()
