"""Tests for image LRU cache + parquet resume logic."""
from __future__ import annotations

import pyarrow as pa
import pyarrow.parquet as pq

from scripts.detect_subjects.caches import (
    ImageDecodeCache,
    load_completed_pairs,
)
from scripts.detect_subjects.schema import SCHEMA


def test_image_cache_stores_and_evicts():
    cache = ImageDecodeCache(max_items=2)
    cache.put("a", "decoded-a")
    cache.put("b", "decoded-b")
    cache.put("c", "decoded-c")  # evicts "a"
    assert cache.get("a") is None
    assert cache.get("b") == "decoded-b"
    assert cache.get("c") == "decoded-c"


def test_image_cache_lru_recent_access_keeps_alive():
    cache = ImageDecodeCache(max_items=2)
    cache.put("a", "A")
    cache.put("b", "B")
    _ = cache.get("a")
    cache.put("c", "C")
    assert cache.get("a") == "A"
    assert cache.get("b") is None
    assert cache.get("c") == "C"


def test_load_completed_pairs_empty_when_no_parquet(tmp_path):
    assert load_completed_pairs(tmp_path / "nope.parquet") == set()


def test_load_completed_pairs_reads_existing_rows(tmp_path):
    parquet_path = tmp_path / "test.parquet"
    null_fields = {c: None for c in SCHEMA.names
                   if c not in {"image_id", "variant", "framing_quality",
                                "detector_model", "source", "img_w", "img_h",
                                "subject_state", "n_raw_detections",
                                "n_distinct_detections", "processed_at",
                                "schema_version"}}
    base = {
        **null_fields,
        "framing_quality": "good",
        "detector_model": "m",
        "source": "inaturalist",
        "img_w": 100, "img_h": 100,
        "subject_state": "wild",
        "n_raw_detections": 0, "n_distinct_detections": 0,
        "processed_at": 1747278900_000,
        "schema_version": 1,
    }
    records = [
        {**base, "image_id": "a", "variant": "v1"},
        {**base, "image_id": "b", "variant": "v1"},
    ]
    table = pa.Table.from_pylist(records, schema=SCHEMA)
    pq.write_table(table, parquet_path)
    pairs = load_completed_pairs(parquet_path)
    assert pairs == {("a", "v1"), ("b", "v1")}
