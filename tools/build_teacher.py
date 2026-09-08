#!/usr/bin/env python3
"""Build a world's teacher data: what its surface really looks like.

The climate model is fitted and scored against this, so it is the one thing
in the project that must not be invented. Stage 5 of the climate work exists
to make it a committed, regenerable artefact with stated provenance, instead
of a byproduct sitting in a scratch directory.

Four classes, the ones the user named -- 植生 / 乾燥地 / 雪氷 / 海氷 -- plus
open sea, written as one byte per cell:

    0 sea          open water
    1 sea ice      ice on water
    2 vegetation   vegetated land
    3 arid         bare land: desert, steppe, rock, gravel
    4 land ice     permanent snow and ice on land (and floating ice shelves)

Where each class comes from, and how much to trust it:

  land/sea      GEBCO_2026, the same committed raster the globe's shape is
                built from. So the teacher and the model agree about where
                the coast is by construction, which removes a whole source
                of disagreement from the score.

  land ice      Natural Earth 1:10m "glaciated areas" and "Antarctic ice
                shelves" (public domain, naturalearthdata.com, fetched from
                the nvkelso/natural-earth-vector mirror). Real mapped ice
                extent -- the most reliable layer here.

  vegetation    the committed Blue Marble surface photograph, by colour:
  arid          G > R is vegetated, otherwise bare. Crude, but it is a real
                photograph of the real Earth, it is what the app shows the
                user as 標準, and it is therefore their own standard for
                "natural". The spec allows "信頼できる全球データまたは画像".

  sea ice       the same photograph: bright and colour-neutral water. This
                is the weakest layer -- a cloud-free composite shows one
                state of a thing that doubles in extent every winter. The
                concrete upgrade is NSIDC's Sea Ice Index (G02135) monthly
                extents, which need no login but are not reachable from the
                dev sandbox; fetch them from a GitHub runner the way the
                terrain pipeline fetches GEBCO.

Adding an era (the last glacial maximum, a warm period, any published
palaeoclimate reconstruction) means adding an entry to `teacher.eras` in the
world's config.json and a builder for it here. Nothing else in the project
knows how many eras there are.

Usage:  python3 tools/build_teacher.py worlds/kasoku-sekai [--cache DIR]
"""

import argparse
import json
import pathlib
import sys
import urllib.request

import numpy as np
from PIL import Image, ImageDraw

from elevation_encoding import world_config, offset_metres

WIDTH, HEIGHT = 2048, 1024

SEA, SEA_ICE, VEGETATION, ARID, LAND_ICE = 0, 1, 2, 3, 4
CLASS_NAMES = ["sea", "seaIce", "vegetation", "arid", "landIce"]
# Only for the human-readable preview and the in-app comparison layer; the
# score reads the class numbers, never these colours.
PALETTE = [(24, 62, 110), (176, 208, 226), (96, 132, 72), (204, 182, 138), (238, 240, 244)]

NE_BASE = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson"
NE_LAYERS = ["ne_10m_glaciated_areas", "ne_10m_antarctic_ice_shelves_polys"]

# Places whose real cover nobody disputes. The teacher is checked against
# them before it is written, because a silently mis-built teacher would
# mis-fit every parameter downstream and look like a model bug.
CHECKS = [
    (-60, -3, VEGETATION, "Amazon"),
    (20, 0, VEGETATION, "Congo"),
    (114, 1, VEGETATION, "Borneo"),
    (-2, 52, VEGETATION, "England"),
    (100, 62, VEGETATION, "Siberian taiga"),
    (-53, -12, VEGETATION, "Mato Grosso"),
    (-75, 45, VEGETATION, "eastern North America"),
    (10, 24, ARID, "Sahara"),
    (45, 22, ARID, "Arabia"),
    (135, -25, ARID, "central Australia"),
    (-69, -24, ARID, "Atacama"),
    (100, 40, ARID, "Taklamakan"),
    (-70, -47, ARID, "Patagonian steppe"),
    (0, -85, LAND_ICE, "Antarctica"),
    (-42, 72, LAND_ICE, "Greenland interior"),
    (-30, 40, SEA, "mid Atlantic"),
    (-160, 0, SEA, "mid Pacific"),
]


