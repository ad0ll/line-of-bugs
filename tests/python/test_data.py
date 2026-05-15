"""Tests for manifest loading + stratified sample selection."""
from __future__ import annotations
import csv

import pytest

from scripts.detect_subjects.data import (
    load_manifest_rows,
    pick_stratified_sample,
)


@pytest.fixture
def fake_manifests(tmp_path):
    manifest_dir = tmp_path / "manifest"
    manifest_dir.mkdir()
    cols = ["image_id", "source", "taxon_order", "subject_state",
            "description", "width", "height", "filename"]

    def write(source: str, rows: list[dict]):
        path = manifest_dir / f"{source}.csv"
        with path.open("w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=cols)
            w.writeheader()
            for r in rows:
                w.writerow({c: r.get(c, "") for c in cols})

    write("inaturalist", [
        {"image_id": f"inat-{i}", "source": "inaturalist",
         "taxon_order": "Coleoptera" if i % 2 == 0 else "Mantodea",
         "subject_state": "wild",
         "description": "habitat" if i < 30 else "adult on leaf",
         "width": "4000", "height": "3000",
         "filename": f"images/inat-{i}.jpg"}
        for i in range(500)
    ])
    write("bugwood", [
        {"image_id": f"bw-{i}", "source": "bugwood",
         "taxon_order": "Lepidoptera",
         "subject_state": "wild",
         "description": "adult",
         "width": "2000", "height": "1500",
         "filename": f"images/bw-{i}.jpg"}
        for i in range(200)
    ])
    write("smithsonian", [
        {"image_id": f"sm-{i}", "source": "smithsonian",
         "taxon_order": "Coleoptera",
         "subject_state": "specimen",
         "description": "specimen",
         "width": "2000", "height": "1500",
         "filename": f"images/sm-{i}.jpg"}
        for i in range(60)
    ])
    return manifest_dir


def test_load_manifest_rows_returns_all(fake_manifests):
    rows = load_manifest_rows(manifest_dir=fake_manifests)
    assert len(rows) == 760


def test_pick_stratified_sample_correct_counts(fake_manifests):
    rows = load_manifest_rows(manifest_dir=fake_manifests)
    sample = pick_stratified_sample(rows, seed=42)
    by_source = {}
    for r in sample:
        by_source.setdefault(r["source"], 0)
        by_source[r["source"]] += 1
    assert by_source.get("bugwood", 0) == 80
    assert by_source.get("smithsonian", 0) == 40
    assert by_source.get("inaturalist", 0) == 240


def test_pick_stratified_sample_deterministic(fake_manifests):
    rows = load_manifest_rows(manifest_dir=fake_manifests)
    sample_a = pick_stratified_sample(rows, seed=42)
    sample_b = pick_stratified_sample(rows, seed=42)
    ids_a = [r["image_id"] for r in sample_a]
    ids_b = [r["image_id"] for r in sample_b]
    assert ids_a == ids_b


def test_pick_stratified_sample_includes_hard_taxa(fake_manifests):
    rows = load_manifest_rows(manifest_dir=fake_manifests)
    sample = pick_stratified_sample(rows, seed=42)
    orders = {r.get("taxon_order", "") for r in sample}
    assert "Mantodea" in orders
