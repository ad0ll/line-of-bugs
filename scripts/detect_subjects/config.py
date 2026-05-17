"""Centralized constants, paths, and model IDs for the framing experiment."""
from __future__ import annotations
from pathlib import Path

# ─── Paths ─────────────────────────────────────────────────────────
ROOT = Path(__file__).resolve().parent.parent.parent
DATA_DIR = ROOT / "data"
IMG_DIR = DATA_DIR / "images"
MANIFEST_DIR = DATA_DIR / "manifest"
CACHE_DIR = DATA_DIR / "cache"

VALIDATOR_DIR = ROOT / "tools" / "validator"
CROPS_DIR = VALIDATOR_DIR / "crops"

for d in (CACHE_DIR, VALIDATOR_DIR, CROPS_DIR):
    d.mkdir(parents=True, exist_ok=True)

PARQUET_PATH = CACHE_DIR / "framing_detections.parquet"
SAMPLE_PARQUET_PATH = CACHE_DIR / "validator_sample.parquet"
LABELS_PARQUET_PATH = CACHE_DIR / "labels.parquet"
TUNED_THRESHOLDS_PATH = CACHE_DIR / "tuned_thresholds.yaml"

# ─── Random seed ───────────────────────────────────────────────────
RANDOM_SEED = 42

# ─── Sample composition (totals to 360) ────────────────────────────
SAMPLE_INAT_RANDOM = 160
SAMPLE_INAT_HARD   = 80
SAMPLE_BUGWOOD     = 80
SAMPLE_HARD_TAXA   = 40
SAMPLE_TOTAL       = (
    SAMPLE_INAT_RANDOM + SAMPLE_INAT_HARD + SAMPLE_BUGWOOD + SAMPLE_HARD_TAXA
)
HARD_TAXA = ["Mantodea", "Phasmatodea", "Lepidoptera_larva", "Orthoptera"]
SAMPLE_PER_HARD_TAXON = SAMPLE_HARD_TAXA // len(HARD_TAXA)  # 10

INAT_HARD_DESC_PATTERN = r"\bhabitat|landscape|wide|field|scenery\b"

# ─── Model IDs ─────────────────────────────────────────────────────
DINO_MODEL_ID = "IDEA-Research/grounding-dino-base"
INSECTSAM_MODEL_ID = "martintomov/InsectSAM"

# ─── Detection prompt for V1 ───────────────────────────────────────
INSECT_PROMPT = (
    "an insect. a butterfly. a beetle. a moth. a bee. a wasp. "
    "a fly. a dragonfly. a damselfly. a grasshopper. a mantis. "
    "a cockroach. a true bug. a caterpillar. a larva."
)

# ─── Detector thresholds ───────────────────────────────────────────
BOX_THRESHOLD = 0.15  # lowered so we capture bbox data on low-conf cases (still classify as 'hidden')
TEXT_THRESHOLD = 0.20
NMS_IOU_THRESHOLD = 0.5
HIGH_CONF_THRESHOLD = 0.30  # 2026-05-15: raised from 0.20 — the 0.20-0.25 band was mostly flower/leaf false-positives in validator labelling. CLASSIFY_HIDDEN_CONF (no-bug gate) intentionally stays at 0.20.

# ─── Classification thresholds (initial — tuned later) ─────────────
CLASSIFY_HIDDEN_CONF       = 0.05  # 2026-05-15: tuned 0.20 → 0.05 via grid sweep against 318 manual labels. Old value fired no-bug on conf=0.17-0.20 detections where the bug was actually present; F1 jumped 0.33 → 0.67. BOX_THRESHOLD=0.15 still gates raw detection.
CLASSIFY_HIDDEN_AREA       = 0.02
CLASSIFY_WIDE_AREA         = 0.20
CLASSIFY_TIGHT_AREA        = 0.50
CLASSIFY_CAMOUFLAGED_DELTA = 10.5  # 2026-05-15: tuned 8.0 → 10.5 via grid sweep against manual labels (F1 0.33 → 0.39). Catches a few more genuinely-low-contrast bugs the old threshold missed.
CLASSIFY_BUG_TOO_SMALL_EDGE_PX = 512
BBOX_EDGE_TOLERANCE_NORMALIZED = 0.014  # 2026-05-15: tuned 0.005 → 0.014 (F1 0.36 → 0.49). Still poor recall because user-clipped bugs often have bboxes far from the frame edge (bug body extends past bbox) — fundamental fix would require a mask-edge-proximity metric, not just bbox.
# Bbox-selection rule (the bark-beetle fix): prefer larger high-confidence bboxes over
# the top-1, because DINO sometimes top-ranks small distinctive sub-features (head, eye)
# above the whole-subject box.
BBOX_CONF_TOLERANCE = 0.05    # candidate must have conf >= top_conf - this
BBOX_MAX_AREA_RATIO  = 0.80   # candidate must cover <= 80% of frame (rejects 'whole image' boxes)  # bug's short edge in pixels — below this, even auto-cropping produces an unusable image
# CLASSIFY_BLURRED_SHARPNESS removed from active classification — Laplacian variance fails on uniform-textured subjects (false positives on smooth bug bodies). subject_sharpness is still computed and stored for future training data; users flag blur via labels.

# ─── Crop targets ──────────────────────────────────────────────────
CROP_TARGET_AREA_NATURE   = 0.30
CROP_TARGET_AREA_SPECIMEN = 0.60
CROP_SKIP_IF_AREA_ABOVE   = 0.25

# ─── Image processing ──────────────────────────────────────────────
CROP_MEDIUM_MAX_EDGE = 1024
CROP_MEDIUM_QUALITY = 90
CROP_THUMB_MAX_EDGE = 512
CROP_THUMB_QUALITY = 85

# ─── Schema version ────────────────────────────────────────────────
# v2 (2026-05-17): subject_sharpness now mask-restricted (was bbox-only).
#   New columns: top10pct_lap_mask, edge_density_mask_vs_bg.
#   See experiments/blur_mask_features.py for the calibration.
SCHEMA_VERSION = 2

# ─── Concurrency ───────────────────────────────────────────────────
N_LOADER_THREADS = 16
N_METRICS_PROCESSES = 16
DETECT_BATCH_SIZE = 16
SEGMENT_BATCH_SIZE = 8
PARQUET_WRITE_BATCH = 50

# ─── Pipeline component selection ─────────────────────────────────
# These names look up classes in detectors/__init__.py and segmenters/__init__.py.
# Swapping is a one-line config change.
DETECTOR_VARIANT = "grounding_dino"
SEGMENTER_VARIANT = "insectsam"


def variant_tag() -> str:
    """The string written to parquet rows' `variant` column.

    Two reasons it changes: a detector swap, or a segmenter swap.
    A/B comparisons filter parquet by `variant`.
    """
    return f"{DETECTOR_VARIANT}__{SEGMENTER_VARIANT}"
