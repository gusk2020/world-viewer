#!/usr/bin/env python3
"""Build Teacher B: a world's real climate *structure*, reduced to eight
classes, for scoring the climate model's season/monsoon/precipitation-cycle
machinery -- the thing Teacher A (build_teacher.py) cannot see at all (see
docs/climate-model-diagnosis-after-stage7_5.md, section 4, Q1).

This is not a step toward showing Köppen classes to the user. It exists so a
change to the season/wind/rain-shadow model can be measured by something
other than the annual vegetation/arid/ice map, which barely moves when the
monsoon term is switched off.

Data: Beck, H.E., Zimmermann, N.E., McVicar, T.R., Vergopolan, N., Berg, A.,
Wood, E.F. (2018). "Present and future Köppen-Geiger climate classification
maps at 1-km resolution." Scientific Data 5:180214.
https://doi.org/10.1038/sdata.2018.214
Data repository (figshare, CC BY 4.0):
https://doi.org/10.6084/m9.figshare.6396959
The present-day 0.5-degree GeoTIFF (Beck_KG_V1_present_0p5.tif) is used --
Köppen classes are large-scale by construction, so the 1 km product would
cost bandwidth this project's data pipeline is built to avoid (see
build-terrain.yml's own reasoning) for detail this teacher has no use for.

This sandbox cannot reach figshare directly -- the same "dedicated geo-data
hosts are blocked, GitHub is not" situation build-terrain.yml already works
around -- so, like that workflow, this only runs from GitHub Actions
(.github/workflows/build-koppen-teacher.yml), never from the phone and never
by hand on the dev side.

30 Köppen classes are reduced to eight *structural groups*, using only the
standard published group boundaries (Peel, Finlayson & McMahon 2007) -- never
World Orogen's implementation of them; see the diagnosis doc, section 2, for
why. Ocean pixels are dropped entirely: this project's own GEBCO raster is
authoritative for where the coast is (the same convention build_teacher.py
uses), so Teacher B's land/sea line is decided by the app's own elevation
data, not by this dataset's.

Usage:  python3 tools/build_koppen_teacher.py worlds/kasoku-sekai [--cache DIR]
"""

import argparse
import fnmatch
import hashlib
import json
import pathlib
import re
import sys
import urllib.request
import zipfile
from datetime import datetime, timezone

import numpy as np
from PIL import Image

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from elevation_encoding import world_config  # noqa: E402

FIGSHARE_ARTICLE = 6396959
SOURCE_FILENAME = "Beck_KG_V1_present_0p5.tif"
CITATION = (
    "Beck, H.E., N.E. Zimmermann, T.R. McVicar, N. Vergopolan, A. Berg, "
    "E.F. Wood (2018). Present and future Koppen-Geiger climate "
    "classification maps at 1-km resolution. Scientific Data 5:180214. "
    "https://doi.org/10.1038/sdata.2018.214"
)
LICENSE = "CC BY 4.0 (figshare article 10.6084/m9.figshare.6396959)"

# The eight structural groups, in the same order and with the same ids as
# STRUCTURE_CLASSES in js/climate.js -- keep the two lists in sync by hand;
# there is no shared source file for them because one is Python (offline
# build-time) and one is JS (runtime), and the mapping itself is a fixed,
# public fact about the Köppen taxonomy that will not need editing once
# written.
TROPICAL_HUMID, TROPICAL_SEASONAL, ARID, TEMPERATE_HUMID = 0, 1, 2, 3
TEMPERATE_SEASONAL, COLD_HUMID, COLD_SEASONAL, POLAR = 4, 5, 6, 7
NO_DATA = 255

