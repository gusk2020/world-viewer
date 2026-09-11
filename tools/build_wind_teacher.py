#!/usr/bin/env python3
"""Build Earth's annual-mean wind teacher for Climate v1 Stage 3.

Climate v0.8's wind field has never been checked against anything real --
Stage 0-1 established (from the code, not by guessing) that it is a
dimensionless, latitude-only direction+relative-strength field with no real
m/s meaning anywhere. This script builds the real reference to measure that
against: NCEP/NCAR Reanalysis 1's monthly-mean u/v wind, at two levels, over
a 1991-2020 climatology (the same period the temperature teacher uses).

Source: NOAA Physical Sciences Laboratory, `downloads.psl.noaa.gov`. Blocked
from this project's usual dev sandbox (like every dedicated geodata host
this project has hit before -- GEBCO, the planetary DEMs, the Koppen
classification), so this script is meant to run from
.github/workflows/build-wind-teacher.yml, on a GitHub Actions runner, the
same pattern this project has used since V0.6.

Two pressure/height levels, and this is the part worth reading before
touching anything downstream (see docs/climate-v1-wind-validation.md
section 6 for the full reasoning):

  - **850 hPa** (`pressure/{u,v}wnd.mon.mean.nc`, level index for 850) is
    roughly 1.5 km up -- above most surface friction, in the free
    troposphere where a Hadley/Ferrel/polar-cell idealisation (which is
    exactly what Climate v0.8's `windField` is: an analytic large-scale
    circulation with no boundary-layer drag term at all) is a much fairer
    comparison than the surface. **This is the primary teacher.**
  - **10 m** (`surface_gauss/{u,v}wnd.10m.mon.mean.nc`) is the real surface
    wind, strongly shaped by friction, coastlines and terrain that
    Climate v0.8 has no representation of at all. Built as a **secondary**
    reference only, to make the "which level is Climate v0.8's wind closer
    to" question answerable with a real second data point instead of an
    argument from first principles alone.

**The 850 hPa topographic mask.** A pressure surface at 850 hPa sits
*underground* wherever the real surface is above roughly 1.5 km (the
Tibetan Plateau, the Andes, the Rockies, Greenland and Antarctica's
interiors) -- NCEP/NCAR Reanalysis 1's own pressure-level files already
encode this as a missing value at those grid points (verified directly by
this script: printed at build time, not assumed), so no separate surface-
pressure comparison is needed. Cells missing in the source file stay
missing in the teacher; nothing is interpolated or invented to fill them.

License: NCEP/NCAR Reanalysis is produced by NOAA, a US federal agency, and
carries no reuse restriction -- PSL only asks for acknowledgement in
publications, which this teacher's summary JSON provides.
"""
import argparse
import json
import pathlib
import time
import urllib.request

import numpy as np

SOURCE_BASE = "https://downloads.psl.noaa.gov/Datasets/ncep.reanalysis.derived"
SOURCES = {
    "u850": f"{SOURCE_BASE}/pressure/uwnd.mon.mean.nc",
    "v850": f"{SOURCE_BASE}/pressure/vwnd.mon.mean.nc",
    "u10m": f"{SOURCE_BASE}/surface_gauss/uwnd.10m.mon.mean.nc",
    "v10m": f"{SOURCE_BASE}/surface_gauss/vwnd.10m.mon.mean.nc",
}
LEVEL_HPA = 850
CLIMATOLOGY_START_YEAR = 1991
CLIMATOLOGY_END_YEAR = 2020  # inclusive, matching the temperature teacher


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


def month_index(time_var, year, month):
    """NCEP/NCAR Reanalysis time units are 'hours since 1-1-1 00:00:0.0' --
    read the units string rather than assume, and locate months by their
    actual calendar date, not by a hand-counted offset."""
    import netCDF4 as nc
    dates = nc.num2date(time_var[:], time_var.units, only_use_cftime_datetimes=False)
    for i, d in enumerate(dates):
        if d.year == year and d.month == month:
            return i
    raise SystemExit(f"could not find {year}-{month:02d} in the time axis (units={time_var.units})")


