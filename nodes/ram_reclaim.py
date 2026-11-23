# -*- coding: utf-8 -*-
"""Reclaim RAM 🐈‍⬛ — own ComfyUI cache by default, optional system file-cache reset."""

import time

from comfy_api.latest import io

from ..resources import reclaim_ram

try:
    from server import PromptServer
except Exception:  # pragma: no cover - only when imported outside ComfyUI
    PromptServer = None


class CatRAMReclaim(io.ComfyNode):
    """Clear ComfyUI's own caches, or reset the Windows system file cache.

    By default the node sets the same queue flags as ComfyUI's ``/free``
    endpoint with ``free_memory=true`` and ``unload_models=false``, so the
    executor resets its caches after the current prompt while models stay
    loaded. With ``clean_file_cache=True`` it instead resets the system-wide
    file cache through the Windows API (one pass). The node re-runs on every
    queue so the cleanup is never skipped by caching.
    """

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="🐈‍⬛CatRAMReclaim",
            display_name="Reclaim RAM 🐈‍⬛",
            category="🐈‍⬛CatNodes/Memory",
            description=(
                "By default, clear ComfyUI's execution cache after the current prompt "
                "finishes, leaving models loaded. Enable Clean file cache to reset the "
                "Windows system file cache instead (single pass, system-wide; requires "
                "privileges and may silently do nothing without them). The node re-runs "
                "on every queue so the cleanup is never skipped by caching. An optional "
                "input is passed through unchanged; details are written to the ComfyUI log."
            ),
            is_output_node=True,
            not_idempotent=True,
            inputs=[
                io.Boolean.Input(
                    "clean_file_cache",
                    default=False,
                    optional=True,
                    display_name="Clean file cache",
                    tooltip=(
                        "Off (default): clear ComfyUI's execution cache. On: reset the "
                        "Windows system file cache (system-wide; Windows only, requires "
                        "privileges)."
                    ),
                ),
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
        # Both modes are side effects and must never be skipped by caching.
        return time.monotonic()

    @classmethod
    def execute(cls, clean_file_cache=False, anything=None, **kwargs):
        try:
            if not clean_file_cache:
                if PromptServer is None or PromptServer.instance is None:
                    print("[CatNodes] RAM mode=own-cache — cache clear unavailable (no server)")
                else:
                    queue = PromptServer.instance.prompt_queue
                    queue.set_flag("unload_models", False)
                    queue.set_flag("free_memory", True)
                    print("[CatNodes] RAM mode=own-cache — execution cache queued for clearing")
            else:
                before, after = reclaim_ram(trim_cache=True, passes=1)
                if before and after:
                    freed = round(before["used_gb"] - after["used_gb"], 1)
                    print(
                        f"[CatNodes] RAM mode=clean-file-cache — "
                        f"[{before['percent']}% -> {after['percent']}%, ~{freed:.1f} GB freed]"
                    )
                else:
                    print("[CatNodes] RAM mode=clean-file-cache — finished (no sensor data)")
        except Exception as exc:
            print(f"[CatNodes] RAM release failed: {exc}")
        return io.NodeOutput(anything)