STRUCTURE_NAMES = [
    "tropicalHumid", "tropicalSeasonal", "arid", "temperateHumid",
    "temperateSeasonal", "coldHumid", "coldSeasonal", "polar",
]
# Placeholder colours for the paletted PNG -- never read by the scorer
# (which reads the index only), only so the file previews sensibly if opened
# by eye. Chosen close to Beck et al.'s own class colours for the group each
# reduced class stands in for.
STRUCTURE_COLOURS = [
    (0, 0, 200),      # tropicalHumid   (Af)
    (70, 170, 250),   # tropicalSeasonal (Am/Aw)
    (255, 80, 0),     # arid            (B*)
    (140, 220, 60),   # temperateHumid  (Cf*)
    (220, 220, 0),    # temperateSeasonal (Cs*/Cw*)
    (0, 200, 200),    # coldHumid       (Df*)
    (150, 60, 200),   # coldSeasonal    (Ds*/Dw*)
    (178, 178, 178),  # polar           (ET/EF)
]

# Beck's numeric code (1-30, 0=ocean) -> our reduced group. Straight from the
# standard published Köppen-Geiger letter codes (legend reproduced in this
# repository's docs/, not from any GPL-licensed project's code -- see the
# module docstring).
KOPPEN_TO_STRUCTURE = {
    0: NO_DATA,                 # ocean
    1: TROPICAL_HUMID,          # Af
    2: TROPICAL_SEASONAL,       # Am
    3: TROPICAL_SEASONAL,       # Aw
    4: ARID, 5: ARID, 6: ARID, 7: ARID,           # BWh BWk BSh BSk
    8: TEMPERATE_SEASONAL, 9: TEMPERATE_SEASONAL, 10: TEMPERATE_SEASONAL,   # Csa Csb Csc
    11: TEMPERATE_SEASONAL, 12: TEMPERATE_SEASONAL, 13: TEMPERATE_SEASONAL,  # Cwa Cwb Cwc
    14: TEMPERATE_HUMID, 15: TEMPERATE_HUMID, 16: TEMPERATE_HUMID,          # Cfa Cfb Cfc
    17: COLD_SEASONAL, 18: COLD_SEASONAL, 19: COLD_SEASONAL, 20: COLD_SEASONAL,  # Ds*
    21: COLD_SEASONAL, 22: COLD_SEASONAL, 23: COLD_SEASONAL, 24: COLD_SEASONAL,  # Dw*
    25: COLD_HUMID, 26: COLD_HUMID, 27: COLD_HUMID, 28: COLD_HUMID,              # Df*
    29: POLAR, 30: POLAR,        # ET EF
}

# Named places whose Köppen group nobody disputes. Same purpose as
# build_teacher.py's own CHECKS: a silently mis-fetched or mis-reduced
# teacher would mis-score every parameter downstream and look like a model
# bug, so this fails loudly instead.
CHECKS = [
    (-60, -3, TROPICAL_HUMID, "Amazon (Af)"),
    (114, 1, TROPICAL_HUMID, "Borneo (Af)"),
    (77.2, 28.6, TROPICAL_SEASONAL, "Delhi (Cwa/monsoon)"),
    (10, 24, ARID, "Sahara (BWh)"),
    (-2, 52, TEMPERATE_HUMID, "England (Cfb)"),
    (37.6, 55.75, COLD_SEASONAL, "Moscow (Dfb/Dwb)"),
    (129.7, 62.0, COLD_HUMID, "Yakutsk (Dfd)"),
    (0, -85, POLAR, "Antarctica interior (EF)"),
]


