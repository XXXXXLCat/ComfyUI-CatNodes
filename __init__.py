# -*- coding: utf-8 -*-
"""ComfyUI-CatNodes — six V3 nodes plus an embedded infinite canvas.

Memory reclamation (VRAM / RAM), a type-safe any-type switch, two
canvas-control pass-through nodes, and an image sizing node. Front-end node
strings follow the selected ComfyUI locale through
locales/<lang>/nodeDefs.json.

An embedded infinite-canvas mode (Vue Flow) lives under ``/api/infcanvas/*``,
with its asset-loader node (InfCanvas.AssetLoader), bundled front end in
``web/canvas/`` and an offline Vue Flow runtime in ``web/canvas/vendor``.
"""

import os

WEB_DIRECTORY = "web"
__all__ = ["WEB_DIRECTORY", "comfy_entrypoint"]

from .nodes import (  # noqa: E402
    CatVRAMSweep,
    CatRAMReclaim,
    CatAnySwitch,
    CatGroupControl,
    CatNodeControl,
    CatFitImageToSize,
    InfCanvasAssetLoader,
)

from comfy_api.latest import ComfyExtension  # noqa: E402

# Trigger route registration at import time (module-level decorators / samplers).
from .canvas import server_routes  # noqa: E402,F401


_NODES = [
    CatVRAMSweep,
    CatRAMReclaim,
    CatAnySwitch,
    CatGroupControl,
    CatNodeControl,
    CatFitImageToSize,
    InfCanvasAssetLoader,
]


class CatNodesExtension(ComfyExtension):
    """Registers the CatNodes classes through the official V3 API and wires up
    the canvas integration once ComfyUI core is ready."""

    async def get_node_list(self):
        return list(_NODES)

    async def on_load(self) -> None:
        # Core is up by the time on_load runs; each install() carries its own
        # idempotency guard, so re-entry (e.g. a reload) is safe.

        # zh-* locale alias: serve the Simplified bundle to other zh-* locales
        # (zh-TW included) so a Traditional UI shows Chinese, not English.
        try:
            from .platform import locale_alias

            locale_alias.install()
        except Exception as exc:  # pragma: no cover - defensive
            print(f"[CatNodes] zh-* locale alias skipped: {exc}")

        # Per-user asset isolation (input/<user>/ & output/<user>/). Only takes
        # effect when ComfyUI is launched with --multi-user; no-op otherwise.
        try:
            from .canvas import multi_user_assets

            multi_user_assets.install()
        except Exception as exc:  # pragma: no cover - defensive
            print(f"[CatNodes] multi-user asset isolation skipped: {exc}")

        # Media Assets: canvas-only panel listing files in the account's
        # output/ and input/ trees, with download and on-disk delete.
        try:
            from .canvas import media_assets

            media_assets.install()
        except Exception as exc:  # pragma: no cover - defensive
            print(f"[CatNodes] Media Assets skipped: {exc}")

        # Infinite-canvas HTTP API (/api/infcanvas/*). register_routes() is
        # idempotent and needs a live PromptServer, so it belongs in on_load.
        try:
            server_routes.register_routes()
        except Exception as exc:  # pragma: no cover - defensive
            print(f"[InfCanvas] HTTP route registration skipped: {exc}")


async def comfy_entrypoint() -> CatNodesExtension:
    return CatNodesExtension()


try:
    import tomllib

    with open(os.path.join(os.path.dirname(__file__), "pyproject.toml"), "rb") as handle:
        _VERSION = tomllib.load(handle).get("project", {}).get("version", "unknown")
except Exception:
    _VERSION = "unknown"

print(f"[CatNodes] ComfyUI-CatNodes v{_VERSION} loaded")
print(f"[CatNodes] {len(_NODES)} nodes registered via comfy_entrypoint (V3 API)")

try:
    from . import telemetry  # noqa: E402

    telemetry.start()
except Exception as exc:  # pragma: no cover - monitor is optional
    print(f"[CatNodes] status monitor unavailable: {exc}")

print("[InfCanvas] Embedded canvas UI in web/canvas/, API at /api/infcanvas/*")
