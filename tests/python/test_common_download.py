"""Unit tests for scripts.common._download_stream — verifies atomic
write semantics: partial / oversize / network-error downloads never
leave a half-file at out_path.
"""
from __future__ import annotations
import tempfile
from pathlib import Path
from unittest.mock import MagicMock

import pytest
import requests

from scripts.common import _download_stream


class _FakeResponse:
    """Minimal context-manager mock for requests.Session.get(stream=True)."""

    def __init__(self, status_code: int, chunks: list[bytes],
                 raise_mid: Exception | None = None,
                 content_type: str = "image/jpeg"):
        self.status_code = status_code
        self._chunks = chunks
        self._raise_mid = raise_mid
        self.headers = {"Content-Type": content_type}

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def iter_content(self, _chunk_size: int):
        for chunk in self._chunks:
            yield chunk
        if self._raise_mid is not None:
            raise self._raise_mid


@pytest.fixture
def tmp_out():
    with tempfile.TemporaryDirectory() as d:
        yield Path(d) / "img.jpg"


def test_successful_download_writes_full_file(tmp_out):
    s = MagicMock(spec=requests.Session)
    s.get.return_value = _FakeResponse(200, [b"AAAA", b"BBBB"])
    ok, size, reason = _download_stream(s, "https://x", tmp_out, max_bytes=1024)
    assert ok is True
    assert size == 8
    assert reason == "ok"
    assert tmp_out.read_bytes() == b"AAAABBBB"
    # tmp sidecar should not linger
    assert not tmp_out.with_suffix(tmp_out.suffix + ".tmp").exists()


def test_oversize_aborts_without_leaving_partial_file(tmp_out):
    """If the stream exceeds max_bytes mid-download, out_path must NOT
    exist — the partial bytes go to the tmp sidecar which is cleaned up."""
    s = MagicMock(spec=requests.Session)
    s.get.return_value = _FakeResponse(200, [b"A" * 600, b"B" * 600])
    ok, size, reason = _download_stream(s, "https://x", tmp_out, max_bytes=1000)
    assert ok is False
    assert reason == "oversize"
    assert not tmp_out.exists(), "partial download must not be readable as out_path"
    assert not tmp_out.with_suffix(tmp_out.suffix + ".tmp").exists()


def test_network_error_mid_stream_leaves_no_file(tmp_out):
    """A RequestException raised mid-iter_content must not leave a
    half-file at out_path. The tmp sidecar is unlinked."""
    s = MagicMock(spec=requests.Session)
    s.get.return_value = _FakeResponse(
        200, [b"AAAA"], raise_mid=requests.ConnectionError("boom"),
    )
    ok, size, reason = _download_stream(s, "https://x", tmp_out, max_bytes=1024)
    assert ok is False
    assert reason.startswith("err_")
    assert not tmp_out.exists()
    assert not tmp_out.with_suffix(tmp_out.suffix + ".tmp").exists()


def test_non_200_response_leaves_no_file(tmp_out):
    s = MagicMock(spec=requests.Session)
    s.get.return_value = _FakeResponse(404, [])
    ok, size, reason = _download_stream(s, "https://x", tmp_out, max_bytes=1024)
    assert ok is False
    assert reason == "http_404"
    assert not tmp_out.exists()
    assert not tmp_out.with_suffix(tmp_out.suffix + ".tmp").exists()


def test_non_image_content_type_is_rejected(tmp_out):
    """Many CDNs serve a 200 OK HTML interstitial (captcha / login /
    'rate limited') instead of the real image. The fetcher must catch
    this on Content-Type rather than save a 1.4 KB HTML file as .jpg."""
    s = MagicMock(spec=requests.Session)
    s.get.return_value = _FakeResponse(
        200, [b"<html>nope</html>"], content_type="text/html; charset=utf-8",
    )
    ok, size, reason = _download_stream(s, "https://x", tmp_out, max_bytes=1024)
    assert ok is False
    assert reason == "non-image-content-type"
    assert not tmp_out.exists()
    assert not tmp_out.with_suffix(tmp_out.suffix + ".tmp").exists()


def test_preexisting_partial_at_out_path_is_not_accepted(tmp_out):
    """If a resume run sees a 0-byte file already at out_path (from a
    crashed prior run), the atomic-write behaviour means the next
    successful download overwrites it cleanly via tmp+rename."""
    tmp_out.write_bytes(b"")  # simulate pre-existing partial file
    s = MagicMock(spec=requests.Session)
    s.get.return_value = _FakeResponse(200, [b"OK" * 4])
    ok, size, reason = _download_stream(s, "https://x", tmp_out, max_bytes=1024)
    assert ok is True
    assert tmp_out.read_bytes() == b"OK" * 4
    assert not tmp_out.with_suffix(tmp_out.suffix + ".tmp").exists()
