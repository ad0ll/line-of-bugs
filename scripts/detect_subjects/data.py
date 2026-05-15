"""Manifest loading + stratified sample selection for the validator."""
from __future__ import annotations
import csv
import random
import re
import sys
from pathlib import Path

from scripts.detect_subjects.config import (
    HARD_TAXA,
    INAT_HARD_DESC_PATTERN,
    MANIFEST_DIR,
    SAMPLE_BUGWOOD,
    SAMPLE_INAT_HARD,
    SAMPLE_INAT_RANDOM,
    SAMPLE_PER_HARD_TAXON,
)

# Some manifest rows (notably iNaturalist descriptions) exceed the default
# 131072-byte CSV field limit. Lift it so the reader doesn't crash.
csv.field_size_limit(sys.maxsize)


MANIFEST_SOURCES = ["inaturalist", "bugwood"]


def load_manifest_rows(manifest_dir: Path = MANIFEST_DIR) -> list[dict]:
    """Read every per-source manifest CSV and return a flat list of row dicts."""
    rows: list[dict] = []
    for source in MANIFEST_SOURCES:
        path = manifest_dir / f"{source}.csv"
        if not path.exists():
            continue
        with path.open("r", newline="") as f:
            reader = csv.DictReader(f)
            rows.extend(reader)
    return rows


def _filter_inat(rows: list[dict]) -> list[dict]:
    return [r for r in rows if r.get("source") == "inaturalist"]


def _filter_inat_hard(inat_rows: list[dict]) -> list[dict]:
    pat = re.compile(INAT_HARD_DESC_PATTERN, re.I)
    out = []
    for r in inat_rows:
        if pat.search(r.get("description", "")):
            out.append(r)
            continue
        try:
            w = float(r.get("width") or 0)
            h = float(r.get("height") or 0)
            if w > 0 and h > 0:
                aspect = max(w / h, h / w)
                if aspect > 2.0:
                    out.append(r)
        except ValueError:
            pass
    return out


def _filter_by_source(rows: list[dict], source: str) -> list[dict]:
    return [r for r in rows if r.get("source") == source]


def _filter_by_taxon(rows: list[dict], taxon: str) -> list[dict]:
    return [r for r in rows if r.get("taxon_order") == taxon]


def pick_stratified_sample(all_rows: list[dict], seed: int = 42) -> list[dict]:
    """Pick a stratified validator sample."""
    rng = random.Random(seed)
    picked: list[dict] = []
    used_ids: set[str] = set()

    def take(pool: list[dict], k: int) -> list[dict]:
        pool = [r for r in pool if r["image_id"] not in used_ids]
        rng.shuffle(pool)
        chosen = pool[:k]
        for r in chosen:
            used_ids.add(r["image_id"])
        return chosen

    inat = _filter_inat(all_rows)
    inat_hard_pool = _filter_inat_hard(inat)
    picked.extend(take(inat_hard_pool, SAMPLE_INAT_HARD))

    inat_random_needed = SAMPLE_INAT_RANDOM + (
        SAMPLE_INAT_HARD - len([r for r in picked if r["source"] == "inaturalist"])
    )
    picked.extend(take(inat, inat_random_needed))

    picked.extend(take(_filter_by_source(all_rows, "bugwood"), SAMPLE_BUGWOOD))

    for taxon in HARD_TAXA:
        if any(r.get("taxon_order") == taxon for r in picked):
            continue
        picked.extend(take(_filter_by_taxon(all_rows, taxon), SAMPLE_PER_HARD_TAXON))

    return picked
