"""iNat-2017 ground truth bbox lookup.

The iNat-2017 challenge release includes per-image bounding boxes in COCO
format (pixel coords). We normalize to [0,1] and index by source_id so we
can match against our manifest's source_id column.

If the annotations JSON isn't on disk, this module's lookup methods always
return None. That's the graceful default — gt_iou stays null in the parquet.
"""
from __future__ import annotations
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional


@dataclass
class GroundTruthIndex:
    """In-memory index: source_id (string) -> normalized (x, y, w, h)."""
    annotations_by_source_id: dict[str, tuple[float, float, float, float]] = field(
        default_factory=dict)

    def lookup(self, image_id: str) -> Optional[tuple[float, float, float, float]]:
        if not image_id.startswith("inat-"):
            return None
        source_id = image_id[len("inat-"):]
        return self.annotations_by_source_id.get(source_id)

    @classmethod
    def from_inat2017_json(cls, path: Path) -> "GroundTruthIndex":
        with Path(path).open("r") as f:
            data = json.load(f)
        sizes: dict[int, tuple[int, int]] = {}
        for img in data.get("images", []):
            sizes[int(img["id"])] = (int(img["width"]), int(img["height"]))
        normalized: dict[str, tuple[float, float, float, float]] = {}
        for ann in data.get("annotations", []):
            iid = int(ann["image_id"])
            if iid not in sizes:
                continue
            W, H = sizes[iid]
            if W == 0 or H == 0:
                continue
            x, y, w, h = ann["bbox"]
            normalized[str(iid)] = (x / W, y / H, w / W, h / H)
        return cls(annotations_by_source_id=normalized)


def lookup_gt_bbox(
    index: Optional[GroundTruthIndex],
    image_id: str,
) -> Optional[tuple[float, float, float, float]]:
    if index is None:
        return None
    return index.lookup(image_id)