def climatology_annual_mean(path, level_hpa=None):
    """Returns (annual_mean_2d, lat_1d, lon_1d, had_missing_below_ground)."""
    import netCDF4 as nc
    d = nc.Dataset(str(path))
    var_name = [k for k in d.variables if k in ("uwnd", "vwnd")][0]
    var = d.variables[var_name]
    lat = np.array(d.variables["lat"][:], dtype=np.float64)
    lon = np.array(d.variables["lon"][:], dtype=np.float64)

    i0 = month_index(d.variables["time"], CLIMATOLOGY_START_YEAR, 1)
    i1 = month_index(d.variables["time"], CLIMATOLOGY_END_YEAR, 12) + 1
    n_months = i1 - i0
    n_years = CLIMATOLOGY_END_YEAR - CLIMATOLOGY_START_YEAR + 1
    if n_months != n_years * 12:
        raise SystemExit(f"expected {n_years * 12} months, got {n_months} -- check the time axis")

    if level_hpa is not None:
        levels = np.array(d.variables["level"][:])
        level_indices = np.where(levels == level_hpa)[0]
        if len(level_indices) == 0:
            raise SystemExit(f"level {level_hpa} hPa not found in {path} (levels: {levels})")
        li = int(level_indices[0])
        raw = var[i0:i1, li, :, :]
    else:
        raw = var[i0:i1, :, :]

    data = np.ma.filled(raw, np.nan).astype(np.float64)
    had_missing = bool(np.isnan(data).any())
    monthly = data.reshape(n_years, 12, *data.shape[1:])
    monthly_mean = np.nanmean(monthly, axis=0)  # (12, lat, lon) -- missing stays missing only if ALL years missing there
    # A cell missing in every one of the 30 Januaries (say) is genuinely
    # below ground in every one of them -- nanmean over an all-NaN slice
    # correctly returns NaN with a RuntimeWarning, which is the honest
    # answer, not a bug to suppress.
    annual_mean = np.nanmean(monthly_mean, axis=0)  # (lat, lon)
    return annual_mean, lat, lon, had_missing


def reorient(grid, lat):
    """This project's convention: row 0 = north pole, row increasing = south;
    column 0 = -180 degrees, increasing eastward. NCEP/NCAR Reanalysis 1
    ships latitude north-to-south already (checked, not assumed -- see the
    printed lat[0]/lat[-1] at build time) and longitude 0..357.5 (not
    -180..180), so only longitude needs rewrapping."""
    if not (lat[0] > lat[-1]):
        raise SystemExit("expected NCEP/NCAR Reanalysis 1's latitude axis to run north to south")
    width = grid.shape[1]
    half = width // 2
    # lon runs 0, 2.5, 5, ..., 357.5 -- the western half (0..177.5) belongs
    # at the right of a -180-based map and the eastern half (180..357.5) at
    # the left, so swap the two halves.
    return np.concatenate([grid[:, half:], grid[:, :half]], axis=1)


def area_weighted_mean(values, lat_deg):
    w = np.cos(np.deg2rad(lat_deg))[:, None] * np.ones((1, values.shape[1]))
    finite = np.isfinite(values)
    return float(np.average(values[finite], weights=w[finite]))


