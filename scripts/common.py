"""Shared helpers for the four insect-image downloaders.

Key design points (production-quality, 2026-05-14 refactor):
  * Streaming chunked downloads (memory-safe; soft-cap via max_bytes).
  * Fail-fast Retry adapter: connection-level errors don't retry; only
    HTTP-level (429/5xx) do. DNS / refused-connection bail immediately,
    which lets a missing host abort the script in seconds rather than
    minutes.
  * ParallelDownloader fans out image fetches across a thread pool while
    API record fetches stay sequential (so we respect per-API rate limits
    while still saturating CDN throughput).
  * Manifest writer auto-migrates schema on init.
  * Filename convention: {source_id}_{source}_{subject_type}_{name}.jpg
"""
from __future__ import annotations
import csv
import hashlib
import logging
import re
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

# ───────────────────────── paths + constants ────────────────────

ROOT = Path(__file__).resolve().parent.parent
IMG_DIR = ROOT / "data" / "images"
THUMB_DIR = ROOT / "data" / "thumbnails"
MEDIUM_DIR = ROOT / "data" / "medium"
MANIFEST_DIR = ROOT / "data" / "manifest"
LOG_DIR = ROOT / "data" / "logs"
for d in (IMG_DIR, THUMB_DIR, MEDIUM_DIR, MANIFEST_DIR, LOG_DIR):
    d.mkdir(parents=True, exist_ok=True)

USER_AGENT = "line-of-bugs/0.1 (spew_footrest858@simplelogin.com)"
MIN_LONG_EDGE_DEFAULT = 1500
THUMB_MAX_EDGE = 512
THUMB_QUALITY = 85
MEDIUM_MAX_EDGE = 1024
MEDIUM_QUALITY = 88
DEFAULT_MAX_BYTES = 50_000_000  # soft cap; we abort mid-stream if exceeded

MANIFEST_FIELDS = [
    "image_id",
    "collection_id",
    "source", "source_id",
    "source_page_url", "image_url",
    "filename", "thumbnail_filename", "medium_filename",
    "file_size_bytes", "file_sha256", "width", "height",
    "license", "license_url",
    "photographer_attribution", "photographer", "institution",
    "taxon_order", "taxon_species", "common_name",
    "subject_type", "view_label",
    "description", "captured_date",
]


# ───────────────────────── logging ──────────────────────────────

def setup_logging(name: str) -> logging.Logger:
    """Each downloader gets a stdout logger AND a per-source rotating file
    in data/logs/<name>.log — checkpoints survive between runs."""
    logger = logging.getLogger(name)
    if logger.handlers:
        return logger
    logger.setLevel(logging.INFO)
    fmt = logging.Formatter(
        "%(asctime)s %(levelname).1s %(message)s", datefmt="%H:%M:%S",
    )
    sh = logging.StreamHandler()
    sh.setFormatter(fmt)
    logger.addHandler(sh)
    fh = logging.FileHandler(LOG_DIR / f"{name}.log")
    fh.setFormatter(fmt)
    logger.addHandler(fh)
    logger.propagate = False
    return logger


# ───────────────────────── HTTP session ─────────────────────────

def session(connect_retries: int = 0, read_retries: int = 2,
            status_retries: int = 5) -> requests.Session:
    """Fail-fast on connection-level errors (DNS, refused conn). Only retry
    on HTTP 429/5xx. This is the difference between a 30s spin per failing
    page and a 1s clean error."""
    s = requests.Session()
    s.headers["User-Agent"] = USER_AGENT
    retry = Retry(
        total=status_retries,
        connect=connect_retries,
        read=read_retries,
        status_forcelist=(429, 500, 502, 503, 504),
        backoff_factor=1.5,
        allowed_methods=frozenset(["GET", "HEAD"]),
        raise_on_status=False,
    )
    s.mount("https://", HTTPAdapter(max_retries=retry, pool_connections=20, pool_maxsize=20))
    s.mount("http://", HTTPAdapter(max_retries=retry, pool_connections=20, pool_maxsize=20))
    return s


# ───────────────────────── image dims + hash ─────────────────────

def jpeg_dims(path):
    with open(path, "rb") as f:
        if f.read(2) != b"\xff\xd8":
            return None, None
        while True:
            b = f.read(2)
            if len(b) < 2 or b[0] != 0xff:
                return None, None
            mark = b[1]
            if 0xc0 <= mark <= 0xcf and mark not in (0xc4, 0xc8, 0xcc):
                f.read(3)
                h = int.from_bytes(f.read(2), "big")
                w = int.from_bytes(f.read(2), "big")
                return w, h
            size_b = f.read(2)
            if len(size_b) < 2:
                return None, None
            size = int.from_bytes(size_b, "big")
            f.read(max(0, size - 2))


def png_dims(path):
    with open(path, "rb") as f:
        if f.read(8) != b"\x89PNG\r\n\x1a\n":
            return None, None
        f.read(8)
        w = int.from_bytes(f.read(4), "big")
        h = int.from_bytes(f.read(4), "big")
        return w, h


