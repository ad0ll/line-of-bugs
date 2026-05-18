"""Shared SAM 3 model + per-thread processors.

Model is a true singleton (multi-GB GPU resident). Processor instances are
fresh per call site to avoid the documented thread-safety hazard — they're
cheap CPU-only wrappers around the tokenizer + image preprocessor.
"""
from __future__ import annotations
import torch
from transformers import Sam3Model, Sam3Processor

_MODEL = None
_PROCESSOR = None
_DEVICE = None
_DTYPE = None


def get_shared_sam3(device: str = "mps", dtype: torch.dtype = torch.float32):
    """Returns (model, processor). The MODEL is a true singleton (loaded
    once, ~multi-GB GPU resident). The processor returned here is also the
    shared instance — fine for single-threaded callers. Multi-threaded
    callers should construct their own processor via `make_thread_processor()`
    to avoid contention on processor-internal state.
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


def make_thread_processor() -> Sam3Processor:
    """Fresh Sam3Processor for a worker thread. The processor is a CPU-only
    wrapper around tokenizer + image preprocessor; building it costs ~50ms
    of disk read and a few MB of memory. CLAUDE.md notes Sam3Processor
    is not thread-safe, so each inference worker should call this once at
    init and reuse its own instance.
    """
    return Sam3Processor.from_pretrained("facebook/sam3")
