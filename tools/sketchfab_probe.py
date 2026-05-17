"""One-shot probe: query Sketchfab Search API for a sample of species, then
verify each top hit against the single-model API endpoint (which returns the
same fields the public page displays — public HTML is gated by a 202 anti-bot
challenge so direct page scraping returns 0 bytes).

Reads SKETCHFAB_API_KEY from .env.local. Prints structured findings to stdout
and dumps raw JSON to /tmp/sketchfab_probe.json.

Delete after the probe is finished — not a long-lived utility.
"""

from __future__ import annotations

import json
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field, asdict
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[1]
ENV_PATH = ROOT / ".env.local"

# Mix: iconic, mid-tier, and obscure species drawn from the DB.
SAMPLE: list[tuple[str, str, str]] = [
    # (scientific, common, tier)
    ("Apis mellifera", "Western Honey Bee", "iconic"),
    ("Danaus plexippus", "Monarch", "iconic"),
    ("Bombus impatiens", "Common Eastern Bumble Bee", "iconic"),
    ("Dynastes tityus", "eastern Hercules beetle", "iconic"),
    ("Carausius morosus", "Indian Walking Stick", "iconic"),
    ("Lucanus capreolus", "Reddish-brown Stag Beetle", "iconic"),
    # mid-tier (might exist)
    ("Euptoieta claudia", "Variegated Fritillary", "mid"),
    ("Anthrenus scrophulariae", "carpet beetle", "mid"),
    ("Vanessa itea", "Yellow Admiral", "mid"),
    ("Coccinella undecimpunctata", "Eleven-spotted Ladybird Beetle", "mid"),
    # obscure (unlikely to have models)
    ("Culex tarsalis", "Western Encephalitis Mosquito", "obscure"),
    ("Amblycerus dispar", "seed bruchid beetle", "obscure"),
    ("Chlorophorus strobilicola", "pine cone cerambycid", "obscure"),
    ("Anthonomus consors", "cherry curculio", "obscure"),
    ("Lycomorpha pholus", "Black-and-yellow Lichen Moth", "obscure"),
    ("Trimerotropis pallidipennis", "Pallid-winged Grasshopper", "obscure"),
]

INSECT_HINTS = {
    "insect", "insects", "insecta", "bug", "bugs", "entomology",
    "arthropod", "arthropoda", "beetle", "butterfly", "moth", "bee",
    "wasp", "ant", "spider", "fly", "grasshopper", "cricket",
    "dragonfly", "mantis", "ladybug", "ladybird", "weevil",
    "caterpillar", "larva", "pollinator", "pollinators",
}


