"""Union per-source manifest CSVs into one. Dedup by file_sha256.

Output: data/manifest/manifest.csv
"""
from __future__ import annotations
import csv
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import MANIFEST_DIR, MANIFEST_FIELDS, setup_logging

log = setup_logging("merge")
SOURCES_PRIORITY = ["inaturalist", "bugwood", "smithsonian", "usda_ars"]


def main() -> int:
    out_path = MANIFEST_DIR / "manifest.csv"
    seen_hashes: set[str] = set()
    rows_out: list[dict] = []
    per_source_dups: Counter = Counter()
    for src in SOURCES_PRIORITY:
        p = MANIFEST_DIR / f"{src}.csv"
        if not p.exists():
            log.warning("missing %s.csv — skipping", src)
            continue
        with p.open("r", newline="") as f:
            for row in csv.DictReader(f):
                sha = row.get("file_sha256") or ""
                if sha and sha in seen_hashes:
                    per_source_dups[src] += 1
                    continue
                if sha:
                    seen_hashes.add(sha)
                rows_out.append(row)
    with out_path.open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=MANIFEST_FIELDS, extrasaction="ignore")
        w.writeheader()
        for r in rows_out:
            w.writerow(r)
    log.info("wrote %d rows → %s", len(rows_out), out_path)
    by_src = Counter(r["source"] for r in rows_out)
    by_subj = Counter(r["subject_type"] for r in rows_out)
    by_lic = Counter(r["license"] for r in rows_out)
    by_order = Counter(r["taxon_order"] for r in rows_out)
    for label, c in [("source", by_src), ("subject_type", by_subj),
                     ("license", by_lic), ("taxon_order (top 10)", by_order)]:
        log.info("── by %s ──", label)
        for k, v in c.most_common(10 if "taxon" in label else 50):
            log.info("  %-30s %5d", k or "(empty)", v)
    if per_source_dups:
        log.info("cross-source dup skips:")
        for k, v in per_source_dups.most_common():
            log.info("  %s: %d", k, v)
    return 0


if __name__ == "__main__":
    sys.exit(main())