def image_dims(path):
    suf = Path(path).suffix.lower()
    if suf == ".png":
        return png_dims(path)
    return jpeg_dims(path)


def sha256_of(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


# ───────────────────────── slug + filenames ─────────────────────

_BAD_CHARS = re.compile(r"[(),.\[\]{}/'\"!?:;]")
_SPACE_RE = re.compile(r"[\s_]+")
_DASH_RE = re.compile(r"-+")


def slugify(s: str) -> str:
    if not s:
        return ""
    s = str(s).lower()
    s = _BAD_CHARS.sub("", s)
    s = _SPACE_RE.sub("-", s)
    s = _DASH_RE.sub("-", s)
    return s.strip("-")


def name_for_filename(common_name: str, scientific: str) -> str:
    n = slugify(common_name or "")
    if not n and scientific:
        parts = re.findall(r"[A-Za-z][A-Za-z\-]*", scientific)[:2]
        n = slugify(" ".join(parts))
    return n


def build_filename(source: str, source_id: str, subject_type: str,
                   common_name: str, scientific: str,
                   suffix_hint: str = "") -> str:
    sid = slugify(source_id)
    src = slugify(source)
    st = slugify(subject_type)
    name = name_for_filename(common_name, scientific)
    parts = [sid, src, st]
    if name:
        parts.append(name)
    if suffix_hint:
        parts.append(slugify(suffix_hint))
    return "_".join(p for p in parts if p) + ".jpg"


# ───────────────────────── thumbnails ───────────────────────────

def make_resized(src_path: Path, dst_path: Path, max_dim: int, quality: int) -> bool:
    """Generate a fit-within-{max_dim} JPEG q{quality} resized variant.
    Preserves aspect ratio (long edge ≤ max_dim)."""
    try:
        from PIL import Image
        with Image.open(src_path) as img:
            img.load()
            if img.mode in ("RGBA", "LA", "P"):
                img = img.convert("RGB")
            img.thumbnail((max_dim, max_dim), Image.LANCZOS)
            dst_path.parent.mkdir(parents=True, exist_ok=True)
            img.save(dst_path, "JPEG", quality=quality, optimize=True,
                     progressive=True)
        return True
    except Exception:
        return False


def make_thumbnail(src_path: Path, dst_path: Path,
                   max_dim: int = THUMB_MAX_EDGE,
                   quality: int = THUMB_QUALITY) -> bool:
    return make_resized(src_path, dst_path, max_dim, quality)


def make_medium(src_path: Path, dst_path: Path,
                max_dim: int = MEDIUM_MAX_EDGE,
                quality: int = MEDIUM_QUALITY) -> bool:
    return make_resized(src_path, dst_path, max_dim, quality)


# ───────────────────────── download (streaming) ────────────────

def _download_stream(s: requests.Session, url: str, out_path: Path,
                     max_bytes: int) -> tuple[bool, int, str]:
    """Stream URL to out_path. Aborts mid-download if size > max_bytes.
    Returns (ok, bytes_read, reason)."""
    try:
        with s.get(url, timeout=120, stream=True) as r:
            if r.status_code != 200:
                return False, 0, f"http_{r.status_code}"
            size = 0
            with open(out_path, "wb") as f:
                for chunk in r.iter_content(1 << 16):
                    if not chunk:
                        continue
                    size += len(chunk)
                    if size > max_bytes:
                        f.close()
                        out_path.unlink(missing_ok=True)
                        return False, size, "oversize"
                    f.write(chunk)
            return True, size, "ok"
    except requests.RequestException as e:
        out_path.unlink(missing_ok=True)
        return False, 0, f"err_{type(e).__name__}"


def download(s: requests.Session, url: str, out_path: Path,
             thumb_path: Path | None = None,
             medium_path: Path | None = None,
             min_edge: int = MIN_LONG_EDGE_DEFAULT,
             max_bytes: int = DEFAULT_MAX_BYTES) -> dict | None:
    """Download with streaming, validate min long-edge, generate thumb + medium.
    Returns dict on success, None on any failure."""
    # Reuse if already on disk and meets min_edge
    if out_path.exists():
        w, h = image_dims(out_path)
        if w and max(w, h) >= min_edge:
            if thumb_path and not thumb_path.exists():
                make_thumbnail(out_path, thumb_path)
            if medium_path and not medium_path.exists():
                make_medium(out_path, medium_path)
            return {
                "file_size_bytes": out_path.stat().st_size,
                "file_sha256": sha256_of(out_path),
                "width": w, "height": h,
            }
        out_path.unlink(missing_ok=True)

    ok, size, reason = _download_stream(s, url, out_path, max_bytes)
    if not ok:
        return None
    if size < 10_000:
        out_path.unlink(missing_ok=True)
        return None
    w, h = image_dims(out_path)
    if not w or max(w, h) < min_edge:
        out_path.unlink(missing_ok=True)
        return None
    if thumb_path:
        make_thumbnail(out_path, thumb_path)
    if medium_path:
        make_medium(out_path, medium_path)
    return {
        "file_size_bytes": size,
        "file_sha256": sha256_of(out_path),
        "width": w, "height": h,
    }


# ───────────────────────── parallel download fan-out ───────────

def parallel_download(s: requests.Session, items: list[dict],
                      max_workers: int = 6,
                      max_bytes: int = DEFAULT_MAX_BYTES) -> list[tuple[dict, dict | None]]:
    """Fan-out chunked downloads + thumbnail generation across a thread pool.

    Each `item` dict must include `url` and `out_path`; optionally
    `thumb_path`, `min_edge`, `max_bytes`. Returns list of (item, result)
    in original order — result is the dict from download() or None.

    Use this for CDN image fetches; KEEP api record fetches sequential to
    respect documented per-API rate limits.
    """
    results: list[tuple[dict, dict | None]] = [(items[i], None) for i in range(len(items))]
    if not items:
        return results

    def _one(idx: int):
        it = items[idx]
        return idx, download(
            s, it["url"], it["out_path"],
            thumb_path=it.get("thumb_path"),
            medium_path=it.get("medium_path"),
            min_edge=it.get("min_edge", MIN_LONG_EDGE_DEFAULT),
            max_bytes=it.get("max_bytes", max_bytes),
        )

    with ThreadPoolExecutor(max_workers=max_workers) as ex:
        futures = [ex.submit(_one, i) for i in range(len(items))]
        for fut in as_completed(futures):
            idx, res = fut.result()
            results[idx] = (items[idx], res)
    return results


# ───────────────────────── consecutive-failure circuit ─────────

class ConsecutiveFailureGuard:
    """Trip after N consecutive failures of the same conceptual operation.
    Used by downloaders so that a persistent outage (DNS, host down) aborts
    the script with a non-zero exit instead of spinning forever."""

    def __init__(self, threshold: int, name: str = ""):
        self.threshold = threshold
        self.name = name
        self.fails = 0
        self.tripped = False

    def success(self):
        self.fails = 0

    def failure(self) -> bool:
        self.fails += 1
        if self.fails >= self.threshold:
            self.tripped = True
        return self.tripped


# ───────────────────────── manifest reader / writer ────────────

def manifest_count_by(mw_path: Path, *fields: str) -> Counter:
    """Group-by count of an existing manifest. e.g.,
    manifest_count_by(p, 'license', 'subject_type')."""
    out: Counter = Counter()
    if not mw_path.exists():
        return out
    with mw_path.open("r", newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            key = tuple(row.get(field, "") for field in fields)
            out[key] += 1
    return out


def read_existing_rows(mw_path: Path) -> list[dict]:
    """One-shot read of the manifest. Use at script startup; don't call repeatedly."""
    if not mw_path.exists():
        return []
    with mw_path.open("r", newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


class ManifestWriter:
    """CSV writer that migrates schema on init (rewrites header + existing
    rows to canonical MANIFEST_FIELDS, filling missing with ""). Safe
    across schema bumps."""

    def __init__(self, source_name: str):
        self.path = MANIFEST_DIR / f"{source_name}.csv"
        self.seen: set[str] = set()
        existing_rows: list[dict] = []
        existing_header: list[str] = []
        if self.path.exists():
            with self.path.open("r", newline="", encoding="utf-8") as f:
                reader = csv.DictReader(f)
                existing_header = list(reader.fieldnames or [])
                for row in reader:
                    existing_rows.append(dict(row))
                    self.seen.add(row.get("image_id", ""))
        with self.path.open("w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=MANIFEST_FIELDS, extrasaction="ignore")
            w.writeheader()
            for row in existing_rows:
                for fname in MANIFEST_FIELDS:
                    row.setdefault(fname, "")
                w.writerow(row)
        if existing_header and existing_header != list(MANIFEST_FIELDS):
            added = [c for c in MANIFEST_FIELDS if c not in existing_header]
            removed = [c for c in existing_header if c not in MANIFEST_FIELDS]
            logging.getLogger("lob").info(
                f"manifest migrated: {self.path.name}  +{added}  -{removed}",
            )
        self.fh = self.path.open("a", newline="", encoding="utf-8")
        self.w = csv.DictWriter(self.fh, fieldnames=MANIFEST_FIELDS, extrasaction="ignore")

    def has(self, image_id: str) -> bool:
        return image_id in self.seen

    def write(self, row: dict) -> bool:
        if row["image_id"] in self.seen:
            return False
        self.seen.add(row["image_id"])
        for k in ("description", "photographer_attribution"):
            if row.get(k):
                row[k] = str(row[k])[:1000]
        for f in MANIFEST_FIELDS:
            row.setdefault(f, "")
        self.w.writerow(row)
        self.fh.flush()
        return True

    def count(self) -> int:
        return len(self.seen)

    def close(self):
        self.fh.close()