def fetch_source(cache: pathlib.Path) -> pathlib.Path:
    """Return a local path to the present-day 0.5-degree GeoTIFF.

    The figshare article's own file listing turned out not to offer that
    file individually -- it bundles every resolution and every future
    scenario into one archive (`Beck_KG_V1.zip`) -- so this downloads
    whichever of the article's files looks like an archive, and pulls the
    one member matching the target filename out of it. Written to tolerate
    that shape change rather than assume the single-file layout the first
    version of this function assumed, since this sandbox cannot reach
    figshare to check the listing by hand before writing the fetch code.
    """
    cache.mkdir(parents=True, exist_ok=True)
    extracted = cache / SOURCE_FILENAME
    if extracted.exists() and extracted.stat().st_size > 0:
        return extracted

    print(f"  resolving figshare article {FIGSHARE_ARTICLE} ...")
    api_url = f"https://api.figshare.com/v2/articles/{FIGSHARE_ARTICLE}"
    with urllib.request.urlopen(api_url, timeout=60) as r:
        article = json.loads(r.read())
    files = article.get("files", [])
    print(f"  article files: {[f.get('name') for f in files]}")

    # Prefer an exact match (the layout this was first written against);
    # otherwise fall back to whatever archive is offered and look inside it.
    exact = next((f for f in files if f.get("name") == SOURCE_FILENAME), None)
    if exact is not None:
        print(f"  downloading {exact['download_url']}")
        with urllib.request.urlopen(exact["download_url"], timeout=300) as r:
            extracted.write_bytes(r.read())
        return extracted

    archive_entry = next(
        (f for f in files if f.get("name", "").lower().endswith((".zip", ".tar.gz", ".tgz"))),
        None,
    )
    if archive_entry is None:
        raise SystemExit(
            f"could not find {SOURCE_FILENAME} or an archive containing it in "
            f"figshare article {FIGSHARE_ARTICLE}; files present: "
            f"{[f.get('name') for f in files]}"
        )

    archive_path = cache / archive_entry["name"]
    if not archive_path.exists() or archive_path.stat().st_size == 0:
        print(f"  downloading {archive_entry['download_url']} ({archive_entry.get('size')} bytes)")
        with urllib.request.urlopen(archive_entry["download_url"], timeout=1800) as r:
            archive_path.write_bytes(r.read())

    if not archive_path.name.lower().endswith(".zip"):
        raise SystemExit(f"don't know how to open non-zip archive {archive_path.name}")

    with zipfile.ZipFile(archive_path) as zf:
        names = zf.namelist()
        matches = [n for n in names if fnmatch.fnmatch(pathlib.Path(n).name, SOURCE_FILENAME)]
        if not matches:
            # Loosen the match if the exact filename isn't inside: any member
            # whose name mentions both "present" and "0p5" (the resolution
            # tag Beck et al.'s own naming convention uses).
            matches = [
                n for n in names
                if re.search(r"present", n, re.I) and re.search(r"0p5", n, re.I)
                and n.lower().endswith((".tif", ".tiff"))
            ]
        if not matches:
            raise SystemExit(
                f"{archive_path.name} does not contain {SOURCE_FILENAME} "
                f"(or anything matching *present*0p5*.tif); members: {names[:40]}"
            )
        member = matches[0]
        print(f"  extracting {member} from {archive_path.name}")
        with zf.open(member) as src, open(extracted, "wb") as dst:
            dst.write(src.read())
    return extracted


def read_koppen_raster(path: pathlib.Path):
    image = Image.open(path)
    array = np.asarray(image)
    if array.ndim != 2:
        array = array[:, :, 0]
    return array.astype(np.uint8)


def reduce_to_structure(raster: np.ndarray) -> np.ndarray:
    lookup = np.full(256, NO_DATA, dtype=np.uint8)
    for code, group in KOPPEN_TO_STRUCTURE.items():
        lookup[code] = group
    return lookup[raster]


def area_fractions(structure: np.ndarray) -> dict:
    height, width = structure.shape
    lat = 90 - (np.arange(height) + 0.5) / height * 180
    w = np.cos(np.deg2rad(lat))[:, None] * np.ones((1, width))
    land = structure != NO_DATA
    land_total = w[land].sum()
    globe_total = w.sum()
    out = {}
    for value, name in enumerate(STRUCTURE_NAMES):
        mask = structure == value
        out[name] = {
            "globeFraction": round(float(w[mask].sum() / globe_total), 4),
            "landFraction": round(float(w[mask].sum() / land_total), 4) if land_total > 0 else 0,
        }
    return out


