"""Static-file server + label-persistence sidecar for the framing validator.

After the SQLite migration (T4) and labels.json deletion (T12), this server
talks to the image_labels table directly. GET returns the whole table as
the same shape the legacy validator HTML expects; POST does an atomic
delete-missing + upsert-all + recompute-all transaction so the UI's
"clear every label" semantic continues to work (orphans get removed,
not left behind).

Endpoints:
  GET  /any/static/path        → serve from project root
  GET  /api/labels             → return {image_id: record} from image_labels
  GET  /api/predictions        → return {image_id: {predicted_<label>_p, ...}}
                                  from sam3__sam3 rows of framing_detections.parquet
                                  (powers UI prediction badges; survives because
                                  the parquet is still the source of truth for
                                  predictions until predictions_sync runs)
  POST /api/labels             → body is JSON dict; atomic replace + recompute
  POST /api/retrain/<label>    → run train + predict for label (TIER1 only)

Run:
  .venv/bin/python -m scripts.detect_subjects.label_server [PORT]
"""
from __future__ import annotations
import json
import os
import sys
import time
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from scripts.detect_subjects import sqlite_db
from scripts.detect_subjects.sqlite_db import open_conn
from scripts.detect_subjects.image_labels_io import (
    upsert_label, delete_labels_not_in,
)
from scripts.detect_subjects.recompute_gate import recompute_for_image

PROJECT_ROOT = Path(__file__).resolve().parents[2]

# Tunable via env so the same port can be reused after a crash without
# stale-listener "address already in use" pain.
DEFAULT_PORT = int(os.environ.get("VALIDATOR_PORT", "8765"))


def _read_all_labels() -> dict:
    """Return {image_id: record} for ALL image_labels rows (reviewed or not).

    Matches the legacy labels.json shape exactly so the validator UI can
    consume this without changes."""
    conn = open_conn()
    try:
        rows = conn.execute(
            "SELECT image_id, col1, col2_count, col2_flags, col3, col4, "
            "unsure, reviewed_at, user_edited, variant_tag FROM image_labels"
        ).fetchall()
    finally:
        conn.close()
    out: dict[str, dict] = {}
    for (iid, col1, col2_count, flags_j, col3_j, col4_j,
         unsure, reviewed_at, user_edited, variant_tag) in rows:
        out[iid] = {
            "col1": col1, "col2_count": col2_count,
            "col2_flags": json.loads(flags_j) if flags_j else [],
            "col3": json.loads(col3_j) if col3_j else [],
            "col4": json.loads(col4_j) if col4_j else [],
            "unsure": bool(unsure),
            "reviewed_at": reviewed_at,
            "user_edited": bool(user_edited),
            "variant_tag": variant_tag,
        }
    return out


def _read_predictions() -> dict:
    """{image_id: {predicted_<label>_p: ..., predicted_<label>_unreliable: ...}}
    for every sam3__sam3 row that has any predicted column. Called by the UI
    on load + after retrain so fresh probs show without an HTML rebuild.

    We re-read the parquet on every request — it's small (<2MB) and the file
    OS-cache hit makes the read sub-10ms. Avoids any in-memory staleness.

    Preserved from the labels.json era: predictions still live in the parquet
    as columns (predicted_<label>_p / _unreliable). T6's predictions_sync
    mirrors them to the predictions table but the UI still reads here for the
    `predicted_p` badge contract.
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


class _StompGuardError(ValueError):
    """Raised when an empty POST would clear non-empty image_labels."""


def _write_labels_and_recompute(payload: dict) -> dict:
    """Atomic replace of image_labels with `payload`:
      - Delete rows whose image_id is NOT in payload (UI 'un-mark' semantic)
      - Upsert every payload row
      - Recompute_for_image for every image_id that exists in the new state
        OR was just deleted (so the gate reflects both adds and removes)
    All in one BEGIN/COMMIT — a crash mid-save leaves the previous state intact.

    Returns {upserted, deleted, recomputed}.

    Safety: a payload of {} when image_labels has rows is treated as a likely
    bug, not a deliberate wipe — raises _StompGuardError. The UI never needs
    to clear every label this way (it deletes one key at a time). Operator can
    drop the table directly for intentional wipes.
    """
    now_s = int(time.time())
    conn = open_conn()
    try:
        existing_ids = {
            r[0] for r in conn.execute("SELECT image_id FROM image_labels")
        }
        if not payload and existing_ids:
            raise _StompGuardError(
                f"refusing to clear {len(existing_ids)} image_labels rows "
                "via empty POST payload (likely UI bug; use sqlite3 directly "
                "for intentional wipes)"
            )
        keep_ids = set(payload.keys())
        deleted_ids = existing_ids - keep_ids
        conn.execute("BEGIN")
        try:
            deleted = delete_labels_not_in(conn, keep_ids)
            for image_id, record in payload.items():
                upsert_label(conn, image_id, record)
            for image_id in keep_ids:
                recompute_for_image(image_id, conn, now_s=now_s)
            for image_id in deleted_ids:
                recompute_for_image(image_id, conn, now_s=now_s)
            conn.commit()
        except Exception:
            conn.rollback()
            raise
    finally:
        conn.close()
    return {
        "upserted": len(payload),
        "deleted": deleted,
        "recomputed": len(keep_ids) + len(deleted_ids),
    }


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
            self._send_json(HTTPStatus.OK, _read_all_labels())
            return
        if self.path == "/api/predictions":
            self._send_json(HTTPStatus.OK, _read_predictions())
            return
        super().do_GET()

    def do_POST(self):
        if self.path.startswith("/api/retrain/"):
            self._handle_retrain()
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
            stats = _write_labels_and_recompute(payload)
        except _StompGuardError as e:
            self._send_json(HTTPStatus.BAD_REQUEST, {"error": str(e)})
            return
        except Exception as e:
            self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": str(e)})
            return
        self._send_json(HTTPStatus.OK, {"ok": True, **stats})

    def _handle_retrain(self):
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
            self._send_json(HTTPStatus.OK, {"ok": True, "label": label,
                                            "stdout": proc.stdout[-500:]})
        except subprocess.TimeoutExpired:
            self._send_json(HTTPStatus.GATEWAY_TIMEOUT, {"error": "training timeout"})


def serve(port: int = DEFAULT_PORT) -> None:
    addr = ("127.0.0.1", port)
    httpd = ThreadingHTTPServer(addr, LabelServerHandler)
    print(f"[label-server] serving on http://localhost:{port}")
    print(f"[label-server] static root: {PROJECT_ROOT}")
    print(f"[label-server] DB:          {sqlite_db.DEFAULT_DB_PATH}")
    print(f"[label-server] validator:   http://localhost:{port}/tools/validator/grounding_dino__insectsam.html")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n[label-server] shutting down")
        httpd.shutdown()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_PORT
    serve(port)
