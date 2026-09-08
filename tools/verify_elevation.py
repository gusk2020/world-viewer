#!/usr/bin/env python3
"""Check that an encoded elevation PNG really is that body's global terrain.

This exists so the pipeline fails loudly instead of committing a raster
that merely looks plausible. Every early terrain source this project tried
turned out to encode a flat zero for the whole ocean; that class of mistake
is only caught by actually reading the numbers back out, at known places,
and asserting what they should say.

The places and the numbers are **data**, not code: each world's config.json
carries a `terrain.verify` block naming landmarks on that body and the range
each one's elevation has to fall in. Earth's checks are meaningless on Mars,
so generalising the checks themselves would have been the wrong move --
what generalises is the act of checking.

Called by .github/workflows/build-terrain.yml.
"""

import sys

import numpy as np
from PIL import Image

from elevation_encoding import offset_metres, world_config


def sample(metres, lon, lat):
    height, width = metres.shape
    x = int((lon + 180.0) / 360.0 * width)
    y = int((90.0 - lat) / 180.0 * height)
    return int(metres[min(height - 1, max(0, y)), min(width - 1, max(0, x))])


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: verify_elevation.py <world-dir>")
        return 2
    world_dir = sys.argv[1]
    config = world_config(world_dir)
    verify = config["terrain"].get("verify")
    if not verify:
        print(f"ERROR: {world_dir}/config.json has no terrain.verify block")
        return 1

    # Check the level the app will actually load, not the widest one built.
    levels = sorted(config["terrain"]["levels"], key=lambda level: level["width"])
    level = next((lv for lv in levels if lv["width"] == verify["checkWidth"]), levels[-1])
    path = level["url"].lstrip("./")

    rgb = np.asarray(Image.open(path).convert("RGB")).astype(np.int32)
    metres = (rgb[:, :, 0] * 256 + rgb[:, :, 1]) - offset_metres(world_dir)
    height, width = metres.shape
    print(f"{path}: {width}x{height}, range {metres.min()}..{metres.max()} m")

    failures = []

    for check in verify["landmarks"]:
        value = sample(metres, check["lon"], check["lat"])
        low, high = check["minMetres"], check["maxMetres"]
        ok = low <= value <= high
        print(f"  {'ok ' if ok else 'BAD'} {check['label']}: {value} m "
              f"(expected {low}..{high})")
        if not ok:
            failures.append(check["label"])

    # Real relief across the whole body, not a flat fill with a few features.
    low, high = verify["lowestMetres"], verify["highestMetres"]
    if metres.min() > low:
        failures.append(f"nothing lower than {low} m -- the low ground looks flat")
    if metres.max() < high:
        failures.append(f"nothing higher than {high} m -- the high ground looks flat")

    if "belowDatumFraction" in verify:
        fraction = float(np.count_nonzero(metres < 0)) / metres.size
        expect_low, expect_high = verify["belowDatumFraction"]
        print(f"  below the datum: {fraction * 100:.1f}% of the grid "
              f"(expected {expect_low * 100:.0f}-{expect_high * 100:.0f}%)")
        if not expect_low <= fraction <= expect_high:
            failures.append("the fraction below the datum is not what this body should show")

    # Both pole rows must carry real, varying data rather than a fill value.
    # np.ptp(), not values.ptp(): the ndarray method was removed in NumPy 2.0
    # and this workflow installs numpy unpinned, so the old spelling would
    # fail here after a long download.
    for label, row in (("north", 0), ("south", height - 1)):
        values = metres[row]
        spread = int(np.ptp(values))
        print(f"  {label} pole row: mean {values.mean():.0f} m, spread {spread} m")
        if spread == 0:
            failures.append(f"{label} pole row is a constant fill value")

    # A no-data fill (-32768 on every source this project uses) survives the
    # encoding as a wildly out-of-range value, so it would show up as terrain
    # kilometres out of place rather than as an obvious hole.
    if metres.min() < -20000 or metres.max() > 30000:
        failures.append("values outside any plausible relief -- no-data fill left in?")

    if failures:
        print("\nFAILED: " + "; ".join(failures))
        return 1

    print("\nAll checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
