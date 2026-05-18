"""HTTP roundtrip tests for the SQLite-backed label server."""
from __future__ import annotations
import json
import sqlite3
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

import pytest


SCHEMA = """
CREATE TABLE images (
  image_id TEXT PRIMARY KEY,
  collection_id TEXT NOT NULL, source TEXT NOT NULL, source_id TEXT NOT NULL,
  source_page_url TEXT NOT NULL, image_url TEXT NOT NULL,
  filename TEXT NOT NULL, thumbnail_filename TEXT NOT NULL,
  medium_filename TEXT NOT NULL, file_sha256 TEXT NOT NULL,
  license TEXT NOT NULL, subject_state TEXT NOT NULL,
  hidden INTEGER NOT NULL DEFAULT 0,
  added_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  image_id TEXT NOT NULL REFERENCES images(image_id) ON DELETE CASCADE,
  category TEXT NOT NULL, message TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  resolved_at INTEGER, resolved_action TEXT
);
CREATE TABLE image_labels (
  image_id TEXT PRIMARY KEY REFERENCES images(image_id) ON DELETE CASCADE,
  col1 TEXT, col2_count TEXT, col2_flags TEXT, col3 TEXT, col4 TEXT,
  unsure INTEGER NOT NULL DEFAULT 0 CHECK (unsure IN (0, 1)),
  reviewed_at INTEGER,
  user_edited INTEGER NOT NULL DEFAULT 0 CHECK (user_edited IN (0, 1)),
  variant_tag TEXT
);
CREATE TABLE detections (
  image_id TEXT PRIMARY KEY REFERENCES images(image_id) ON DELETE CASCADE,
  variant TEXT NOT NULL, suggested_labels TEXT NOT NULL,
  gate_rule_only TEXT NOT NULL CHECK (gate_rule_only IN ('keep','reject')),
  has_bbox INTEGER NOT NULL CHECK (has_bbox IN (0, 1)),
  bbox_x REAL, bbox_y REAL, bbox_w REAL, bbox_h REAL,
  mask_area_ratio REAL, lab_delta_e REAL, boundary_sharpness REAL,
  mask_iou_score REAL,
  crop_x REAL, crop_y REAL, crop_w REAL, crop_h REAL,
  post_crop_subject_area REAL,
  processed_at INTEGER NOT NULL, schema_version INTEGER NOT NULL
);
CREATE TABLE predictions (
  image_id TEXT NOT NULL REFERENCES images(image_id) ON DELETE CASCADE,
  label TEXT NOT NULL, p REAL NOT NULL,
  unreliable INTEGER NOT NULL DEFAULT 0 CHECK (unreliable IN (0, 1)),
  model_version TEXT NOT NULL, predicted_at INTEGER NOT NULL,
  PRIMARY KEY (image_id, label)
);
CREATE TABLE gate_decisions (
  image_id TEXT PRIMARY KEY REFERENCES images(image_id) ON DELETE CASCADE,
  decision TEXT NOT NULL CHECK (decision IN ('keep','reject')),
  reason TEXT NOT NULL,
  reason_source TEXT NOT NULL CHECK (reason_source IN ('hand','report','rule','ml','default')),
  computed_at INTEGER NOT NULL, model_version TEXT, threshold_v INTEGER
);
CREATE TABLE label_thresholds (
  label TEXT PRIMARY KEY, tier INTEGER NOT NULL CHECK (tier IN (1, 2)),
  threshold REAL NOT NULL, suggested_threshold REAL,
  threshold_v INTEGER NOT NULL, notes TEXT, updated_at INTEGER NOT NULL
);
"""


@pytest.fixture
def tmp_db(tmp_path):
    db = tmp_path / "test.db"
    conn = sqlite3.connect(db)
    conn.executescript(SCHEMA)
    conn.execute(
        "INSERT INTO images (image_id, collection_id, source, source_id, "
        "source_page_url, image_url, filename, thumbnail_filename, "
        "medium_filename, file_sha256, license, subject_state) "
        "VALUES ('img-1', 'c', 'inaturalist', 's', 'u', 'u', 'f', 't', "
        "'m', 'sha', 'lic', 'wild')"
    )
    conn.commit()
    conn.close()
    return db


