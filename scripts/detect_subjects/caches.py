"""LRU image decode cache + parquet resume helpers."""
from __future__ import annotations
from collections import OrderedDict
from pathlib import Path
from typing import Any, Optional

import pyarrow.parquet as pq


class ImageDecodeCache:
    """A simple, thread-unsafe LRU cache for decoded image tensors."""

    def __init__(self, max_items: int = 32) -> None:
        self._max = max_items
        self._cache: OrderedDict[str, Any] = OrderedDict()

    def get(self, key: str) -> Optional[Any]:
        if key not in self._cache:
            return None
        self._cache.move_to_end(key)
        return self._cache[key]

    def put(self, key: str, value: Any) -> None:
        if key in self._cache:
            self._cache.move_to_end(key)
            self._cache[key] = value
            return
        self._cache[key] = value
        if len(self._cache) > self._max:
            self._cache.popitem(last=False)

    def __len__(self) -> int:
        return len(self._cache)


def load_completed_pairs(parquet_path: Path) -> set[tuple[str, str]]:
    """Return the set of (image_id, variant) pairs already in the parquet file."""
    if not Path(parquet_path).exists():
        return set()
    table = pq.read_table(parquet_path, columns=["image_id", "variant"])
    ids = table.column("image_id").to_pylist()
    variants = table.column("variant").to_pylist()
    return set(zip(ids, variants))
