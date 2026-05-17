"""Shared SAM 3 model instance for the Sam3Detector + Sam3Segmenter wrappers."""
from __future__ import annotations
import torch
from transformers import Sam3Model, Sam3Processor

_MODEL = None
_PROCESSOR = None
_DEVICE = None
_DTYPE = None


def get_shared_sam3(device: str = "mps", dtype: torch.dtype = torch.float32):
    """Returns (model, processor). Loads once; subsequent calls return cached instance.
    Raises ValueError if a different device or dtype is requested after first load.
    """
    global _MODEL, _PROCESSOR, _DEVICE, _DTYPE
    if _MODEL is not None:
        if device != _DEVICE or dtype != _DTYPE:
            raise ValueError(
                f"SAM 3 already loaded on device={_DEVICE} dtype={_DTYPE}; "
                f"cannot reload with device={device} dtype={dtype}"
            )
        return _MODEL, _PROCESSOR
    _PROCESSOR = Sam3Processor.from_pretrained("facebook/sam3")
    _MODEL = Sam3Model.from_pretrained("facebook/sam3").to(device=device, dtype=dtype)
    _MODEL.eval()
    _DEVICE = device
    _DTYPE = dtype
    return _MODEL, _PROCESSOR