def build_level(cache_dir, level_hpa, u_url, v_url, label):
    u_path = fetch(u_url, f"{label}_u.nc", cache_dir)
    v_path = fetch(v_url, f"{label}_v.nc", cache_dir)
    u, lat, lon, u_missing = climatology_annual_mean(u_path, level_hpa)
    v, _, _, v_missing = climatology_annual_mean(v_path, level_hpa)
    print(f"  {label}: grid {u.shape[1]}x{u.shape[0]}, lat[0]={lat[0]} lat[-1]={lat[-1]}, "
          f"lon[0]={lon[0]} lon[-1]={lon[-1]}, missing-below-ground found: {u_missing or v_missing}")
    u_r = reorient(u, lat)
    v_r = reorient(v, lat)
    lat_north_to_south = lat  # already north-to-south, per reorient()'s own check
    return {
        "u": u_r.astype(np.float32), "v": v_r.astype(np.float32),
        "width": u_r.shape[1], "height": u_r.shape[0],
        "lat": lat_north_to_south, "hadMissingBelowGround": bool(u_missing or v_missing),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--world-dir", default="worlds/kasoku-sekai")
    parser.add_argument("--cache", default="/tmp/wind-teacher-cache")
    args = parser.parse_args()
    cache_dir = pathlib.Path(args.cache)

    print(f"building Earth wind teacher ({CLIMATOLOGY_START_YEAR}-{CLIMATOLOGY_END_YEAR} climatology)")
    print("primary: 850 hPa")
    p850 = build_level(cache_dir, LEVEL_HPA, SOURCES["u850"], SOURCES["v850"], "u850v850")
    print("secondary: 10 m")
    p10m = build_level(cache_dir, None, SOURCES["u10m"], SOURCES["v10m"], "u10mv10m")

    for label, level in [("850hPa", p850), ("10m", p10m)]:
        speed = np.hypot(level["u"], level["v"])
        finite = np.isfinite(speed)
        gm = area_weighted_mean(speed, level["lat"])
        print(f"  {label}: {int(finite.sum())}/{speed.size} finite cells, "
              f"area-weighted mean resultant speed {gm:.2f} m/s, max {np.nanmax(speed):.1f} m/s")

    out_dir = pathlib.Path(args.world_dir) / "teacher"
    out_dir.mkdir(exist_ok=True)

    def write_level(level, prefix):
        u_path = out_dir / f"{prefix}-u-ms.bin"
        v_path = out_dir / f"{prefix}-v-ms.bin"
        u_path.write_bytes(level["u"].astype("<f4").tobytes())
        v_path.write_bytes(level["v"].astype("<f4").tobytes())
        print(f"  wrote {u_path} and {v_path} ({level['width']}x{level['height']})")
        return {
            "width": level["width"], "height": level["height"],
            "uFile": u_path.name, "vFile": v_path.name,
            "dtype": "float32le", "units": "m/s",
            "hadMissingBelowGround": level["hadMissingBelowGround"],
        }

    grids = {
        "level850hPa": write_level(p850, "wind-850hpa"),
        "level10m": write_level(p10m, "wind-10m"),
    }

    # Sanity checks, refuse to write a summary claiming success if these fail.
    failures = []
    p850_speed_mean = area_weighted_mean(np.hypot(p850["u"], p850["v"]), p850["lat"])
    p10m_speed_mean = area_weighted_mean(np.hypot(p10m["u"], p10m["v"]), p10m["lat"])
    # Real Earth: the free troposphere is windier than the friction-slowed
    # surface, and neither should be a near-zero or absurd number.
    if not (3.0 <= p10m_speed_mean <= 12.0):
        failures.append(f"implausible 10m mean speed {p10m_speed_mean:.2f} m/s")
    if not (4.0 <= p850_speed_mean <= 20.0):
        failures.append(f"implausible 850hPa mean speed {p850_speed_mean:.2f} m/s")
    if not (p850_speed_mean > p10m_speed_mean):
        failures.append("850hPa is not windier than 10m on average -- expected the free troposphere to be windier")
    if not p850["hadMissingBelowGround"]:
        failures.append("no missing-below-ground cells found at 850hPa -- expected some over Tibet/Andes/ice sheets")
    if failures:
        raise SystemExit("wind teacher failed its own checks:\n  " + "\n  ".join(failures))

    summary = {
        "_note": (
            "Earth's real annual-mean wind, for Climate v1's wind field to be validated "
            "against -- never fitted to it. See docs/climate-v1-wind-validation.md. Built "
            "by tools/build_wind_teacher.py."
        ),
        "source": {
            "product": "NCEP/NCAR Reanalysis 1, monthly means (derived)",
            "urls": SOURCES,
            "institution": "NOAA Physical Sciences Laboratory",
            "license": "US federal government work -- no reuse restriction. PSL requests acknowledgement in publications.",
            "citation": "NCEP/NCAR Reanalysis 1, NOAA/OAR/ESRL PSL, https://psl.noaa.gov/data/gridded/data.ncep.reanalysis.html",
        },
        "climatology": {"referencePeriod": f"{CLIMATOLOGY_START_YEAR}-{CLIMATOLOGY_END_YEAR}"},
        "vectorConvention": {
            "u": "eastward component, positive = blowing toward the east",
            "v": "northward component, positive = blowing toward the north",
            "note": "This is the 'blows toward' meteorological vector convention, NOT the "
                    "'wind direction' compass convention ('a north wind' = FROM the north, "
                    "TOWARD the south) -- see docs/climate-v1-wind-validation.md section 15.",
        },
        "primaryLevel": "level850hPa",
        "secondaryLevel": "level10m",
        "grids": grids,
        "globalMeanResultantSpeedMs": {
            "level850hPa": round(p850_speed_mean, 3),
            "level10m": round(p10m_speed_mean, 3),
        },
        "mask": {
            "method": "source file's own missing value at grid points below the 850 hPa surface "
                      "(confirmed present at build time -- see build log), never interpolated or filled",
            "appliesTo": "level850hPa only; level10m has no topographic mask (10m is always above the surface by definition)",
        },
        "builtAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    (out_dir / "wind-summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    print(f"  wrote {out_dir / 'wind-summary.json'}")


if __name__ == "__main__":
    main()
