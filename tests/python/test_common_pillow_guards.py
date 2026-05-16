"""Unit tests for scripts.common.make_resized — verifies the Pillow
decompression-bomb cap and EXIF transpose behaviour.
"""
from __future__ import annotations
import tempfile
from pathlib import Path

import pytest
from PIL import Image

from scripts.common import make_resized


@pytest.fixture
def tmp_paths():
    with tempfile.TemporaryDirectory() as d:
        d = Path(d)
        yield d / "src.jpg", d / "dst.jpg"


def test_oversize_image_fails_gracefully(tmp_paths):
    """A synthetic 170MP image exceeds 2× the 80MP cap so Pillow raises
    DecompressionBombError on .load(). make_resized() must catch it,
    return False, and NOT leave a partial dst file behind."""
    src, dst = tmp_paths
    # 14000x12200 = 170.8 MP — above 2× the cap (= 160 MP hard threshold),
    # so Pillow raises DecompressionBombError rather than just a warning.
    Image.MAX_IMAGE_PIXELS = None  # temporarily disable to write the file
    try:
        big = Image.new("RGB", (14000, 12200), (200, 200, 200))
        big.save(src, "JPEG", quality=20)
    finally:
        Image.MAX_IMAGE_PIXELS = 80_000_000  # restore the cap
    ok = make_resized(src, dst, max_dim=512, quality=85)
    assert ok is False
    assert not dst.exists()


def test_smaller_image_succeeds(tmp_paths):
    """Sanity: a normal-sized image still resizes."""
    src, dst = tmp_paths
    img = Image.new("RGB", (1600, 1200), (50, 100, 200))
    img.save(src, "JPEG", quality=85)
    assert make_resized(src, dst, max_dim=512, quality=85) is True
    assert dst.exists()
    with Image.open(dst) as out:
        assert max(out.size) <= 512


def test_exif_transpose_applies_orientation(tmp_paths):
    """An image with EXIF Orientation=6 (rotate 90° CW for display) should
    come out rotated upright after make_resized()."""
    src, dst = tmp_paths
    # Build an obviously-portrait image: 800 wide x 1200 tall.
    img = Image.new("RGB", (800, 1200), (0, 0, 0))
    # Inject EXIF orientation tag = 6 (which means the source pixels are
    # rotated 90° CCW relative to display, so viewers should rotate 90° CW).
    exif = img.getexif()
    exif[0x0112] = 6
    img.save(src, "JPEG", exif=exif)
    assert make_resized(src, dst, max_dim=512, quality=85) is True
    with Image.open(dst) as out:
        # After transpose, the visual layout should match what the orientation
        # tag described: a landscape (wider-than-tall) image becomes portrait
        # or vice-versa depending on the original. For orientation=6 on a
        # portrait source, the output should be landscape.
        assert out.size[0] > out.size[1], (
            f"expected landscape after EXIF rotate, got {out.size}"
        )
