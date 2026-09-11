#!/usr/bin/env python3
"""Build Earth's annual-mean surface temperature teacher for Climate v1.

Climate v1 Stage 2 needs an independent measure of "how close is the
temperature field to reality" -- something Climate v0.8 never had, since it
was always fitted to the final vegetation/snow picture, never to temperature
itself. This script turns one public dataset into the small, committed grid
`tools/validate_temperature_v1.mjs` scores the model against.

Source: Berkeley Earth's Land+Ocean Gridded Temperature, native 1x1 degree
monthly file (`Land_and_Ocean_LatLong1.nc`), fetched directly -- unlike every
dedicated geodata host this project has hit before (NOAA PSL, ERA5/CDS, NASA
GISTEMP), this specific file is served from a plain public S3 bucket and is
directly reachable, confirmed by a real HTTP GET, not assumed. See
docs/climate-v1-temperature-validation.md for the comparison against the
other candidates and why this one was chosen.

The file carries two things this script combines, which is Berkeley Earth's
own documented method for getting an absolute-temperature climatology for
any period: a fixed absolute baseline climatology (their standard reference,
Jan 1951 - Dec 1980) plus a monthly anomaly time series back to 1850. Adding
the mean anomaly for a chosen 30-year window to the baseline gives that
window's own absolute climatology. This script uses Jan 1991 - Dec 2020 --
a standard, current 30-year normal period, not chosen to land near any
particular number (the model's own mean-temperature slider default of 14 C
is not a target here; see the validation doc for what the teacher's own
global mean actually came out to).

Per Berkeley Earth's own land/ocean methodology, the "temperature" variable
is *not* raw station data over land and raw SST over the ocean pasted
together -- it is a single blended "air surface temperature" field: land
cells are near-surface (~2 m) air temperature from station data, and ocean
cells are sea-surface temperature converted to an air-temperature-equivalent
basis so the two halves of the map are physically comparable at their shared
boundary. That is a closer match to what Climate v1's own
`surfaceAnnualTemperatureC` is trying to represent (one continuous "surface
temperature" field, with a different physical process warming/cooling land
vs. sea) than combining two separately-sourced land-only and ocean-only
products would have been -- see the validation doc, section 3.

License: Creative Commons BY-NC 4.0 (attribution required, non-commercial
use only). This script commits only a small derived grid (a few hundred KB),
not the source file, with the source, variable, resolution and reference
period stated in the summary JSON this script writes -- exactly what CC
BY-NC 4.0 asks a derivative work to state. This project is a personal,
non-commercial hobby app; re-check licensing before any commercial use.
"""
import argparse
import json
import pathlib
import struct
import sys
import time
import urllib.request

import numpy as np

SOURCE_URL = "https://berkeley-earth-temperature.s3.amazonaws.com/Global/Gridded/Land_and_Ocean_LatLong1.nc"
CLIMATOLOGY_START_YEAR = 1991
CLIMATOLOGY_END_YEAR = 2020  # inclusive
BASELINE_LABEL = "1951-1980"  # Berkeley Earth's own fixed absolute-climatology baseline in this file


def month_index(base_year, year, month):
    """Index into the file's monthly time axis (Jan `base_year` = index 0)."""
    return (year - base_year) * 12 + (month - 1)


def fetch(url, dest, cache_dir):
    cache_dir.mkdir(parents=True, exist_ok=True)
    path = cache_dir / dest
    if path.exists():
        print(f"  using cached {path} ({path.stat().st_size} bytes)")
        return path
    print(f"  downloading {url}")
    t0 = time.time()
    urllib.request.urlretrieve(url, path)
    print(f"  fetched {path.stat().st_size} bytes in {time.time() - t0:.1f}s")
    return path


