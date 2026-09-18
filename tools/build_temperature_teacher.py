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
import hashlib
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
    # The same flip, applied to all twelve months. This array was already
    # being computed and thrown away; keeping it is the whole seasonal
    # teacher, and it needs no second source, URL, download or licence.
    monthly_mean = np.flip(absolute_by_month, axis=1).astype(np.float32)
    lat_north_to_south = lat[::-1]
    land_mask_reoriented = np.flipud(land_mask)

    return {
        "width": annual_mean.shape[1],
        "height": annual_mean.shape[0],
        "annual_mean_c": annual_mean,
        "monthly_mean_c": monthly_mean,
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

    write_monthly(out_dir, built, lat, land_mask, summary)


MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
               "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def write_monthly(out_dir, built, lat, land_mask, annual_summary):
    """The seasonal teacher: the same twelve months the annual mean averages.

    This is not a second dataset. `absolute_by_month` is what `build()`
    already computes and then collapses, so the monthly teacher shares the
    annual one's source file, grid, orientation, mask, units, reference
    period and licence **by construction** -- there is nothing here that
    could drift out of step with it.

    Nothing is interpolated and no missing cell is filled. The one hard
    condition is the identity below: the mean of the twelve committed months
    must reproduce the committed annual field. If it does not, this refuses
    to write, because a seasonal teacher that disagrees with the annual one
    would quietly corrupt every comparison made against either.
    """
    monthly = built["monthly_mean_c"]                 # (12, 180, 360) float32
    annual = built["annual_mean_c"]                   # (180, 360) float32
    if monthly.shape != (12, annual.shape[0], annual.shape[1]):
        raise SystemExit(f"unexpected monthly shape {monthly.shape}")

    # --- the identity that has to hold ------------------------------------
    # Computed in float64 from the float32 values that will actually be
    # written, so this compares the committed bytes rather than the
    # higher-precision intermediates they came from.
    reconstructed = monthly.astype(np.float64).mean(axis=0)
    both = np.isfinite(reconstructed) & np.isfinite(annual)
    diff = np.abs(reconstructed[both] - annual[both].astype(np.float64))
    max_diff = float(diff.max()) if diff.size else 0.0
    mean_diff = float(diff.mean()) if diff.size else 0.0
    # Float32 carries ~7 significant digits; around 300 K that is ~3e-5 K per
    # value, and averaging twelve of them cannot do worse than a few times
    # that. 1e-3 C is comfortably above the rounding and far below anything
    # that could matter physically -- tight enough to catch a real mistake
    # (a wrong flip, a shifted month, a different baseline) at once.
    tolerance_c = 1e-3
    monthly_missing = [int((~np.isfinite(monthly[m])).sum()) for m in range(12)]
    annual_missing = int((~np.isfinite(annual)).sum())

    failures = []
    if max_diff > tolerance_c:
        failures.append(
            f"the mean of the twelve months does not reproduce the annual teacher: "
            f"max |difference| {max_diff:.3e} C > {tolerance_c:.0e} C"
        )
    if int(both.sum()) + annual_missing != annual.size:
        failures.append("monthly and annual disagree about which cells are missing")
    if failures:
        raise SystemExit("monthly temperature teacher failed its own checks:\n  " + "\n  ".join(failures))

    bin_path = out_dir / "temperature-monthly-mean-c.bin"
    payload = monthly.astype("<f4").tobytes()
    with open(bin_path, "wb") as f:
        f.write(payload)
    print(f"  wrote {bin_path} ({bin_path.stat().st_size} bytes)")
    print(f"  annual reconstruction: max |diff| {max_diff:.3e} C, mean |diff| {mean_diff:.3e} C")

    land = land_mask > 0.5
    sea = land_mask <= 0.5
    months = []
    for m in range(12):
        months.append({
            "index": m,
            "name": MONTH_NAMES[m],
            # The observation phase this month stands for, on the model's own
            # [0,1) orbital axis: a monthly mean is the middle of its month,
            # NOT its first instant, so January is 0.5/12 rather than 0.
            # The mapping onto `orbitalPhase` (whose 0 is the ascending
            # equinox, not January) is the validator's job, never this file's.
            "observationPhase": round((m + 0.5) / 12, 6),
            "globalMeanC": round(area_weighted_mean(monthly[m], lat), 3),
            "landMeanC": round(area_weighted_mean(monthly[m], lat, mask=land), 3),
            "seaMeanC": round(area_weighted_mean(monthly[m], lat, mask=sea), 3),
            "missingCells": monthly_missing[m],
        })

    summary = {
        "_note": (
            "Earth's real monthly-mean surface temperature climatology -- the twelve months "
            "whose average IS the committed annual teacher. Built by the same run of "
            "tools/build_temperature_teacher.py, from the same file, so the grid, orientation, "
            "mask, units and reference period match the annual teacher by construction. "
            "Intended as the CALIBRATION teacher for the seasonal model's amplitude and "
            "phase; NCEP's monthly air.2m is the separate validation-only teacher. See "
            "docs/climate-v1-calibration-audit.md."
        ),
        "source": annual_summary["source"],
        "climatology": annual_summary["climatology"],
        "grid": {
            **annual_summary["grid"],
            "shape": [12, built["height"], built["width"]],
            "valuesFile": "temperature-monthly-mean-c.bin",
            "axisOrder": "month (0 = January), then row (0 = north pole), then column",
        },
        "phaseConvention": (
            "Stored in calendar-month order. A month's observation phase is "
            "(monthIndex + 0.5) / 12 -- the middle of the month, not its start. "
            "January is NOT phase 0; the model's own orbitalPhase 0 is the ascending "
            "equinox, and aligning the two is the validator's responsibility."
        ),
        "months": months,
        "annualReconstruction": {
            "method": "mean of the twelve committed float32 months, compared with the committed annual field",
            "maxAbsDifferenceC": max_diff,
            "meanAbsDifferenceC": mean_diff,
            "toleranceC": tolerance_c,
            "passed": True,
        },
        "missingCellsPerMonth": monthly_missing,
        "missingCellsAnnual": annual_missing,
        "sha256": hashlib.sha256(payload).hexdigest(),
        "byteLength": len(payload),
        "builtAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    (out_dir / "temperature-monthly-summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    print(f"  wrote {out_dir / 'temperature-monthly-summary.json'}")

    # Sanity check only -- printed, never asserted against a target, and
    # nothing here is fitted. A teacher whose 45N land swing came out at 2 C
    # would be broken in a way no tolerance above would catch.
    print("  seasonal sanity check (min / max / half-amplitude / peak month):")
    for label, lng, lat_deg in [
        ("45N land (France)", 5.0, 45.5),
        ("45N ocean (N Pacific)", -170.0, 45.5),
        ("equatorial land (Congo)", 20.0, 0.5),
        ("60N land (Siberia)", 100.0, 60.5),
        ("45S land (Chile)", -71.0, -45.5),
    ]:
        col = int((lng + 180.0) % 360.0)
        row = int((90.0 - lat_deg))
        series = monthly[:, row, col]
        if not np.all(np.isfinite(series)):
            print(f"    {label:<24} (missing)")
            continue
        lo, hi = float(series.min()), float(series.max())
        peak = MONTH_NAMES[int(np.argmax(series))]
        print(f"    {label:<24} {lo:7.2f} / {hi:7.2f} / {(hi - lo) / 2:6.2f} / {peak}")


if __name__ == "__main__":
    main()
