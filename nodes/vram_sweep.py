# -*- coding: utf-8 -*-
"""Sweep VRAM 🐈‍⬛ — ComfyUI-core VRAM release, without extra knobs."""

import gc
import time

import comfy.model_management
import torch
from comfy_api.latest import io


class CatVRAMSweep(io.ComfyNode):
    """Release VRAM through ComfyUI's own core path.

    ComfyUI defines a canonical cleanup sequence; this node runs that sequence
    in full and re-runs on every queue so the release is never skipped by
    caching. An optional input is passed through so the node can sit inside an
    execution chain; release details are written to the ComfyUI log.
    """

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="🐈‍⬛CatVRAMSweep",
            display_name="Clear VRAM 🐈‍⬛",
            category="🐈‍⬛CatNodes/Memory",
            description=(
                "Release VRAM through ComfyUI's own cleanup sequence: unload all loaded "
                "models, run garbage collection, then soft-empty the cache. The node "
                "re-runs on every queue so the release is never skipped by caching. An "
                "optional input is passed through unchanged; release details are "
                "written to the ComfyUI log."
            ),
            is_output_node=True,
            not_idempotent=True,
            inputs=[
                io.AnyType.Input(
                    "anything",
                    optional=True,
                    tooltip=(
                        "Optional pass-through. Any value wired here is returned "
                        "unchanged, so the node can sit inside an execution chain."
                    ),
                ),
            ],
            outputs=[
                io.AnyType.Output(display_name="anything"),
            ],
        )

    @classmethod
    def fingerprint_inputs(cls, **kwargs):
        # Releasing VRAM is a side effect; a unique fingerprint forces the node
        # to run on every queue submission, even for an identical prompt.
        return time.monotonic()

    @classmethod
    def execute(cls, anything=None, **kwargs):
        try:
            before = torch.cuda.memory_allocated() if torch.cuda.is_available() else None
            comfy.model_management.unload_all_models()
            gc.collect()
            comfy.model_management.soft_empty_cache()
            after = torch.cuda.memory_allocated() if torch.cuda.is_available() else None
            if before is not None and after is not None:
                freed = (before - after) / (1024 ** 3)
                print(f"[CatNodes] VRAM release (ComfyUI core): ~{freed:.1f} GB")
            else:
                print("[CatNodes] VRAM release finished via ComfyUI core")
        except Exception as exc:
            print(f"[CatNodes] VRAM release failed: {exc}")
        return io.NodeOutput(anything)
