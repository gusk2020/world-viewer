"""Derive a world's water-surface mask from assets already in the repo.

Climate v1 Stage 5A.6 needs to know which cells are a **water surface** --
ocean *and* lakes -- as distinct from which cells are ocean (Stage 5A.5's
`isSea`) and which are merely below sea level.

Connectivity answers the ocean question and cannot answer the lake one: a
lake is not connected to the sea, which is exactly what makes it a lake.
The surface photograph answers the lake question and cannot answer the ocean
one: measured globally, it misses **47.0% of the Arctic Ocean** because that
ocean is covered in ice. The two are complementary, and this file supplies
the half that connectivity cannot see.

**Why a derived file at all.** The photograph is a JPEG, and this project has
no dependencies, so node cannot decode it -- `tools/png.mjs` reads PNG only.
Rather than add a dependency or a decoder, the detection runs here, once,
offline, and commits one small paletted PNG. **No network, and no external
dataset**: the only inputs are the world's own committed elevation raster and
its own committed surface photograph.

**The detector is the app's own.** `js/surface.js`'s `growSeabedOverWater`
already separates water from land in this very image, by the blue *ratio*
(b - r) / b rather than a blue difference -- calibrated there against the
real texture, where open water sits at 0.55-0.76 and snow/ice at 0.00-0.09,
with every land cover negative. Reusing that threshold rather than inventing
a second one keeps the two from drifting apart.

**What the output is, and is not.** One byte per cell: 1 where the
photograph shows a water surface, 0 elsewhere. It is NOT a lake mask and NOT
an ocean mask -- splitting it into ocean and lake depends on sea level, so
js/climate-v1/terrain.js does that at build time and can redo it whenever sea
level moves.

Usage: python3 tools/build_water_mask.py [--world worlds/kasoku-sekai]
"""
import argparse
import json
import pathlib

import numpy as np
from PIL import Image

# js/surface.js's WATER_BLUE_RATIO, deliberately the same number.
WATER_BLUE_RATIO = 0.3


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--world", default="worlds/kasoku-sekai")
    args = parser.parse_args()
    repo = pathlib.Path(__file__).resolve().parent.parent
    world_dir = repo / args.world
    config = json.loads((world_dir / "config.json").read_text())

    # Match the elevation grid Climate v1 actually reads: the widest level at
    # or below 2048, which is what pickElevationLevel selects today.
    level = max((l for l in config["terrain"]["levels"] if l["width"] <= 2048),
                key=lambda l: l["width"])
    elev = Image.open(repo / level["url"].lstrip("./")).convert("RGB")
    width, height = elev.size

    photo_path = repo / config["globeTexture"].lstrip("./")
    # BOX = area average, matching how the terrain pipeline downsamples
    # (-r average). Picking every Nth pixel would drop narrow water outright.
    photo = np.asarray(
        Image.open(photo_path).convert("RGB").resize((width, height), Image.BOX)
    ).astype(np.float32)
    r, g, b = photo[:, :, 0], photo[:, :, 1], photo[:, :, 2]
    ratio = np.where(b > 0, (b - r) / np.maximum(b, 1e-6), -1.0)
    water = (b > g) & (ratio > WATER_BLUE_RATIO)

    lat = 90 - (np.arange(height) + 0.5) * 180 / height
    weight = np.cos(np.radians(lat))[:, None] * np.ones((1, width))
    fraction = float((weight * water).sum() / weight.sum())

    # Sanity checks, wide on purpose: they prove the mask is this world's real
    # water, they do not measure it. Refuse to write rather than commit a
    # mask that is obviously not a planet's water.
    def at(lng, la):
        return (min(height - 1, max(0, int((90 - la) / 180 * height))),
                min(width - 1, max(0, int((lng + 180) / 360 * width))))

    checks = [
        ("water covers 50-80% of the globe", 0.50 < fraction < 0.80, f"{fraction * 100:.2f}%"),
        ("the mid-Pacific is water", water[at(-160, 0)], ""),
        ("the Sahara is not water", not water[at(10, 23)], ""),
        ("the Amazon basin is not water", not water[at(-60, -3)], ""),
        ("Antarctica's interior is not water", not water[at(0, -82)], ""),
        # The lake half is the entire reason this file exists, so check it.
        ("the Caspian Sea is water", water[at(51, 42)], ""),
        ("Lake Baikal is water", water[at(108, 53.5)], ""),
        ("the dry Jordan valley is not water", not water[at(35.55, 32.2)], ""),
    ]
    failed = [name for name, ok, _ in checks if not ok]
    for name, ok, measured in checks:
        print(f"  {'OK  ' if ok else 'FAIL'} {name}{f'  [{measured}]' if measured else ''}")
    if failed:
        raise SystemExit(f"refusing to write the mask: {len(failed)} check(s) failed")

    out_dir = world_dir / "masks"
    out_dir.mkdir(parents=True, exist_ok=True)
    img = Image.fromarray(water.astype(np.uint8), mode="P")
    img.putpalette([0, 0, 0, 0, 0, 255] + [0] * (254 * 3))
    out = out_dir / "water-surface.png"
    # 8-bit paletted: tools/png.mjs reads 8-bit only, and a 1-bit depth PNG
    # (which Pillow will happily write) fails there with a depth error.
    img.save(out, optimize=True)
    print(f"\nwrote {out} ({out.stat().st_size} bytes, {width}x{height})")

    (out_dir / "water-surface-summary.json").write_text(json.dumps({
        "_note": (
            "Where the world's surface photograph shows a water surface: ocean AND lakes. "
            "Derived offline from assets already in this repo -- no network and no external "
            "dataset. Splitting this into ocean and lake depends on sea level and is done by "
            "js/climate-v1/terrain.js, not here. See docs/climate-v1-water-surface-stage5a6.md."
        ),
        "source": {
            "photograph": config["globeTexture"],
            "elevationLevel": level["url"],
            "detector": "js/surface.js's blue-ratio test, (b-r)/b > WATER_BLUE_RATIO",
            "waterBlueRatio": WATER_BLUE_RATIO,
        },
        "width": width, "height": height,
        "waterFractionOfGlobe": fraction,
        "checks": [{"name": n, "passed": bool(ok), "measured": m} for n, ok, m in checks],
    }, indent=1) + "\n")


if __name__ == "__main__":
    main()
