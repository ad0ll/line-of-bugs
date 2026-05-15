"""Taxonomy classifier — maps an iNat-style (taxon_order, ancestor_ids)
pair to a layperson chip key (`taxon_subgroup`).

Used by the fetchers at write time so every new row gets its chip
assignment without needing a backfill. The original one-shot backfill
that populated existing rows was deleted after running (commits
ba43e7c / preceding R6 task 4); recover it from git history if a new
column lookup ever needs to be backfilled the same way.
"""
from __future__ import annotations


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
