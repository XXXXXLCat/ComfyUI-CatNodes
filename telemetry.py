# -*- coding: utf-8 -*-
"""Latest system readings for the CatNodes status bar.

A daemon thread samples the sensors and keeps the last good values in a
lock-protected dict. The ComfyUI PromptServer serves that snapshot as JSON.
If a single sensor fails, its previous value stays on screen instead of
flickering to zero.
"""

import threading
import time

from aiohttp import web

try:
    from server import PromptServer
except Exception:  # pragma: no cover - outside a ComfyUI process
    PromptServer = None

from . import sensors

ROUTE = "/catnodes-monitor"

_snapshot = {}
_snapshot_lock = threading.Lock()
_prev_cpu_times = None
_last_gpu_poll = 0.0
_started = False


def _collect_sample():
    """Merge one round of sensor readings into the shared snapshot."""
    global _prev_cpu_times, _last_gpu_poll
    sample = {}
    now = time.time()

    memory = sensors.read_physical_memory()
    if memory is not None:
        sample["ram"] = memory

    if now - _last_gpu_poll >= 1.0:
        _last_gpu_poll = now
        gpus = sensors.read_gpu()
        if gpus is not None:
            sample["gpus"] = gpus

    ticks = sensors.read_cpu_times()
    if ticks is not None:
        if _prev_cpu_times is not None:
            prev_idle, prev_kernel, prev_user = _prev_cpu_times
            idle, kernel, user = ticks
            delta_idle = idle - prev_idle
            delta_total = (kernel - prev_kernel) + (user - prev_user)
            if delta_total > 0:
                sample["cpu"] = {
                    "percent": round(100.0 * (1.0 - delta_idle / delta_total), 1)
                }
        _prev_cpu_times = ticks

    disk = sensors.read_disk_space()
    if disk is not None:
        sample["disk"] = disk

    sample["ts"] = now
    with _snapshot_lock:
        _snapshot.update(sample)


def _sampler_loop():
    while True:
        try:
            _collect_sample()
        except Exception:
            pass  # a failed poll must never kill the sampler
        time.sleep(0.5)


async def _route(request):
    with _snapshot_lock:
        return web.json_response(dict(_snapshot))


def start():
    """Start sampling and register the status route inside ComfyUI.

    Safe to call more than once. Outside a ComfyUI process it is a no-op, so
    importing the package for offline checks has no background side effects.
    """
    global _started
    if _started:
        return False
    _started = True

    server = getattr(PromptServer, "instance", None)
    if server is None:
        return False

    threading.Thread(
        target=_sampler_loop, name="catnodes-monitor", daemon=True
    ).start()

    routes = server.routes
    # fetchApi() is the stable frontend client. Register both spellings so the
    # route resolves whether this frontend's apiURL is empty or "/api".
    for path in (ROUTE, "/api" + ROUTE):
        try:
            # RouteTableDef.get() is a decorator factory: get(path)(handler).
            routes.get(path)(_route)
        except Exception as exc:
            print(f"[CatNodes] status route {path} unavailable: {exc}")
    return True