def build(source_path, url_for_record):
    import netCDF4 as nc

    d = nc.Dataset(str(source_path))
    lat = np.ma.filled(d.variables["latitude"][:], np.nan).astype(np.float64)
    lon = np.ma.filled(d.variables["longitude"][:], np.nan).astype(np.float64)
    land_mask = np.ma.filled(d.variables["land_mask"][:], np.nan)
    clim = np.ma.filled(d.variables["climatology"][:], np.nan)  # (12, lat, lon)
    file_base_year = 1850  # this file's own time axis; confirmed from its `time` variable

    i0 = month_index(file_base_year, CLIMATOLOGY_START_YEAR, 1)
    i1 = month_index(file_base_year, CLIMATOLOGY_END_YEAR, 12) + 1
    n_years = CLIMATOLOGY_END_YEAR - CLIMATOLOGY_START_YEAR + 1
    temp = np.ma.filled(d.variables["temperature"][i0:i1], np.nan)  # (n_years*12, lat, lon)
    if temp.shape[0] != n_years * 12:
        raise SystemExit(
            f"expected {n_years * 12} months for {CLIMATOLOGY_START_YEAR}-{CLIMATOLOGY_END_YEAR}, "
            f"got {temp.shape[0]} -- source file's time axis may not start where this script assumes"
        )

    anomaly_by_month = temp.reshape(n_years, 12, *temp.shape[1:]).mean(axis=0)  # (12, lat, lon)
    absolute_by_month = clim + anomaly_by_month
    annual_mean = absolute_by_month.mean(axis=0).astype(np.float32)  # (lat, lon), lat[0] = south

    # This file's own lat/lon run south-to-north and -180..180 west-to-east.
    # The project's own grid convention (elevation.js, the teacher-class PNG)
    # is row 0 = north pole, increasing row = south -- flip latitude only;
    # longitude already starts at the west edge the same way.
    if not (lat[0] < lat[-1]):
        raise SystemExit("expected the source file's latitude axis to run south to north")
    annual_mean = np.flipud(annual_mean)
    lat_north_to_south = lat[::-1]
    land_mask_reoriented = np.flipud(land_mask)

    return {
        "width": annual_mean.shape[1],
        "height": annual_mean.shape[0],
        "annual_mean_c": annual_mean,
        "lat_north_to_south": lat_north_to_south,
        "lon": lon,
        "land_mask": land_mask_reoriented,
        "source_last_modified": None,
    }


