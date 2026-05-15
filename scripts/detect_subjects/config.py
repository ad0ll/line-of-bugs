"""Centralized constants, paths, and model IDs for the framing experiment."""
from __future__ import annotations
from pathlib import Path

# ─── Paths ─────────────────────────────────────────────────────────
ROOT = Path(__file__).resolve().parent.parent.parent
DATA_DIR = ROOT / "data"
IMG_DIR = DATA_DIR / "images"
MANIFEST_DIR = DATA_DIR / "manifest"
CACHE_DIR = DATA_DIR / "cache"

VALIDATOR_DIR = ROOT / "audit" / "framing-validator"
CROPS_DIR = VALIDATOR_DIR / "crops"

for d in (CACHE_DIR, VALIDATOR_DIR, CROPS_DIR):
    d.mkdir(parents=True, exist_ok=True)

PARQUET_PATH = CACHE_DIR / "framing_detections.parquet"
SAMPLE_PARQUET_PATH = CACHE_DIR / "validator_sample.parquet"
LABELS_PARQUET_PATH = CACHE_DIR / "labels.parquet"
TUNED_THRESHOLDS_PATH = CACHE_DIR / "tuned_thresholds.yaml"

# ─── Random seed ───────────────────────────────────────────────────
RANDOM_SEED = 42

# ─── Sample composition (totals to 400) ────────────────────────────
SAMPLE_INAT_RANDOM = 160
SAMPLE_INAT_HARD   = 80
SAMPLE_BUGWOOD     = 80
SAMPLE_SMITHSONIAN = 40
SAMPLE_HARD_TAXA   = 40
SAMPLE_TOTAL       = (
    SAMPLE_INAT_RANDOM + SAMPLE_INAT_HARD + SAMPLE_BUGWOOD
    + SAMPLE_SMITHSONIAN + SAMPLE_HARD_TAXA
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
HIGH_CONF_THRESHOLD = 0.4

# ─── Classification thresholds (initial — tuned later) ─────────────
CLASSIFY_HIDDEN_CONF       = 0.20  # GroundingDINO's calibration is low for multi-class period-separated prompts; 0.20 matches the actual distribution while keeping BOX_THRESHOLD=0.15 as the "any signal" floor
CLASSIFY_HIDDEN_AREA       = 0.02
CLASSIFY_WIDE_AREA         = 0.20
CLASSIFY_TIGHT_AREA        = 0.50
CLASSIFY_CAMOUFLAGED_DELTA = 12.0

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
SCHEMA_VERSION = 1

# ─── Concurrency ───────────────────────────────────────────────────
N_LOADER_THREADS = 16
N_METRICS_PROCESSES = 16
DETECT_BATCH_SIZE = 16
SEGMENT_BATCH_SIZE = 8
PARQUET_WRITE_BATCH = 50
