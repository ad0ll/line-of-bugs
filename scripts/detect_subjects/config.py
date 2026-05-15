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
HIGH_CONF_THRESHOLD = 0.30  # 2026-05-15: raised from 0.20 — the 0.20-0.25 band was mostly flower/leaf false-positives in validator labelling. CLASSIFY_HIDDEN_CONF (no-bug gate) intentionally stays at 0.20.

# ─── Classification thresholds (initial — tuned later) ─────────────
CLASSIFY_HIDDEN_CONF       = 0.20  # GroundingDINO's calibration is low for multi-class period-separated prompts; 0.20 matches the actual distribution while keeping BOX_THRESHOLD=0.15 as the "any signal" floor
CLASSIFY_HIDDEN_AREA       = 0.02
CLASSIFY_WIDE_AREA         = 0.20
CLASSIFY_TIGHT_AREA        = 0.50
CLASSIFY_CAMOUFLAGED_DELTA = 8.0   # was 12 — data showed 17% being flagged camouflaged; 8 catches the genuinely-low-contrast 6%
CLASSIFY_BUG_TOO_SMALL_EDGE_PX = 512
BBOX_EDGE_TOLERANCE_NORMALIZED = 0.005  # how close to image edge counts as 'touching' (~5 px on a 1000px image)
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
SCHEMA_VERSION = 1

# ─── Concurrency ───────────────────────────────────────────────────
N_LOADER_THREADS = 16
N_METRICS_PROCESSES = 16
DETECT_BATCH_SIZE = 16
SEGMENT_BATCH_SIZE = 8
PARQUET_WRITE_BATCH = 50