@pytest.fixture
def server_url(tmp_db, monkeypatch):
    """Start the label server in a thread on a free port; tear down."""
    import socket
    from scripts.detect_subjects import label_server
    monkeypatch.setattr(
        "scripts.detect_subjects.sqlite_db.DEFAULT_DB_PATH", tmp_db,
    )
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    httpd_holder = {}

    def _run():
        from http.server import ThreadingHTTPServer
        httpd = ThreadingHTTPServer(("127.0.0.1", port), label_server.LabelServerHandler)
        httpd_holder["s"] = httpd
        httpd.serve_forever()
    th = threading.Thread(target=_run, daemon=True)
    th.start()
    for _ in range(50):
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{port}/api/labels", timeout=0.2)
            break
        except Exception:
            time.sleep(0.05)
    yield f"http://127.0.0.1:{port}"
    httpd_holder["s"].shutdown()


def test_get_returns_empty_dict_when_no_labels(server_url):
    resp = urllib.request.urlopen(f"{server_url}/api/labels")
    assert resp.status == 200
    assert json.loads(resp.read()) == {}


def test_post_upserts_label_and_recomputes_gate(server_url, tmp_db):
    record = {
        "img-1": {
            "col1": "bbox_correct-subject_not-clipped",
            "col2_count": "bbox-content_single",
            "col2_flags": [], "col3": ["mask_blur_unusable"], "col4": [],
            "unsure": False, "reviewed_at": 1779000000000, "user_edited": True,
            "variant_tag": "sam3__sam3",
        },
    }
    req = urllib.request.Request(
        f"{server_url}/api/labels", data=json.dumps(record).encode(),
        headers={"Content-Type": "application/json"}, method="POST",
    )
    resp = urllib.request.urlopen(req)
    assert resp.status == 200
    payload = json.loads(resp.read())
    assert payload["ok"] is True

    # GET should now return the record
    resp = urllib.request.urlopen(f"{server_url}/api/labels")
    got = json.loads(resp.read())
    assert got["img-1"]["col3"] == ["mask_blur_unusable"]

    # gate_decisions should have a hand-reject row for img-1
    conn = sqlite3.connect(tmp_db)
    row = conn.execute(
        "SELECT decision, reason_source FROM gate_decisions WHERE image_id='img-1'"
    ).fetchone()
    conn.close()
    assert row == ("reject", "hand")


def test_post_empty_dict_into_empty_table_is_noop(server_url, tmp_db):
    """A bare {} POST against an empty image_labels is OK (no rows to wipe)."""
    req = urllib.request.Request(
        f"{server_url}/api/labels", data=b"{}",
        headers={"Content-Type": "application/json"}, method="POST",
    )
    resp = urllib.request.urlopen(req)
    assert resp.status == 200
    conn = sqlite3.connect(tmp_db)
    n = conn.execute("SELECT COUNT(*) FROM image_labels").fetchone()[0]
    conn.close()
    assert n == 0


def test_post_empty_dict_against_existing_rows_is_rejected(server_url, tmp_db):
    """Stomp guard: an empty POST when image_labels has rows is treated as a
    UI bug and rejected with 400, preserving the data."""
    conn = sqlite3.connect(tmp_db)
    conn.execute(
        "INSERT INTO image_labels (image_id, col1, col2_count, col2_flags, "
        "col3, col4, unsure, reviewed_at, user_edited, variant_tag) "
        "VALUES ('img-1', 'bbox_correct-subject_not-clipped', 'bbox-content_single', "
        "'[]', '[]', '[]', 0, 100, 1, 'sam3__sam3')"
    )
    conn.commit()
    conn.close()
    req = urllib.request.Request(
        f"{server_url}/api/labels", data=b"{}",
        headers={"Content-Type": "application/json"}, method="POST",
    )
    try:
        urllib.request.urlopen(req)
        raised = False
    except urllib.error.HTTPError as e:
        raised = (e.code == 400)
    assert raised
    conn = sqlite3.connect(tmp_db)
    n = conn.execute("SELECT COUNT(*) FROM image_labels").fetchone()[0]
    conn.close()
    assert n == 1


