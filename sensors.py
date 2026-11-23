# -*- coding: utf-8 -*-
"""System sensors for the CatNodes status bar.

Standard library only. Windows counters use ctypes; GPU readings come from
nvidia-smi. Every reader returns None when its source is unavailable, so the
status bar can keep showing the last good values instead of failing.
"""

import ctypes
import os
import platform
import subprocess

_IS_WINDOWS = platform.system() == "Windows"
_KERNEL32 = ctypes.windll.kernel32 if _IS_WINDOWS else None


class _FILETIME(ctypes.Structure):
    _fields_ = [("lo", ctypes.c_uint32), ("hi", ctypes.c_uint32)]


class _MEMORYSTATUSEX(ctypes.Structure):
    _fields_ = [
        ("length", ctypes.c_uint32),
        ("load", ctypes.c_uint32),
        ("total_phys", ctypes.c_uint64),
        ("avail_phys", ctypes.c_uint64),
        ("total_page", ctypes.c_uint64),
        ("avail_page", ctypes.c_uint64),
        ("total_virtual", ctypes.c_uint64),
        ("avail_virtual", ctypes.c_uint64),
        ("avail_ext", ctypes.c_uint64),
    ]


def read_cpu_times():
    """Return (idle, kernel, user) 64-bit tick counters, or None."""
    if _KERNEL32 is None:
        return None
    idle, kern, user = _FILETIME(), _FILETIME(), _FILETIME()
    if not _KERNEL32.GetSystemTimes(ctypes.byref(idle), ctypes.byref(kern), ctypes.byref(user)):
        return None
    return (
        (idle.hi << 32) | idle.lo,
        (kern.hi << 32) | kern.lo,
        (user.hi << 32) | user.lo,
    )


def read_physical_memory():
    """Physical RAM snapshot as {used_gb, total_gb, percent}, or None."""
    if _KERNEL32 is None:
        return None
    status = _MEMORYSTATUSEX()
    status.length = ctypes.sizeof(_MEMORYSTATUSEX)
    if not _KERNEL32.GlobalMemoryStatusEx(ctypes.byref(status)):
        return None
    total = status.total_phys / (1024 ** 3)
    used = (status.total_phys - status.avail_phys) / (1024 ** 3)
    return {
        "used_gb": round(used, 1),
        "total_gb": round(total, 1),
        "percent": status.load,
    }


def read_disk_space():
    """Free space on the system drive as {name, free_gb, total_gb}, or None."""
    if _KERNEL32 is None:
        return None
    drive = os.path.splitdrive(os.path.abspath(__file__))[0] + "\\"
    total = ctypes.c_ulonglong()
    free = ctypes.c_ulonglong()
    if not _KERNEL32.GetDiskFreeSpaceExW(
        ctypes.c_wchar_p(drive), None, ctypes.byref(total), ctypes.byref(free)
    ):
        return None
    return {
        "name": drive,
        "free_gb": round(free.value / (1024 ** 3), 1),
        "total_gb": round(total.value / (1024 ** 3), 1),
    }


def _to_float(text):
    try:
        return float(text)
    except (TypeError, ValueError):
        return 0.0


def read_gpu():
    """Per-GPU usage / VRAM / temperature from nvidia-smi, or None.

    The query runs in a hidden window with a short timeout; no GPU, a missing
    nvidia-smi, or a slow driver simply yields None.
    """
    args = [
        "nvidia-smi",
        "--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu",
        "--format=csv,noheader,nounits",
    ]
    options = {"capture_output": True, "text": True, "timeout": 3}
    if _IS_WINDOWS:
        options["creationflags"] = 0x08000000  # CREATE_NO_WINDOW
    try:
        result = subprocess.run(args, **options)
    except Exception:
        return None
    if result.returncode != 0:
        return None
    gpus = []
    for line in result.stdout.strip().splitlines():
        parts = [part.strip() for part in line.split(",")]
        if len(parts) < 5:
            continue
        gpus.append({
            "name": parts[0],
            "usage": _to_float(parts[1]),
            "vram_used_gb": round(_to_float(parts[2]) / 1024.0, 1),
            "vram_total_gb": round(_to_float(parts[3]) / 1024.0, 1),
            "temp": _to_float(parts[4]),
        })
    return gpus or None
