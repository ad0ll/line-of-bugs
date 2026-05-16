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
        super().do_GET()

    def do_POST(self):
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
    addr = ("", port)
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
