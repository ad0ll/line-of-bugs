"""Static-file server + label-persistence sidecar for the framing validator.

The validator HTML used to keep labels in localStorage with a "download
backup every 25 clicks" safety net. That model loses work on origin
changes (port flips, file:// vs http) and dies if the user makes <25
edits before refresh. This server makes `data/cache/labels.json` the
source of truth: every click on a button in the UI posts the full labels
dict and we atomically replace the file (write to .tmp then rename, so a
crash mid-write can't corrupt). Page load fetches the same file back.

Endpoints:
  GET  /any/static/path          → serve from project root
  GET  /api/labels               → return labels.json (or {} if missing)
  POST /api/labels               → body is JSON dict; atomic-write to disk

Run:
  .venv/bin/python -m scripts.detect_subjects.label_server [PORT]
"""
from __future__ import annotations
import json
import os
import sys
import tempfile
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from scripts.detect_subjects.config import CACHE_DIR

PROJECT_ROOT = Path(__file__).resolve().parents[2]
LABELS_PATH = CACHE_DIR / "labels.json"

# Tunable via env so the same port can be reused after a crash without
# stale-listener "address already in use" pain.
DEFAULT_PORT = int(os.environ.get("VALIDATOR_PORT", "8765"))


def _read_labels() -> dict:
    if not LABELS_PATH.exists():
        return {}
    try:
        return json.loads(LABELS_PATH.read_text() or "{}")
    except Exception:
        # If the file is somehow corrupted, surface an empty dict rather than 500.
        # The next POST will overwrite it cleanly. (We don't auto-recover from
        # a backup because there isn't one — but the atomic write below means
        # we should never see this in practice.)
        return {}


def _read_predictions() -> dict:
    """{image_id: {predicted_<label>_p: ..., predicted_<label>_unreliable: ...}}
    for every sam3__sam3 row that has any predicted column. Called by the UI
    on load + after retrain so fresh probs show without an HTML rebuild.

    We re-read the parquet on every request — it's small (<2MB) and the file
    OS-cache hit makes the read sub-10ms. Avoids any in-memory staleness.
    """
    parquet_path = PROJECT_ROOT / "data" / "cache" / "framing_detections.parquet"
    if not parquet_path.exists():
        return {}
    try:
        import polars as pl
        import math
        df = pl.read_parquet(parquet_path).filter(pl.col("variant") == "sam3__sam3")
        pred_cols = [c for c in df.columns if c.startswith("predicted_")]
        if not pred_cols:
            return {}
        out: dict = {}
        for row in df.select(["image_id", *pred_cols]).iter_rows(named=True):
            iid = row["image_id"]
            cleaned = {}
            for c in pred_cols:
                v = row[c]
                # JSON can't carry NaN — convert to None so JS sees null,
                # matching the existing UI filter (p != null && !isNaN(p)).
                if isinstance(v, float) and math.isnan(v):
                    cleaned[c] = None
                else:
                    cleaned[c] = v
            out[iid] = cleaned
        return out
    except Exception as e:
        print(f"[label_server] /api/predictions failed: {type(e).__name__}: {e}")
        return {}


def _atomic_write_labels(data: dict) -> None:
    LABELS_PATH.parent.mkdir(parents=True, exist_ok=True)
    # Write to a sibling temp file in the same dir, then atomic rename. A
    # mid-write crash leaves either the old labels.json or the new one — never
    # a half-written file. tempfile.NamedTemporaryFile keeps it on the same
    # filesystem so rename() is atomic on POSIX.
    fd, tmp_path = tempfile.mkstemp(
        prefix="labels.", suffix=".json.tmp", dir=str(LABELS_PATH.parent)
    )
    try:
        with os.fdopen(fd, "w") as f:
            json.dump(data, f, indent=2)
        os.replace(tmp_path, LABELS_PATH)
    except Exception:
        # Don't leave the temp file lying around on failure.
        try: os.unlink(tmp_path)
        except FileNotFoundError: pass
        raise


class LabelServerHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(PROJECT_ROOT), **kwargs)

    # Quieter access log — only print API hits + errors. Static GETs spam.
    def log_message(self, format, *args):
        if self.path.startswith("/api/") or "404" in (args[1] if len(args) > 1 else ""):
            super().log_message(format, *args)

    def _send_json(self, status: int, body: dict | list) -> None:
        encoded = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        # Tight CORS — only same-origin should be hitting this anyway; the
        # validator HTML is served from this very server.
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(encoded)

    def do_GET(self):
        if self.path == "/api/labels":
            self._send_json(HTTPStatus.OK, _read_labels())
            return
        if self.path == "/api/predictions":
            self._send_json(HTTPStatus.OK, _read_predictions())
            return
        super().do_GET()

    def do_POST(self):
        if self.path.startswith("/api/retrain/"):
            label = self.path.split("/api/retrain/", 1)[1]
            from scripts.detect_subjects.ml_labeler import TIER1_LABELS
            if label not in TIER1_LABELS:
                self._send_json(HTTPStatus.BAD_REQUEST, {
                    "error": f"unknown label {label!r}; allowed: {TIER1_LABELS}",
                })
                return
            import subprocess
            try:
                # Run training in subprocess so server stays responsive
                proc = subprocess.run(
                    [".venv/bin/python", "-m", "scripts.detect_subjects.ml_labeler.train", label],
                    cwd=str(PROJECT_ROOT), capture_output=True, text=True, timeout=600,
                )
                if proc.returncode != 0:
                    self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {
                        "error": "train failed", "stderr": proc.stderr[-2000:],
                    })
                    return
                # After training, run inference to update parquet
                proc2 = subprocess.run(
                    [".venv/bin/python", "-m", "scripts.detect_subjects.ml_labeler.predict", label],
                    cwd=str(PROJECT_ROOT), capture_output=True, text=True, timeout=300,
                )
                if proc2.returncode != 0:
                    self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {
                        "error": "predict failed", "stderr": proc2.stderr[-2000:],
                    })
                    return
                # Rebuild HTML so updated probabilities surface
                subprocess.run(
                    [".venv/bin/python", "-m", "scripts.detect_subjects.build_html", "sam3__sam3"],
                    cwd=str(PROJECT_ROOT), capture_output=True, text=True, timeout=60,
                )
                self._send_json(HTTPStatus.OK, {"ok": True, "label": label, "stdout": proc.stdout[-500:]})
            except subprocess.TimeoutExpired:
                self._send_json(HTTPStatus.GATEWAY_TIMEOUT, {"error": "training timeout"})
            return

        if self.path != "/api/labels":
            self.send_error(HTTPStatus.NOT_FOUND, "no such endpoint")
            return
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            self.send_error(HTTPStatus.BAD_REQUEST, "empty body")
            return
        raw = self.rfile.read(length)
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError as e:
            self.send_error(HTTPStatus.BAD_REQUEST, f"bad json: {e}")
            return
        if not isinstance(payload, dict):
            self.send_error(HTTPStatus.BAD_REQUEST, "expected a dict")
            return
        try:
            _atomic_write_labels(payload)
        except OSError as e:
            self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": str(e)})
            return
        self._send_json(HTTPStatus.OK, {"ok": True, "n": len(payload)})


def serve(port: int = DEFAULT_PORT) -> None:
    addr = ("127.0.0.1", port)
    httpd = ThreadingHTTPServer(addr, LabelServerHandler)
    print(f"[label-server] serving on http://localhost:{port}")
    print(f"[label-server] static root: {PROJECT_ROOT}")
    print(f"[label-server] labels file: {LABELS_PATH}")
    print(f"[label-server] validator:   http://localhost:{port}/tools/validator/grounding_dino__insectsam.html")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n[label-server] shutting down")
        httpd.shutdown()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_PORT
    serve(port)