def fetch_layer(name, cache):
    path = cache / f"{name}.geojson"
    if not path.exists() or path.stat().st_size == 0:
        cache.mkdir(parents=True, exist_ok=True)
        url = f"{NE_BASE}/{name}.geojson"
        print(f"  fetching {url}")
        with urllib.request.urlopen(url, timeout=300) as r:
            path.write_bytes(r.read())
    return json.loads(path.read_text())


def rings_of(geometry):
    kind = geometry["type"]
    if kind == "Polygon":
        yield geometry["coordinates"]
    elif kind == "MultiPolygon":
        for polygon in geometry["coordinates"]:
            yield polygon


def draw_ring(draw, ring, value):
    """One ring, drawn in equirectangular pixel space.

    Longitudes are unwrapped first so a polygon straddling +-180 does not
    smear back across the whole map, then it is drawn at three offsets so
    whichever copy is on screen lands in the right place. PIL clips the rest.
    """
    if len(ring) < 3:
        return
    lngs = []
    previous = ring[0][0]
    for lng, _ in ring:
        while lng - previous > 180:
            lng -= 360
        while previous - lng > 180:
            lng += 360
        lngs.append(lng)
        previous = lng
    lats = [lat for _, lat in ring]
    for shift in (-360, 0, 360):
        points = [
            (((lng + shift) + 180) / 360 * WIDTH, (90 - lat) / 180 * HEIGHT)
            for lng, lat in zip(lngs, lats)
        ]
        draw.polygon(points, fill=value)


def rasterise_ice(cache):
    """Natural Earth's mapped ice, as a boolean raster."""
    mask = Image.new("L", (WIDTH, HEIGHT), 0)
    draw = ImageDraw.Draw(mask)
    total = 0
    for name in NE_LAYERS:
        data = fetch_layer(name, cache)
        for feature in data["features"]:
            for polygon in rings_of(feature["geometry"]):
                draw_ring(draw, polygon[0], 255)
                # Interior rings are holes -- a nunatak, or open water inside
                # an ice shelf. Punching them back out matters at this scale
                # for Antarctica far more than it looks.
                for hole in polygon[1:]:
                    draw_ring(draw, hole, 0)
            total += 1
    print(f"  rasterised {total} ice features")
    return np.asarray(mask) > 0


def repo_path(world_dir, url):
    """Config paths are the browser's, i.e. relative to the repo root."""
    return pathlib.Path(world_dir).resolve().parent.parent / url.lstrip("./")


def read_elevation(world_dir):
    config = world_config(world_dir)
    offset = offset_metres(world_dir)
    level = next(
        l for l in config["terrain"]["levels"] if l["width"] == WIDTH and l["height"] == HEIGHT
    )
    image = Image.open(repo_path(world_dir, level["url"])).convert("RGB")
    a = np.asarray(image).astype(np.int32)
    return a[:, :, 0] * 256 + a[:, :, 1] - offset


def read_photo(world_dir):
    config = world_config(world_dir)
    image = Image.open(repo_path(world_dir, config["globeTexture"])).convert("RGB")
    if image.size != (WIDTH, HEIGHT):
        # Area-average, never point decimation -- the same rule the terrain
        # pipeline follows, and for the same reason: a sample of one pixel
        # in four is not a fair account of the ground it stands for.
        image = image.resize((WIDTH, HEIGHT), Image.BOX)
    return np.asarray(image).astype(np.int16)


def build_present(world_dir, cache):
    elevation = read_elevation(world_dir)
    photo = read_photo(world_dir)
    ice = rasterise_ice(cache)

    r, g, b = photo[:, :, 0], photo[:, :, 1], photo[:, :, 2]
    # Bright and colour-neutral. Measured against the real texture in V0.6:
    # open water sits at (B-R)/B of 0.55-0.76 and snow at 0.00-0.09, an
    # enormous margin, which is why this separates ice from sea rather than
    # from anything else.
    white = (np.minimum(np.minimum(r, g), b) > 190) & ((r - b) < 15)

    sea = elevation < 0
    classes = np.where(g > r, VEGETATION, ARID).astype(np.uint8)
    classes[ice] = LAND_ICE
    classes[sea] = SEA
    classes[sea & white] = SEA_ICE
    # Ice that Natural Earth maps over water GEBCO calls sea: floating ice.
    classes[sea & ice] = SEA_ICE
    return classes, white, sea


