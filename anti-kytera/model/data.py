"""Readers for the committed rasters. Everything returned is SOUTH-first
(row 0 = southernmost) with column 0 at -180, matching grid.LatLonGrid."""
import os

import numpy as np
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OFFSET_M = 12000  # worlds/kasoku-sekai/config.json terrain.encoding.offsetMetres


def read_rg16(path):
    a = np.asarray(Image.open(path).convert("RGB")).astype(np.int32)
    m = a[..., 0] * 256 + a[..., 1] - OFFSET_M
    return m[::-1].astype(np.float64)       # PNG row 0 is north


def surface_2048():
    """GEBCO_2026 ice-surface elevation, area-averaged 4096x2048 -> 2048x1024."""
    s = read_rg16(os.path.join(ROOT, "worlds/kasoku-sekai/terrain/gebco2026_ice_4096x2048.png"))
    return s.reshape(1024, 2, 2048, 2).mean(axis=(1, 3))


def bed_2048():
    """GEBCO_2026 sub-ice topography (bedrock under the ice sheets)."""
    return read_rg16(os.path.join(ROOT, "anti-kytera/data/gebco2026_subice_2048x1024.png"))