def load_api_key() -> str:
    for line in ENV_PATH.read_text().splitlines():
        line = line.strip()
        if line.startswith("SKETCHFAB_API_KEY="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise RuntimeError("SKETCHFAB_API_KEY not in .env.local")


@dataclass
class Hit:
    uid: str
    name: str
    user: str
    description: str
    tags: list[str]
    categories: list[str]
    relevance: str = "?"          # "match" | "likely" | "ambiguous" | "false_positive"
    relevance_reason: str = ""


@dataclass
class QueryResult:
    query: str
    kind: str  # "scientific" | "common"
    total_walked: int | None
    hits: list[Hit] = field(default_factory=list)
    error: str | None = None


def search(session: requests.Session, query: str) -> tuple[list[dict], int | None]:
    """Returns (first-page hits, walked total).

    Walks pages until exhausted (cap at 240) for a real total estimate.
    """
    url = "https://api.sketchfab.com/v3/search"
    params = {"type": "models", "q": query, "count": 24}
    first_page: list[dict] = []
    seen = 0
    pages = 0
    next_url: str | None = None
    try:
        while True:
            r = session.get(next_url, timeout=20) if next_url else session.get(url, params=params, timeout=20)
            r.raise_for_status()
            data = r.json()
            results = data.get("results", [])
            if pages == 0:
                first_page = results[:5]
            seen += len(results)
            pages += 1
            next_url = data.get("next")
            if not next_url or pages >= 10 or seen >= 240:
                break
        return first_page, seen
    except Exception:
        return [], None


def fetch_model(session: requests.Session, uid: str) -> dict | None:
    """Fetch the full single-model API record."""
    try:
        r = session.get(f"https://api.sketchfab.com/v3/models/{uid}", timeout=20)
        if r.status_code != 200:
            return None
        return r.json()
    except Exception:
        return None


def classify_relevance(scientific: str, common: str, hit: Hit) -> tuple[str, str]:
    """Heuristic: does this hit plausibly depict the queried insect?"""
    text = " ".join(
        [hit.name, hit.description, " ".join(hit.tags), " ".join(hit.categories)]
    ).lower()
    sci_genus = scientific.split()[0].lower() if scientific else ""
    sci_species = scientific.split()[-1].lower() if scientific else ""
    common_lower = common.lower()

    # Strongest signal: scientific binomial appears in metadata
    if sci_genus and sci_species and (sci_genus in text and sci_species in text):
        return "match", f"binomial '{scientific}' in metadata"

    # Strong: full common name appears
    if common_lower and common_lower in text:
        return "match", f"common name '{common}' in metadata"

    # Insect-context signals + partial name overlap
    has_insect_signal = any(h in text for h in INSECT_HINTS)
    has_partial_name = (
        (sci_genus and sci_genus in text)
        or any(tok in text for tok in common_lower.split() if len(tok) >= 5)
    )

    if has_insect_signal and has_partial_name:
        return "likely", "insect-context + partial name overlap"
    if has_insect_signal:
        return "ambiguous", "insect-context but no name overlap"

    # No insect signal at all and no binomial → almost certainly fuzzy match
    if not has_insect_signal:
        return "false_positive", "no insect signal in tags/desc/categories"

    return "ambiguous", "unclear"


def main() -> None:
    api_key = load_api_key()
    session = requests.Session()
    session.headers.update({"Authorization": f"Token {api_key}"})

    # Phase 1: search (parallel, 2 queries per species)
    queries: list[tuple[str, str, str, str]] = []
    for sci, common, tier in SAMPLE:
        queries.append((sci, "scientific", sci, common))
        queries.append((common, "common", sci, common))

    results: dict[tuple[str, str], QueryResult] = {}
    with ThreadPoolExecutor(max_workers=6) as ex:
        futs = {ex.submit(search, session, q): (q, kind, sci, common) for q, kind, sci, common in queries}
        for f in as_completed(futs):
            q, kind, sci, common = futs[f]
            first_page, total = f.result()
            qr = QueryResult(query=q, kind=kind, total_walked=total)
            for raw in first_page:
                qr.hits.append(
                    Hit(
                        uid=raw.get("uid", ""),
                        name=raw.get("name", "") or "",
                        user=(raw.get("user") or {}).get("username", ""),
                        description=(raw.get("description") or "").strip(),
                        tags=[t.get("name", "") for t in raw.get("tags", [])],
                        categories=[],  # filled in phase 2
                    )
                )
            results[(q, kind)] = qr

    # Phase 2: enrich top hit per query via single-model endpoint (categories,
    # confirmation that the page metadata aligns with search metadata).
    enrichment_jobs: list[tuple[tuple[str, str], int, str]] = []
    for key, qr in results.items():
        for i, h in enumerate(qr.hits[:3]):
            if h.uid:
                enrichment_jobs.append((key, i, h.uid))

    page_records: dict[str, dict] = {}
    with ThreadPoolExecutor(max_workers=6) as ex:
        futs = {ex.submit(fetch_model, session, uid): (key, i, uid) for key, i, uid in enrichment_jobs}
        for f in as_completed(futs):
            key, i, uid = futs[f]
            data = f.result()
            if not data:
                continue
            page_records[uid] = data
            cats = [c.get("name", "") for c in data.get("categories", [])]
            results[key].hits[i].categories = cats

    # Phase 3: classify relevance per hit using query intent
    for sci, common, tier in SAMPLE:
        for kind in ("scientific", "common"):
            q = sci if kind == "scientific" else common
            qr = results[(q, kind)]
            for h in qr.hits:
                h.relevance, h.relevance_reason = classify_relevance(sci, common, h)

    # Print structured report
    print("=" * 90)
    print("SKETCHFAB PROBE — search API + single-model API verification")
    print("=" * 90)

    tier_summary: dict[str, dict[str, int]] = {}
    for sci, common, tier in SAMPLE:
        tier_summary.setdefault(tier, {"has_any_match": 0, "total": 0})
        tier_summary[tier]["total"] += 1
        species_has_match = False

        print(f"\n## [{tier:7s}] {sci} / {common}")
        for kind in ("scientific", "common"):
            q = sci if kind == "scientific" else common
            qr = results[(q, kind)]
            n = qr.total_walked
            n_str = f"~{n}" + ("+" if n and n >= 240 else "") if n is not None else "?"
            print(f"  [{kind:11s}] q={q!r:42s}  total_walked={n_str}")
            for i, h in enumerate(qr.hits[:3], 1):
                tags_str = ", ".join(h.tags[:6])
                cats_str = ", ".join(h.categories) if h.categories else "—"
                marker = {"match": "✓", "likely": "~", "ambiguous": "?", "false_positive": "✗"}.get(h.relevance, "?")
                print(f"     {marker} {i}. {h.name!r}  by @{h.user}")
                print(f"          relevance: {h.relevance} ({h.relevance_reason})")
                print(f"          tags     : [{tags_str}]")
                print(f"          cats     : [{cats_str}]")
                if h.description:
                    desc = re.sub(r"\s+", " ", h.description)[:160]
                    print(f"          desc     : {desc!r}")
                if h.relevance in {"match", "likely"}:
                    species_has_match = True
        if species_has_match:
            tier_summary[tier]["has_any_match"] += 1

    print("\n" + "=" * 90)
    print("TIER SUMMARY (≥1 plausibly-correct hit on either query)")
    print("=" * 90)
    for tier, agg in tier_summary.items():
        print(f"  {tier:7s}: {agg['has_any_match']}/{agg['total']} species had ≥1 match|likely hit")

    # Dump raw for the writeup
    out = {
        "sample": [{"scientific": s, "common": c, "tier": t} for s, c, t in SAMPLE],
        "queries": {
            f"{q}|{kind}": {
                "total_walked": qr.total_walked,
                "hits": [asdict(h) for h in qr.hits],
            }
            for (q, kind), qr in results.items()
        },
        "tier_summary": tier_summary,
    }
    Path("/tmp/sketchfab_probe.json").write_text(json.dumps(out, indent=2))
    print(f"\nRaw JSON: /tmp/sketchfab_probe.json")


if __name__ == "__main__":
    main()
