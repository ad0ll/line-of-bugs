"""DB-driven SAM 3 prompt builder per Phase 2 spec.

Reads taxa from data/db/line-of-bugs.db, maps to common-name noun phrases,
appends NEGATIVE classes for false-positive detection, generates a stable
version hash.

Per Parashar et al. EMNLP 2023: common English names outperform scientific
names by 2-5x for fine-grained species recognition in VLMs.
"""
from __future__ import annotations
import hashlib
import sqlite3
import sys
from pathlib import Path

ORDER_TO_COMMON_NAMES: dict[str, list[str]] = {
    "Coleoptera": ["a beetle"],
    "Lepidoptera": ["a butterfly", "a moth"],
    "Hymenoptera": ["a bee", "a wasp", "an ant"],
    "Diptera": ["a fly"],
    "Hemiptera": ["a true bug"],
    "Orthoptera": ["a grasshopper", "a cricket"],
    "Odonata": ["a dragonfly", "a damselfly"],
    "Mantodea": ["a praying mantis"],
    "Blattodea": ["a cockroach", "a termite"],
    "Phasmatodea": ["a stick insect"],
    "Neuroptera": ["a lacewing"],
    "Trichoptera": ["a caddisfly"],
    "Ephemeroptera": ["a mayfly"],
    "Plecoptera": ["a stonefly"],
}

LIFE_STAGES = ["a caterpillar", "a larva", "a nymph", "a pupa"]
NEGATIVE_CLASSES = ["a flower", "a leaf", "a stem", "a rock"]


def build_insect_prompt(db_path: Path) -> tuple[list[str], str]:
    """Build a PRIORITY-ORDERED SAM 3 prompt phrase list + 8-char version hash.

    SAM 3's CLIP tokenizer has a 32-token max (~8-10 phrases). Sam3Detector
    greedily trims from the FRONT to fit, so we PRIORITIZE:

      1. "an insect" — generic anchor (always in)
      2. Order-specific common names, in dataset frequency order
      3. LIFE_STAGES — lowest priority

    NEGATIVE_CLASSES (a flower / a leaf / a stem / a rock) are EXCLUDED from
    the SAM 3 prompt: SAM 3 returns the highest-scoring detection across the
    full phrase set, so including negatives causes SAM 3 to label the
    flower-the-bug-is-sitting-on rather than the bug. The original spec's
    "negative classes flag false positives" idea required per-instance phrase
    labels, which SAM 3 doesn't expose. We still export NEGATIVE_CLASSES for
    the UI overlay's red-border check on phrases from OTHER detectors.

    Returns (ordered_phrases, version_hash).
    """
    ordered: list[str] = ["an insect"]

    matched_orders: list[str] = []
    if db_path.exists():
        con = sqlite3.connect(str(db_path))
        try:
            cur = con.execute(
                "SELECT taxon_order, COUNT(*) AS n FROM images "
                "WHERE taxon_order IS NOT NULL AND taxon_order != '' "
                "GROUP BY taxon_order ORDER BY n DESC"
            )
            rows = [(r[0], r[1]) for r in cur]
        finally:
            con.close()
        unmatched = []
        for order, _count in rows:
            if order in ORDER_TO_COMMON_NAMES:
                matched_orders.append(order)
            else:
                unmatched.append(order)
        if unmatched:
            print(
                f"[prompt_builder] WARN: no common-name lookup for "
                f"taxon_orders {unmatched}; their images rely on 'an insect' anchor.",
                file=sys.stderr,
            )

    for order in matched_orders:
        for phrase in ORDER_TO_COMMON_NAMES[order]:
            if phrase not in ordered:
                ordered.append(phrase)

    for stage in LIFE_STAGES:
        if stage not in ordered:
            ordered.append(stage)

    version_hash = hashlib.sha1("|".join(ordered).encode()).hexdigest()[:8]
    return ordered, version_hash