def area_weighted_mean(values, lat_deg, mask=None):
    w = np.cos(np.deg2rad(lat_deg))[:, None] * np.ones((1, values.shape[1]))
    finite = np.isfinite(values)
    if mask is not None:
        finite = finite & mask
    return float(np.average(values[finite], weights=w[finite]))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--world-dir", default="worlds/kasoku-sekai")
    parser.add_argument("--source", default=None, help="local path to Land_and_Ocean_LatLong1.nc (skips download)")
    parser.add_argument("--cache", default="/tmp/temperature-teacher-cache")
    parser.add_argument("--url", default=SOURCE_URL)
    args = parser.parse_args()

    if args.source:
        source_path = pathlib.Path(args.source)
        if not source_path.exists():
            raise SystemExit(f"--source {source_path} does not exist")
        file_size = source_path.stat().st_size
    else:
        source_path = fetch(args.url, "Land_and_Ocean_LatLong1.nc", pathlib.Path(args.cache))
        file_size = source_path.stat().st_size

    print("building Earth annual-mean temperature teacher "
          f"({CLIMATOLOGY_START_YEAR}-{CLIMATOLOGY_END_YEAR} climatology)")
    built = build(source_path, args.url)
    annual_mean = built["annual_mean_c"]
    lat = built["lat_north_to_south"]
    land_mask = built["land_mask"]

    n = annual_mean.size
    finite = np.isfinite(annual_mean)
    missing = int((~finite).sum())
    missing_frac = missing / n
    global_mean = area_weighted_mean(annual_mean, lat)
    land_mean = area_weighted_mean(annual_mean, lat, mask=(land_mask > 0.5))
    sea_mean = area_weighted_mean(annual_mean, lat, mask=(land_mask <= 0.5))

    print(f"  grid {built['width']}x{built['height']}, missing cells {missing} ({missing_frac:.4%})")
    print(f"  global mean {global_mean:.3f} C, land (BE mask) {land_mean:.3f} C, sea (BE mask) {sea_mean:.3f} C")

    # Refuse to write anything implausible -- the same discipline
    # build_teacher.py uses for the discrete classes. These are sanity
    # bounds, not a fit target: Earth's real land+ocean annual mean has sat
    # within a couple of degrees of 14-15 C for the whole instrumental
    # record, land is reliably colder than the ocean on an area-weighted
    # basis (more high-latitude and continental-interior extremes), and a
    # dataset built from real, mostly-complete station/ship coverage should
    # not be missing more than a trace of its cells.
    failures = []
    if not (10.0 <= global_mean <= 18.0):
        failures.append(f"implausible global mean {global_mean:.2f} C")
    if not (land_mean < sea_mean):
        failures.append(f"land mean ({land_mean:.2f} C) is not colder than sea mean ({sea_mean:.2f} C)")
    if missing_frac > 0.01:
        failures.append(f"too many missing cells: {missing} ({missing_frac:.4%})")
    if built["width"] != 360 or built["height"] != 180:
        failures.append(f"unexpected grid shape {built['width']}x{built['height']}, expected 360x180")
    if failures:
        raise SystemExit("temperature teacher failed its own checks:\n  " + "\n  ".join(failures))

    out_dir = pathlib.Path(args.world_dir) / "teacher"
    out_dir.mkdir(exist_ok=True)
    bin_path = out_dir / "temperature-annual-mean-c.bin"
    with open(bin_path, "wb") as f:
        f.write(annual_mean.astype("<f4").tobytes())
    print(f"  wrote {bin_path} ({bin_path.stat().st_size} bytes)")

    summary = {
        "_note": (
            "Earth's real annual-mean surface temperature, for Climate v1's temperature "
            "field to be validated against (never fitted to it -- see "
            "docs/climate-v1-temperature-validation.md). Built by "
            "tools/build_temperature_teacher.py."
        ),
        "source": {
            "product": "Berkeley Earth Land+Ocean Gridded Temperature (native 1x1 degree, monthly)",
            "file": "Land_and_Ocean_LatLong1.nc",
            "url": args.url,
            "fileSizeBytes": file_size,
            "institution": "Berkeley Earth Surface Temperature Project",
            "variable": (
                "Air Surface Temperature -- land cells: near-surface (~2 m) air temperature "
                "from station data; ocean cells: sea-surface temperature converted to an "
                "air-temperature-equivalent basis. One blended field, Berkeley Earth's own "
                "convention, not raw SST."
            ),
            "license": (
                "Creative Commons BY-NC 4.0 (attribution required, non-commercial use only). "
                "This repository commits only a small derived grid (not the source file), "
                "for climate-model validation in a non-commercial hobby project."
            ),
            "citation": "Berkeley Earth Surface Temperature Project, https://berkeleyearth.org/data/",
        },
        "climatology": {
            "referencePeriod": f"{CLIMATOLOGY_START_YEAR}-{CLIMATOLOGY_END_YEAR}",
            "method": (
                "Berkeley Earth's own fixed absolute baseline climatology "
                f"(Jan {BASELINE_LABEL.split('-')[0]} - Dec {BASELINE_LABEL.split('-')[1]}, from this "
                "same file) plus the mean monthly anomaly over the reference period, from this "
                "same file's anomaly time series -- Berkeley Earth's own documented method for "
                "an absolute climatology of any period."
            ),
            "baselinePeriod": BASELINE_LABEL,
        },
        "grid": {
            "width": built["width"],
            "height": built["height"],
            "resolutionDeg": 1.0,
            "row0": "north pole (cell centre ~89.5N)",
            "col0": "cell centre ~-179.5, increasing eastward",
            "valuesFile": "temperature-annual-mean-c.bin",
            "dtype": "float32le",
            "units": "degC",
            "missingValue": "NaN",
        },
        "missingCells": missing,
        "missingFraction": round(missing_frac, 6),
        "globalMeanC": round(global_mean, 3),
        "landMeanC_BerkeleyMask": round(land_mean, 3),
        "seaMeanC_BerkeleyMask": round(sea_mean, 3),
        "builtAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    (out_dir / "temperature-summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    print(f"  wrote {out_dir / 'temperature-summary.json'}")


if __name__ == "__main__":
    main()
