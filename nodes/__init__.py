# -*- coding: utf-8 -*-
"""CatNodes V3 node classes, one module per node."""

from .vram_sweep import CatVRAMSweep
from .ram_reclaim import CatRAMReclaim
from .any_switch import CatAnySwitch
from .group_control import CatGroupControl
from .node_control import CatNodeControl
from .fit_image_to_size import CatFitImageToSize
from .infcanvas_asset_loader import InfCanvasAssetLoader

__all__ = [
    "CatVRAMSweep",
    "CatRAMReclaim",
    "CatAnySwitch",
    "CatGroupControl",
    "CatNodeControl",
    "CatFitImageToSize",
    "InfCanvasAssetLoader",
]
