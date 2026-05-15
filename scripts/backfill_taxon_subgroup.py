"""R6 backfill: derive `taxon_subgroup` for every row in the images table.

This is a one-shot — once it's run and the fetchers themselves populate
the column at write time (see scripts/fetch_inaturalist.py +
scripts/fetch_bugwood.py post-R6), this script's purpose is exhausted
and it can be deleted.

Strategy:
  1. For iNat rows: parse raw_metadata.taxon.ancestor_ids and walk
     TAXON_ID_TO_SUBGROUP (insertion-order = specific-first). First match
     wins.
  2. Per-order default for rows that don't hit a specific ancestor
     (Mantodea → mantis, Blattodea → cockroach, etc.).
  3. Last-resort Lepidoptera-without-Papilionoidea → moth, Coleoptera
     without Coccinellidae → beetle, etc.
  4. Anything in the WEIRD_ORDERS set → "weird".
  5. Anything we can't classify → leaves taxon_subgroup NULL (caller's
     UI shows "weird" as the catch-all for nulls if it wants).

Bugwood + Smithsonian rows have no rich `ancestor_ids` (we don't fetch
iNat-style taxonomy from them). They fall through to step 2-4.
"""
from __future__ import annotations
import json
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from db import DB_PATH


# Specific ancestor IDs we look for in raw_metadata.taxon.ancestor_ids.
# Insertion order matters: when an ancestry chain could match multiple,
# we want the more specific one (e.g., Cicadidae before its sub-order
# Auchenorrhyncha). dict iteration is insertion-ordered since Python 3.7.
TAXON_ID_TO_SUBGROUP: dict[int, str] = {
    # ── Lepidoptera ─────────────────────────────────────────
    47224:  "butterfly",   # Papilionoidea (superfamily) — butterflies clade
    # ── Coleoptera ──────────────────────────────────────────
    48486:  "ladybug",     # Coccinellidae (family)
    # ── Diptera ─────────────────────────────────────────────
    52134:  "mosquito",    # Culicidae (family)
    # ── Hymenoptera ─────────────────────────────────────────
    630955: "bee",         # Anthophila (epifamily) — bee clade
    47336:  "ant",         # Formicidae (family)
    # ── Hemiptera ───────────────────────────────────────────
    # Specific family first, suborder second.
    50186:  "cicada",      # Cicadidae (family)
    61267:  "stink_bug",   # Heteroptera (suborder) — true bugs
    334037: "aphid",       # Sternorrhyncha (suborder) — aphids/scales/whiteflies
    # ── Orthoptera ──────────────────────────────────────────
    67688:  "grasshopper", # Caelifera (suborder)
    132694: "cricket",     # Ensifera (suborder) — incl katydids
}


# Per-taxon-order defaults for rows whose ancestry didn't hit any specific
# ID in the table above (or which have no ancestry data at all — Bugwood,
# Smithsonian).
ORDER_DEFAULTS: dict[str, str] = {
    "Lepidoptera_larva": "caterpillar",
    "Mantodea":          "mantis",
    "Phasmatodea":       "stick_insect",
    "Blattodea":         "cockroach",
    "Dermaptera":        "earwig",
    "Odonata":           "dragonfly",
    # Lepidoptera + no Papilionoidea → moth (fallback).
    "Lepidoptera":       "moth",
    # Catch-all "this is a kind of X" for the major orders where we
    # don't have a more specific sub-family ID.
    "Coleoptera":        "beetle",
    "Diptera":           "fly",
    "Hymenoptera":       "wasp",
    "Orthoptera":        "cricket",  # safer than "grasshopper" — see test
    # Hemiptera without a specific sub-order match (Heteroptera /
    # Sternorrhyncha / Cicadidae already handled) → leafhoppers,
    # planthoppers, treehoppers, spittlebugs. These don't look like
    # stink bugs and laypeople don't have a chip for them, so → weird.
    "Hemiptera":         "weird",
}


# Small orders that don't earn their own chip — folded into "weird stuff".
WEIRD_ORDERS: set[str] = {
    "Neuroptera",
    "Ephemeroptera",
    "Trichoptera",
    "Plecoptera",
    "Siphonaptera",
    "Thysanura",
    # Bugwood-specific orders that don't have iNat-style ancestors.
    "Isoptera",       # termites (modern taxonomy folds into Blattodea, but Bugwood tags separately)
    "Thysanoptera",   # thrips
}


def classify(taxon_order: str, ancestor_ids: list[int]) -> str | None:
    """Return the taxon_subgroup string for a row, or None if unclassifiable
    (only when taxon_order is empty — every named order should resolve)."""
    if not taxon_order:
        return None
    # 1. Walk the ancestor chain looking for a specific match.
    ancestor_set = set(ancestor_ids or [])
    for ancestor_id, subgroup in TAXON_ID_TO_SUBGROUP.items():
        if ancestor_id in ancestor_set:
            return subgroup
    # 2. Order-level defaults.
    if taxon_order in ORDER_DEFAULTS:
        return ORDER_DEFAULTS[taxon_order]
    # 3. Small orders → weird.
    if taxon_order in WEIRD_ORDERS:
        return "weird"
    # 4. Final catch-all — a known order that we just don't have a chip
    # for goes to "weird" rather than NULL.
    return "weird"


def main() -> int:
    conn = sqlite3.connect(DB_PATH, isolation_level=None)
    conn.execute("PRAGMA busy_timeout = 5000")

    rows = conn.execute(
        "SELECT image_id, taxon_order, raw_metadata "
        "FROM images WHERE taxon_subgroup IS NULL"
    ).fetchall()
    print(f"backfill: {len(rows)} rows needing classification", flush=True)

    updates: list[tuple[str, str]] = []
    none_count = 0
    for image_id, taxon_order, raw in rows:
        ancestor_ids: list[int] = []
        if raw and raw != "{}":
            try:
                obj = json.loads(raw)
                ancestor_ids = (obj.get("taxon") or {}).get("ancestor_ids") or []
            except Exception:
                pass
        subgroup = classify(taxon_order or "", ancestor_ids)
        if subgroup:
            updates.append((subgroup, image_id))
        else:
            none_count += 1

    print(f"backfill: applying {len(updates)} updates ({none_count} unclassifiable)",
          flush=True)
    conn.executemany(
        "UPDATE images SET taxon_subgroup = ? WHERE image_id = ?",
        updates,
    )

    print("backfill: distribution after run:", flush=True)
    for subgroup, count in conn.execute(
        "SELECT COALESCE(taxon_subgroup, '<NULL>'), COUNT(*) "
        "FROM images GROUP BY taxon_subgroup ORDER BY 2 DESC"
    ):
        print(f"  {subgroup:<14}  {count:>6}", flush=True)
    conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