def test_get_predictions_returns_dict_from_parquet(server_url, tmp_db, tmp_path, monkeypatch):
    """GET /api/predictions reads predicted_*_p columns from parquet and
    returns {image_id: {predicted_<label>_p, predicted_<label>_unreliable}}."""
    import polars as pl
    parquet_path = tmp_path / "framing_detections.parquet"
    df = pl.DataFrame({
        "image_id": ["img-1", "img-2"],
        "variant": ["sam3__sam3", "sam3__sam3"],
        "predicted_mask_blur_unusable_p": [0.85, 0.20],
        "predicted_mask_blur_unusable_unreliable": [False, False],
    })
    df.write_parquet(parquet_path)
    monkeypatch.setattr(
        "scripts.detect_subjects.label_server.PARQUET_PATH", parquet_path,
    )
    resp = urllib.request.urlopen(f"{server_url}/api/predictions")
    assert resp.status == 200
    body = json.loads(resp.read())
    assert "img-1" in body
    assert body["img-1"]["predicted_mask_blur_unusable_p"] == 0.85
    assert body["img-1"]["predicted_mask_blur_unusable_unreliable"] is False


def test_get_predictions_returns_empty_when_parquet_missing(server_url, monkeypatch, tmp_path):
    """If the parquet doesn't exist, /api/predictions returns an empty
    dict rather than crashing."""
    monkeypatch.setattr(
        "scripts.detect_subjects.label_server.PARQUET_PATH",
        tmp_path / "does-not-exist.parquet",
    )
    resp = urllib.request.urlopen(f"{server_url}/api/predictions")
    assert resp.status == 200
    body = json.loads(resp.read())
    assert body == {}


def test_post_deletes_rows_not_in_payload(server_url, tmp_db):
    """If a key is absent from the POST body, its row is removed — matches
    the legacy labels.json overwrite behavior the UI relies on for 'un-mark'."""
    conn = sqlite3.connect(tmp_db)
    for iid in ("img-1", "img-2"):
        conn.execute(
            "INSERT INTO images (image_id, collection_id, source, source_id, "
            "source_page_url, image_url, filename, thumbnail_filename, "
            "medium_filename, file_sha256, license, subject_state) "
            "VALUES (?, 'c', 'inaturalist', 's', 'u', 'u', 'f', 't', 'm', "
            "'sha', 'lic', 'wild') ON CONFLICT(image_id) DO NOTHING",
            (iid,),
        )
        conn.execute(
            "INSERT INTO image_labels (image_id, col1, col2_count, col2_flags, "
            "col3, col4, unsure, reviewed_at, user_edited, variant_tag) "
            "VALUES (?, 'bbox_correct-subject_not-clipped', 'bbox-content_single', "
            "'[]', '[]', '[]', 0, 100, 1, 'sam3__sam3') "
            "ON CONFLICT(image_id) DO NOTHING",
            (iid,),
        )
    conn.commit()
    conn.close()
    payload = {
        "img-1": {
            "col1": "bbox_correct-subject_not-clipped",
            "col2_count": "bbox-content_single",
            "col2_flags": [], "col3": [], "col4": [],
            "unsure": False, "reviewed_at": 200, "user_edited": True,
            "variant_tag": "sam3__sam3",
        },
    }
    req = urllib.request.Request(
        f"{server_url}/api/labels", data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"}, method="POST",
    )
    resp = urllib.request.urlopen(req)
    body = json.loads(resp.read())
    assert resp.status == 200
    assert body["deleted"] == 1
    assert body["upserted"] == 1
    conn = sqlite3.connect(tmp_db)
    rows = list(conn.execute("SELECT image_id FROM image_labels ORDER BY image_id"))
    conn.close()
    assert rows == [("img-1",)]
