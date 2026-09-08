#!/usr/bin/env python3
"""Pack a raw Int16 elevation grid into a lossless PNG the browser can read.

Why this encoding rather than a plain greyscale height image:

* A canvas hands JavaScript back 8-bit samples no matter what the source
  file held, so a genuine 16-bit greyscale PNG would silently lose its low
  byte the moment the page read it. Splitting the value across two 8-bit
  channels survives that round trip.
* PNG, not JPEG: the packing is only meaningful if every byte is preserved
  exactly. JPEG would quietly corrupt low bytes into plausible-looking
  nonsense, i.e. wrong elevations rather than obviously broken ones.
* The value stored is real metres, offset to keep it non-negative:
      metres = (R * 256 + G) - offset
  so the client never has to guess a scale, and sea level is exactly 0. The
  offset comes from the world's own config.json, which is also where the
  browser reads it -- see tools/elevation_encoding.py.

Called by .github/workflows/build-terrain.yml.
"""

import os
import sys

import numpy as np
from PIL import Image

from elevation_encoding import offset_metres


def main() -> int:
    if len(sys.argv) != 6:
        print(
            "usage: encode_elevation.py <raw.bin> <width> <height> <out.png> "
            "<world-dir>"
        )
        return 2

    raw_path, width, height, out_path, world_dir = (
        sys.argv[1],
        int(sys.argv[2]),
        int(sys.argv[3]),
        sys.argv[4],
        sys.argv[5],
    )
    offset = offset_metres(world_dir)

    expected = width * height * 2
    actual = os.path.getsize(raw_path)
    if actual != expected:
        print(f"ERROR: {raw_path} is {actual} bytes, expected {expected}")
        return 1

    metres = np.fromfile(raw_path, dtype="<i2").reshape(height, width).astype(np.int32)

    packed = metres + offset
    clipped = int(np.count_nonzero((packed < 0) | (packed > 65535)))
    if clipped:
        # Never expected with real GEBCO data; loud rather than silent so a
        # future dataset with a wilder range doesn't get quietly mangled.
        print(f"WARNING: {clipped} samples outside the encodable range, clamped")
    packed = np.clip(packed, 0, 65535).astype(np.uint16)

    rgb = np.zeros((height, width, 3), dtype=np.uint8)
    rgb[:, :, 0] = (packed >> 8).astype(np.uint8)
    rgb[:, :, 1] = (packed & 0xFF).astype(np.uint8)

    Image.fromarray(rgb, mode="RGB").save(out_path, optimize=True)

    print(
        f"{out_path}: {width}x{height}, "
        f"{os.path.getsize(out_path) / 1e6:.2f} MB, "
        f"range {metres.min()}..{metres.max()} m"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