def area_weights():
    lat = 90 - (np.arange(HEIGHT) + 0.5) / HEIGHT * 180
    return np.cos(np.deg2rad(lat))[:, None] * np.ones((1, WIDTH))


def summarise(classes):
    w = area_weights()
    total = w.sum()
    out = {}
    for value, name in enumerate(CLASS_NAMES):
        out[name] = round(float(w[classes == value].sum() / total), 4)
    land = classes != SEA
    land = land & (classes != SEA_ICE)
    landw = w[land].sum()
    out["landVegetation"] = round(float(w[classes == VEGETATION].sum() / landw), 4)
    out["landArid"] = round(float(w[classes == ARID].sum() / landw), 4)
    out["landIce"] = round(float(w[classes == LAND_ICE].sum() / landw), 4)
    return out


def at(classes, lng, lat):
    x = int(round((lng + 180) / 360 * WIDTH)) % WIDTH
    y = min(HEIGHT - 1, max(0, int(round((90 - lat) / 180 * HEIGHT))))
    return int(classes[y, x])


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("world_dir")
    parser.add_argument("--cache", default="/tmp/teacher-cache")
    parser.add_argument("--era", default="present")
    args = parser.parse_args()
    world_dir = pathlib.Path(args.world_dir)
    if args.era != "present":
        raise SystemExit(f"no builder for era '{args.era}' yet")

    print(f"building teacher data for {world_dir}")
    classes, white, sea = build_present(world_dir, pathlib.Path(args.cache))

    failures = []
    print("  named-place check:")
    for lng, lat, want, label in CHECKS:
        got = at(classes, lng, lat)
        ok = got == want
        if not ok:
            failures.append(f"{label}: expected {CLASS_NAMES[want]}, got {CLASS_NAMES[got]}")
        print(f"    {'ok  ' if ok else 'FAIL'} {label:24s} {CLASS_NAMES[got]}")
    if failures:
        raise SystemExit("teacher data failed its own checks:\n  " + "\n  ".join(failures))

    summary = summarise(classes)
    print("  " + json.dumps(summary))

    # How far the mapped-ice layer and the photograph's own white disagree,
    # reported rather than hidden: they are independent sources and the gap
    # is the honest measure of how much either can be trusted.
    w = area_weights()
    land = ~sea
    mapped = (classes == LAND_ICE)
    photo_white = land & white
    both = (mapped & photo_white)
    agreement = {
        "mappedIceLandFraction": round(float(w[mapped].sum() / w[land].sum()), 4),
        "photoWhiteLandFraction": round(float(w[photo_white].sum() / w[land].sum()), 4),
        "overlapOfUnion": round(float(w[both].sum() / w[mapped | photo_white].sum()), 4),
    }
    print("  ice sources: " + json.dumps(agreement))

    out_dir = world_dir / "teacher"
    out_dir.mkdir(exist_ok=True)
    image = Image.fromarray(classes, mode="P")
    flat = []
    for colour in PALETTE:
        flat.extend(colour)
    flat.extend([0] * (768 - len(flat)))
    image.putpalette(flat)
    map_path = out_dir / f"{args.era}-classes.png"
    image.save(map_path, optimize=True)
    print(f"  wrote {map_path} ({map_path.stat().st_size} bytes)")

    (out_dir / f"{args.era}-summary.json").write_text(
        json.dumps(
            {
                "era": args.era,
                "width": WIDTH,
                "height": HEIGHT,
                "classes": CLASS_NAMES,
                "areaFractions": summary,
                "iceSourceAgreement": agreement,
                "namedPlaceChecks": len(CHECKS),
            },
            indent=2,
        )
        + "\n"
    )
    print("  wrote summary")


if __name__ == "__main__":
    sys.path.insert(0, str(pathlib.Path(__file__).parent))
    main()
