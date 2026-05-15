"""Shared pytest fixtures for framing detector tests."""
from __future__ import annotations
import numpy as np
import pytest
from PIL import Image


@pytest.fixture
def sample_image_rgb() -> Image.Image:
    """640x480 RGB image with a bright red rectangle on white background."""
    arr = np.full((480, 640, 3), 255, dtype=np.uint8)
    arr[180:300, 240:400] = (220, 30, 30)
    return Image.fromarray(arr, mode="RGB")


@pytest.fixture
def sample_bbox_normalized() -> tuple[float, float, float, float]:
    """Normalized bbox [x, y, w, h] for the red rectangle."""
    return (0.375, 0.375, 0.25, 0.25)


@pytest.fixture
def sample_mask_binary() -> np.ndarray:
    """480x640 boolean mask matching the red rectangle."""
    m = np.zeros((480, 640), dtype=bool)
    m[180:300, 240:400] = True
    return m
