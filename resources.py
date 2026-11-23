# -*- coding: utf-8 -*-
"""Physical-RAM reclamation step used by 🐈‍⬛CatRAMReclaim.

VRAM sweeping now runs ComfyUI's own canonical cleanup sequence directly in
nodes/vram_sweep.py; this module only keeps the optional Windows system
file-cache reset. Windows-only ctypes calls are no-ops elsewhere.
"""

import ctypes
import platform
import time

from .sensors import read_physical_memory


_KERNEL32 = ctypes.windll.kernel32 if platform.system() == "Windows" else None


def _trim_system_file_cache():
    try:
        _KERNEL32.SetSystemFileCacheSize(-1, -1, 0)
    except Exception:
        pass


def reclaim_ram(*, trim_cache, passes):
    """Repeat the Windows system file-cache reset; return (before, after) RAM."""
    before = read_physical_memory()
    for _ in range(max(1, int(passes))):
        if _KERNEL32 is not None and trim_cache:
            _trim_system_file_cache()
        time.sleep(1)
    return before, read_physical_memory()
