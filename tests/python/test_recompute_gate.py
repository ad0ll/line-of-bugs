"""Trust hierarchy tests: each tier in isolation + higher tiers winning."""
from __future__ import annotations
import json
import sqlite3
import time
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
  category TEXT NOT NULL,
  message TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  resolved_at INTEGER,
  resolved_action TEXT
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
  variant TEXT NOT NULL,
  suggested_labels TEXT NOT NULL,
  gate_rule_only TEXT NOT NULL CHECK (gate_rule_only IN ('keep','reject')),
  has_bbox INTEGER NOT NULL CHECK (has_bbox IN (0, 1)),
  bbox_x REAL, bbox_y REAL, bbox_w REAL, bbox_h REAL,
  mask_area_ratio REAL, lab_delta_e REAL, boundary_sharpness REAL,
  mask_iou_score REAL,
  crop_x REAL, crop_y REAL, crop_w REAL, crop_h REAL,
  post_crop_subject_area REAL,
  processed_at INTEGER NOT NULL,
  schema_version INTEGER NOT NULL
);

CREATE TABLE predictions (
  image_id TEXT NOT NULL REFERENCES images(image_id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  p REAL NOT NULL,
  unreliable INTEGER NOT NULL DEFAULT 0 CHECK (unreliable IN (0, 1)),
  model_version TEXT NOT NULL,
  predicted_at INTEGER NOT NULL,
  PRIMARY KEY (image_id, label)
);

CREATE TABLE gate_decisions (
  image_id TEXT PRIMARY KEY REFERENCES images(image_id) ON DELETE CASCADE,
  decision TEXT NOT NULL CHECK (decision IN ('keep','reject')),
  reason TEXT NOT NULL,
  reason_source TEXT NOT NULL CHECK (reason_source IN ('hand','report','rule','ml','default')),
  computed_at INTEGER NOT NULL,
  model_version TEXT,
  threshold_v INTEGER
);

CREATE TABLE label_thresholds (
  label TEXT PRIMARY KEY,
  tier INTEGER NOT NULL CHECK (tier IN (1, 2)),
  threshold REAL NOT NULL,
  suggested_threshold REAL,
  threshold_v INTEGER NOT NULL,
  notes TEXT,
  updated_at INTEGER NOT NULL
);
"""


def _setup_image(conn, image_id):
    conn.execute(
        "INSERT INTO images (image_id, collection_id, source, source_id, "
        "source_page_url, image_url, filename, thumbnail_filename, "
        "medium_filename, file_sha256, license, subject_state) "
        "VALUES (?, 'c', 'inaturalist', 's', 'u', 'u', 'f', 't', 'm', "
        "'sha', 'lic', 'wild')",
        (image_id,),
    )


def _insert_threshold(conn, label, tier=1, threshold=0.5):
    conn.execute(
        "INSERT INTO label_thresholds (label, tier, threshold, threshold_v, "
        "updated_at) VALUES (?, ?, ?, 1, 1779000000)",
        (label, tier, threshold),
    )


def _insert_detection(conn, image_id, suggested_labels, variant="sam3__sam3"):
    conn.execute(
        "INSERT INTO detections (image_id, variant, suggested_labels, "
        "gate_rule_only, has_bbox, processed_at, schema_version) "
        "VALUES (?, ?, ?, 'keep', 1, 1779000000000, 3)",
        (image_id, variant, json.dumps(suggested_labels)),
    )


def _insert_image_label(conn, image_id, **kwargs):
    flags = json.dumps(kwargs.get("col2_flags", []))
    c3 = json.dumps(kwargs.get("col3", []))
    c4 = json.dumps(kwargs.get("col4", []))
    conn.execute(
        "INSERT INTO image_labels (image_id, col1, col2_count, col2_flags, "
        "col3, col4, unsure, reviewed_at, user_edited, variant_tag) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            image_id,
            kwargs.get("col1", "bbox_correct-subject_not-clipped"),
            kwargs.get("col2_count", "bbox-content_single"),
            flags, c3, c4,
            int(kwargs.get("unsure", False)),
            kwargs.get("reviewed_at", 1),
            int(kwargs.get("user_edited", True)),
            kwargs.get("variant_tag", "sam3__sam3"),
        ),
    )


def _insert_report(conn, image_id, category="ai-generated", resolved=False):
    conn.execute(
        "INSERT INTO reports (image_id, category, resolved_at) "
        "VALUES (?, ?, ?)",
        (image_id, category, None if not resolved else 1779100000),
    )


def _insert_prediction(conn, image_id, label, p, unreliable=0,
                       model_version="mv@1"):
    conn.execute(
        "INSERT INTO predictions (image_id, label, p, unreliable, "
        "model_version, predicted_at) VALUES (?, ?, ?, ?, ?, 1)",
        (image_id, label, p, unreliable, model_version),
    )


@pytest.fixture
def tmp_db(tmp_path):
    db = tmp_path / "test.db"
    conn = sqlite3.connect(db)
    conn.executescript(SCHEMA)
    conn.commit()
    conn.close()
    return db


def test_default_keep_when_no_signals(tmp_db):
    from scripts.detect_subjects.sqlite_db import open_conn
    from scripts.detect_subjects.recompute_gate import recompute_for_image
    conn = open_conn(tmp_db)
    try:
        _setup_image(conn, "img-1")
        conn.commit()
        row = recompute_for_image("img-1", conn, now_s=100)
    finally:
        conn.close()
    assert row["decision"] == "keep"
    assert row["reason"] == "defaults_pass"
    assert row["reason_source"] == "default"


def test_reject_on_unresolved_report(tmp_db):
    from scripts.detect_subjects.sqlite_db import open_conn
    from scripts.detect_subjects.recompute_gate import recompute_for_image
    conn = open_conn(tmp_db)
    try:
        _setup_image(conn, "img-1")
        _insert_report(conn, "img-1", category="ai-generated")
        conn.commit()
        row = recompute_for_image("img-1", conn, now_s=100)
    finally:
        conn.close()
    assert row["decision"] == "reject"
    assert row["reason"] == "report:ai-generated"
    assert row["reason_source"] == "report"


def test_resolved_report_does_not_gate(tmp_db):
    """Reports with resolved_at set are not active; fall through."""
    from scripts.detect_subjects.sqlite_db import open_conn
    from scripts.detect_subjects.recompute_gate import recompute_for_image
    conn = open_conn(tmp_db)
    try:
        _setup_image(conn, "img-1")
        _insert_report(conn, "img-1", category="ai-generated", resolved=True)
        conn.commit()
        row = recompute_for_image("img-1", conn, now_s=100)
    finally:
        conn.close()
    assert row["decision"] == "keep"


def test_reject_on_rule_no_bug(tmp_db):
    from scripts.detect_subjects.sqlite_db import open_conn
    from scripts.detect_subjects.recompute_gate import recompute_for_image
    conn = open_conn(tmp_db)
    try:
        _setup_image(conn, "img-1")
        _insert_detection(conn, "img-1", ["bbox-content_no-bug"])
        conn.commit()
        row = recompute_for_image("img-1", conn, now_s=100)
    finally:
        conn.close()
    assert row["decision"] == "reject"
    assert row["reason"] == "rule:bbox-content_no-bug"
    assert row["reason_source"] == "rule"


def test_rule_single_does_not_gate(tmp_db):
    from scripts.detect_subjects.sqlite_db import open_conn
    from scripts.detect_subjects.recompute_gate import recompute_for_image
    conn = open_conn(tmp_db)
    try:
        _setup_image(conn, "img-1")
        _insert_detection(conn, "img-1", ["bbox-content_single"])
        conn.commit()
        row = recompute_for_image("img-1", conn, now_s=100)
    finally:
        conn.close()
    assert row["decision"] == "keep"


def test_reject_on_ml_above_threshold(tmp_db):
    from scripts.detect_subjects.sqlite_db import open_conn
    from scripts.detect_subjects.recompute_gate import recompute_for_image
    conn = open_conn(tmp_db)
    try:
        _setup_image(conn, "img-1")
        _insert_threshold(conn, "mask_blur_unusable", tier=1, threshold=0.5)
        _insert_prediction(conn, "img-1", "mask_blur_unusable", p=0.85,
                           model_version="mask_blur_unusable@1779000000")
        conn.commit()
        row = recompute_for_image("img-1", conn, now_s=100)
    finally:
        conn.close()
    assert row["decision"] == "reject"
    assert row["reason_source"] == "ml"
    assert row["reason"].startswith("ml:mask_blur_unusable:")
    assert row["model_version"] == "mask_blur_unusable@1779000000"
    assert row["threshold_v"] == 1


def test_ml_below_threshold_does_not_gate(tmp_db):
    from scripts.detect_subjects.sqlite_db import open_conn
    from scripts.detect_subjects.recompute_gate import recompute_for_image
    conn = open_conn(tmp_db)
    try:
        _setup_image(conn, "img-1")
        _insert_threshold(conn, "mask_blur_unusable", tier=1, threshold=0.5)
        _insert_prediction(conn, "img-1", "mask_blur_unusable", p=0.20)
        conn.commit()
        row = recompute_for_image("img-1", conn, now_s=100)
    finally:
        conn.close()
    assert row["decision"] == "keep"
    assert row["reason"] == "defaults_pass"


def test_unreliable_ml_does_not_gate(tmp_db):
    """unreliable=1 means tier-2 / low confidence; never gate."""
    from scripts.detect_subjects.sqlite_db import open_conn
    from scripts.detect_subjects.recompute_gate import recompute_for_image
    conn = open_conn(tmp_db)
    try:
        _setup_image(conn, "img-1")
        _insert_threshold(conn, "some_label", tier=1, threshold=0.5)
        _insert_prediction(conn, "img-1", "some_label", p=0.99, unreliable=1)
        conn.commit()
        row = recompute_for_image("img-1", conn, now_s=100)
    finally:
        conn.close()
    assert row["decision"] == "keep"


def test_tier2_label_does_not_gate(tmp_db):
    """Tier-2 labels are stored in predictions but excluded from gating."""
    from scripts.detect_subjects.sqlite_db import open_conn
    from scripts.detect_subjects.recompute_gate import recompute_for_image
    conn = open_conn(tmp_db)
    try:
        _setup_image(conn, "img-1")
        _insert_threshold(conn, "some_label", tier=2, threshold=0.5)
        _insert_prediction(conn, "img-1", "some_label", p=0.99, unreliable=0)
        conn.commit()
        row = recompute_for_image("img-1", conn, now_s=100)
    finally:
        conn.close()
    assert row["decision"] == "keep"


def test_hand_pass_overrides_lower_tiers(tmp_db):
    """Hand-reviewed clean wins over a rule-tier rejection."""
    from scripts.detect_subjects.sqlite_db import open_conn
    from scripts.detect_subjects.recompute_gate import recompute_for_image
    conn = open_conn(tmp_db)
    try:
        _setup_image(conn, "img-1")
        _insert_detection(conn, "img-1", ["bbox-content_no-bug"])  # would reject
        _insert_image_label(conn, "img-1")  # defaults clean
        conn.commit()
        row = recompute_for_image("img-1", conn, now_s=100)
    finally:
        conn.close()
    assert row["decision"] == "keep"
    assert row["reason"] == "hand:pass"
    assert row["reason_source"] == "hand"


def test_hand_reject_via_mask_label(tmp_db):
    """Hand label with col3 set -> reject; reason names the label."""
    from scripts.detect_subjects.sqlite_db import open_conn
    from scripts.detect_subjects.recompute_gate import recompute_for_image
    conn = open_conn(tmp_db)
    try:
        _setup_image(conn, "img-1")
        _insert_image_label(conn, "img-1", col3=["mask_blur_unusable"])
        conn.commit()
        row = recompute_for_image("img-1", conn, now_s=100)
    finally:
        conn.close()
    assert row["decision"] == "reject"
    assert row["reason_source"] == "hand"
    assert "mask_blur_unusable" in row["reason"]


def test_hand_unreviewed_falls_through(tmp_db):
    """An image_labels row with reviewed_at=NULL is ignored by tier 1."""
    from scripts.detect_subjects.sqlite_db import open_conn
    from scripts.detect_subjects.recompute_gate import recompute_for_image
    conn = open_conn(tmp_db)
    try:
        _setup_image(conn, "img-1")
        _insert_image_label(conn, "img-1", reviewed_at=None)
        conn.commit()
        row = recompute_for_image("img-1", conn, now_s=100)
    finally:
        conn.close()
    assert row["decision"] == "keep"
    assert row["reason"] == "defaults_pass"


def test_hand_unsure_falls_through_to_rule(tmp_db):
    """unsure=1 means 'user couldn't decide' - fall through to rule/ML/default,
    don't treat as a hand reject. Prevents undecidable cards from getting
    hidden just because the user clicked 'unsure'."""
    from scripts.detect_subjects.sqlite_db import open_conn
    from scripts.detect_subjects.recompute_gate import recompute_for_image
    conn = open_conn(tmp_db)
    try:
        _setup_image(conn, "img-1")
        _insert_detection(conn, "img-1", ["bbox-content_single"])
        # Reviewed + edited but marked unsure -> no hand signal.
        _insert_image_label(conn, "img-1", unsure=True)
        conn.commit()
        row = recompute_for_image("img-1", conn, now_s=100)
    finally:
        conn.close()
    assert row["decision"] == "keep"
    assert row["reason_source"] != "hand"


def test_recompute_for_image_writes_to_gate_decisions(tmp_db):
    from scripts.detect_subjects.sqlite_db import open_conn
    from scripts.detect_subjects.recompute_gate import recompute_for_image
    conn = open_conn(tmp_db)
    try:
        _setup_image(conn, "img-1")
        conn.commit()
        recompute_for_image("img-1", conn, now_s=100)
        row = conn.execute(
            "SELECT decision, reason, computed_at FROM gate_decisions "
            "WHERE image_id='img-1'"
        ).fetchone()
    finally:
        conn.close()
    assert row == ("keep", "defaults_pass", 100)


def test_recompute_all_creates_one_row_per_image(tmp_db):
    from scripts.detect_subjects.sqlite_db import open_conn
    from scripts.detect_subjects.recompute_gate import recompute_all
    conn = open_conn(tmp_db)
    try:
        for i in range(5):
            _setup_image(conn, f"img-{i}")
        conn.commit()
        result = recompute_all(conn, now_s=100)
        n_rows = conn.execute("SELECT COUNT(*) FROM gate_decisions").fetchone()[0]
    finally:
        conn.close()
    assert result["kept"] == 5
    assert result["rejected"] == 0
    assert n_rows == 5


def test_recompute_for_label_touches_only_relevant_images(tmp_db):
    """Recompute_for_label re-evaluates images whose label appears in predictions."""
    from scripts.detect_subjects.sqlite_db import open_conn
    from scripts.detect_subjects.recompute_gate import recompute_for_label
    conn = open_conn(tmp_db)
    try:
        _setup_image(conn, "img-1")
        _setup_image(conn, "img-2")
        _insert_threshold(conn, "mask_blur_unusable", tier=1, threshold=0.5)
        _insert_prediction(conn, "img-1", "mask_blur_unusable", p=0.85)
        # img-2 has no prediction; recompute_for_label should not touch it.
        conn.commit()
        n_touched = recompute_for_label("mask_blur_unusable", conn, now_s=100)
        row_1 = conn.execute(
            "SELECT decision FROM gate_decisions WHERE image_id='img-1'"
        ).fetchone()
        row_2 = conn.execute(
            "SELECT decision FROM gate_decisions WHERE image_id='img-2'"
        ).fetchone()
    finally:
        conn.close()
    assert n_touched == 1
    assert row_1 == ("reject",)
    assert row_2 is None  # not touched
