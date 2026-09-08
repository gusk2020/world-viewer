#!/usr/bin/env python3
"""One source of truth for how elevation rasters are packed into PNGs.

The offset used to keep metres non-negative has to agree in three places at
once -- the encoder, the verifier, and the browser -- or the app silently
reads elevations that are wrong by a fixed amount rather than failing. The
browser reads it from the world's config.json, so the tools read it from
there too instead of each carrying their own copy of the number.
"""

import json
import pathlib


def world_config(world_dir) -> dict:
    return json.loads((pathlib.Path(world_dir) / "config.json").read_text())


def offset_metres(world_dir) -> int:
    """terrain.encoding.offsetMetres from a world's config.json.

    Chosen there so the whole real range of Earth's relief (Challenger Deep
    at about -10.9 km, Everest at about +8.8 km) fits inside an unsigned
    16-bit value with room to spare.
    """
    encoding = world_config(world_dir)["terrain"]["encoding"]
    if encoding["type"] != "rg16-metres":
        raise SystemExit(f"unsupported elevation encoding: {encoding['type']}")
    return int(encoding["offsetMetres"])
