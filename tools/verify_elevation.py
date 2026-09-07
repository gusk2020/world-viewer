#!/usr/bin/env python3
"""Check that an encoded elevation PNG really is global land+seafloor terrain.

This exists so the pipeline fails loudly instead of committing a raster
that merely looks plausible. Every past terrain source in this project
turned out to encode a flat zero for the whole ocean; that class of
mistake is only caught by actually reading the numbers back out, at known
places, and asserting what they should say.

Called by .github/workflows/build-terrain.yml.
"""

import sys

import numpy as np
from PIL import Image

OFFSET_M = 12000

# lon, lat, human label, and the range the value has to fall in. Kept
# loose: these rasters are area-averaged down to ~20 km cells, so a summit
# or a trench axis is flattened considerably against its true figure.
CHECKS = [
    (86.925, 27.988, "Himalaya (Everest area)", 2500, 9000),
    (142.20, 11.350, "Mariana Trench", -11500, -4000),
    (-160.0, 0.0, "mid-Pacific abyssal plain", -6500, -3000),
    (10.0, 23.0, "Sahara", 100, 1200),
    (0.0, -89.5, "South Pole (ice surface)", 1500, 4500),
    (0.0, 89.5, "North Pole (Arctic Ocean)", -5000, 0),
]


def sample(metres, lon, lat):
    height, width = metres.shape
    x = int((lon + 180.0) / 360.0 * width)
    y = int((90.0 - lat) / 180.0 * height)
    return int(metres[min(height - 1, max(0, y)), min(width - 1, max(0, x))])


def main() -> int:
    path = sys.argv[1]
    rgb = np.asarray(Image.open(path).convert("RGB")).astype(np.int32)
    metres = (rgb[:, :, 0] * 256 + rgb[:, :, 1]) - OFFSET_M
    height, width = metres.shape
    print(f"{path}: {width}x{height}, range {metres.min()}..{metres.max()} m")

    failures = []

    for lon, lat, label, low, high in CHECKS:
        value = sample(metres, lon, lat)
        ok = low <= value <= high
        print(f"  {'ok ' if ok else 'BAD'} {label}: {value} m (expected {low}..{high})")
        if not ok:
            failures.append(label)

    # Real bathymetry, not a flat ocean floor: every previous source this
    # project tried failed exactly here.
    ocean_fraction = float(np.count_nonzero(metres < 0)) / metres.size
    print(f"  below sea level: {ocean_fraction * 100:.1f}% of the grid")
    if not 0.55 <= ocean_fraction <= 0.80:
        failures.append("ocean fraction is not Earth-like")

    deep = int(np.count_nonzero(metres < -6000))
    print(f"  deeper than 6000 m: {deep} cells")
    if deep < 100:
        failures.append("no real deep ocean -- the seafloor looks flat")

    if metres.min() > -8000:
        failures.append("no trenches deeper than 8000 m")
    if metres.max() < 4000:
        failures.append("no mountains above 4000 m")

    # Both pole rows must carry real, varying data rather than a fill value.
    for label, row in (("north", 0), ("south", height - 1)):
        values = metres[row]
        print(f"  {label} pole row: mean {values.mean():.0f} m, spread {values.ptp()} m")
        if values.ptp() == 0:
            failures.append(f"{label} pole row is a constant fill value")

    if failures:
        print("\nFAILED: " + "; ".join(failures))
        return 1

    print("\nAll checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