def at(structure: np.ndarray, lng, lat):
    h, w = structure.shape
    x = int(round((lng + 180) / 360 * w)) % w
    y = min(h - 1, max(0, int(round((90 - lat) / 180 * h))))
    return int(structure[y, x])


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("world_dir")
    parser.add_argument("--cache", default="/tmp/koppen-cache")
    args = parser.parse_args()
    world_dir = pathlib.Path(args.world_dir)
    cache = pathlib.Path(args.cache)

    print(f"building Teacher B (climate structure) for {world_dir}")
    source_path = fetch_source(cache)
    checksum = hashlib.sha256(source_path.read_bytes()).hexdigest()
    print(f"  source: {source_path} ({source_path.stat().st_size} bytes, sha256 {checksum[:16]}...)")

    raster = read_koppen_raster(source_path)
    height, width = raster.shape
    print(f"  raw raster: {width}x{height}, {raster.min()}..{raster.max()} class codes")

    structure = reduce_to_structure(raster)

    failures = []
    print("  named-place check:")
    for lng, lat, want, label in CHECKS:
        got = at(structure, lng, lat)
        ok = got == want
        if not ok:
            failures.append(
                f"{label}: expected {STRUCTURE_NAMES[want]}, got "
                f"{'noData' if got == NO_DATA else STRUCTURE_NAMES[got]}"
            )
        got_name = "noData" if got == NO_DATA else STRUCTURE_NAMES[got]
        print(f"    {'ok  ' if ok else 'FAIL'} {label:28s} {got_name}")
    if failures:
        raise SystemExit("Teacher B failed its own checks:\n  " + "\n  ".join(failures))

    fractions = area_fractions(structure)
    print("  area fractions (of land): " + json.dumps(
        {k: v["landFraction"] for k, v in fractions.items()}
    ))

    world_config(world_dir)  # validates the world exists; result unused here
    out_dir = world_dir / "teacher"
    out_dir.mkdir(exist_ok=True)

    image = Image.fromarray(structure, mode="P")
    flat = []
    for colour in STRUCTURE_COLOURS:
        flat.extend(colour)
    flat.extend([0, 0, 0] * (256 - len(STRUCTURE_COLOURS) - 1))
    flat.extend([255, 0, 255])  # NO_DATA (255): magenta, so a stray read is obvious
    image.putpalette(flat[:768])
    map_path = out_dir / "koppen-structure.png"
    image.save(map_path, optimize=True)
    print(f"  wrote {map_path} ({map_path.stat().st_size} bytes)")

    summary = {
        "dataset": "Beck et al. (2018) Koppen-Geiger climate classification, present-day",
        "sourceFile": SOURCE_FILENAME,
        "sourceResolutionDegrees": 0.5,
        "sourceUrl": f"https://doi.org/10.6084/m9.figshare.{FIGSHARE_ARTICLE}",
        "sourceChecksumSha256": checksum,
        "retrievedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "license": LICENSE,
        "citation": CITATION,
        "outputWidth": width,
        "outputHeight": height,
        "classes": STRUCTURE_NAMES,
        "koppenGroupsPerClass": {
            "tropicalHumid": ["Af"], "tropicalSeasonal": ["Am", "Aw"],
            "arid": ["BWh", "BWk", "BSh", "BSk"],
            "temperateHumid": ["Cfa", "Cfb", "Cfc"],
            "temperateSeasonal": ["Csa", "Csb", "Csc", "Cwa", "Cwb", "Cwc"],
            "coldHumid": ["Dfa", "Dfb", "Dfc", "Dfd"],
            "coldSeasonal": ["Dsa", "Dsb", "Dsc", "Dsd", "Dwa", "Dwb", "Dwc", "Dwd"],
            "polar": ["ET", "EF"],
        },
        "areaFractions": fractions,
        "namedPlaceChecks": len(CHECKS),
        "regenerate": (
            "python3 tools/build_koppen_teacher.py worlds/<world> "
            "-- or from GitHub's Actions tab, run "
            "'Build Köppen structure teacher (Teacher B)'."
        ),
        "note": (
            "Land/sea in this map follows Beck et al.'s own coastline, not this "
            "app's GEBCO raster -- the two occasionally disagree by a pixel at "
            "the coast. js/climate.js's scorer decides land/sea from the app's "
            "own elevation raster and only reads this map's class where it "
            "already calls a pixel land, so a stray ocean-side mismatch here "
            "costs at most a handful of coastal pixels, the same tolerance "
            "build_teacher.py already accepts for Teacher A."
        ),
    }
    (out_dir / "koppen-structure-summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    print("  wrote summary")


if __name__ == "__main__":
    main()
