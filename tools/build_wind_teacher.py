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

  - **850 hPa** (`pressure/{u,v}wnd.mon.ltm.nc`, level index for 850) is
    roughly 1.5 km up -- above most surface friction, in the free
    troposphere where a Hadley/Ferrel/polar-cell idealisation (which is
    exactly what Climate v0.8's `windField` is: an analytic large-scale
    circulation with no boundary-layer drag term at all) is a much fairer
    comparison than the surface. **This is the primary teacher.**
  - **10 m** (`surface_gauss/{u,v}wnd.10m.mon.ltm.nc`) is the real surface
    wind, strongly shaped by friction, coastlines and terrain that
    Climate v0.8 has no representation of at all. Built as a **secondary**
    reference only, to make the "which level is Climate v0.8's wind closer
    to" question answerable with a real second data point instead of an
    argument from first principles alone.

**The 850 hPa topographic mask.** A pressure surface at 850 hPa sits
*underground* wherever the real surface is above roughly 1.5 km (the
Tibetan Plateau, the Andes, the Rockies, Greenland and Antarctica's
interiors). **This was checked directly, not assumed, and the first
assumption was wrong**: NCEP/NCAR Reanalysis 1's full monthly-mean record
does carry a missing value at below-ground pressure-level points, but the
pre-computed long-term-mean (`.ltm.nc`) file this script actually fetches
(for a much smaller, much faster download -- see SOURCES below) does not;
its `doMonthLTMNC4`-built climatology reports a real-looking number at
every grid point regardless of ground level. Confirmed by this script's own
sanity check failing on the first real run ("no missing-below-ground cells
found at 850hPa") rather than by reading documentation. So the mask is
built here instead, from the same LTM product's own surface-pressure
climatology (`SOURCES["surfacePressure"]`): a cell is below ground at
850 hPa wherever its climatological surface pressure is under 850 hPa.
Nothing is interpolated across the mask; masked cells are written as NaN.

**Reference period**: NCEP/NCAR Reanalysis 1's `.ltm.nc` files use PSL's
documented 1981-2010 base period (confirmed from PSL's own published
description of the product, since the file's own metadata carries only a
processing-history string, not the reference years -- see
docs/climate-v1-wind-validation.md section 7 for that gap and why the
number here is trusted anyway).

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
# Both levels use PSL's own pre-computed long-term-mean ("ltm") files rather
# than the full 1948-present monthly-mean records. Confirmed the hard way,
# not guessed: the first real attempt fetched the full 850hPa record (17
# pressure levels, ~17x more data than the one level actually used) and hit
# an HTTP 504 at PSL's own gateway; the second attempt used the 850hPa ltm
# file (fast) but kept the 10m fetch on the full record, which then ran long
# enough (cancelled after ~14 minutes still in progress) to look like the
# same problem on a single-level file that should have been much smaller --
# consistent with PSL's server being generally slow for large transfers
# through this project's proxy path, not specifically a multi-level issue.
# Both levels now use the lighter ltm file; each one's own reference period
# is read from its file's metadata at build time and recorded honestly
# rather than assumed -- see monthly_climatology() and
# docs/climate-v1-wind-validation.md section 7 for what period each
# actually turned out to be and why an exact 1991-2020 match was not
# pursued at the cost of an unreliable multi-attempt fetch.
SOURCES = {
    "u850": f"{SOURCE_BASE}/pressure/uwnd.mon.ltm.nc",
    "v850": f"{SOURCE_BASE}/pressure/vwnd.mon.ltm.nc",
    "u10m": f"{SOURCE_BASE}/surface_gauss/uwnd.10m.mon.ltm.nc",
    "v10m": f"{SOURCE_BASE}/surface_gauss/vwnd.10m.mon.ltm.nc",
    # Same 2.5-degree regular grid as the pressure-level files (not the
    # Gaussian surface_gauss grid the 10m fields use) -- confirmed at build
    # time, not assumed: the mask is only valid if built on the same grid
    # it is applied to.
    "surfacePressure": f"{SOURCE_BASE}/surface/pres.sfc.mon.ltm.nc",
}
LEVEL_HPA = 850
NCEP_LTM_PERIOD = "1981-2010"  # PSL's documented base period for .ltm.nc files -- not stated in the file's own metadata
CLIMATOLOGY_START_YEAR = 1991
CLIMATOLOGY_END_YEAR = 2020  # inclusive, matching the temperature teacher; applies to the 10m fetch only (see above)


def fetch(url, dest, cache_dir, attempts=4, timeout_s=180):
    cache_dir.mkdir(parents=True, exist_ok=True)
    path = cache_dir / dest
    if path.exists():
        print(f"  using cached {path} ({path.stat().st_size} bytes)")
        return path
    last_error = None
    for attempt in range(1, attempts + 1):
        print(f"  downloading {url} (attempt {attempt}/{attempts})")
        t0 = time.time()
        try:
            with urllib.request.urlopen(url, timeout=timeout_s) as response, open(path, "wb") as out:
                out.write(response.read())
            print(f"  fetched {path.stat().st_size} bytes in {time.time() - t0:.1f}s")
            return path
        except (urllib.error.URLError, TimeoutError) as e:
            last_error = e
            print(f"  attempt {attempt} failed after {time.time() - t0:.1f}s: {e}")
            if path.exists():
                path.unlink()
            if attempt < attempts:
                backoff = 5 * (2 ** (attempt - 1))
                print(f"  retrying in {backoff}s")
                time.sleep(backoff)
    raise SystemExit(f"failed to fetch {url} after {attempts} attempts: {last_error}")


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


def monthly_climatology(path, level_hpa=None, var_names=("uwnd", "vwnd")):
    """Returns (monthly_mean_3d [12,lat,lon], lat_1d, lon_1d, had_missing_below_ground, period_label).

    Deliberately stops at the 12-calendar-month climatology and lets the
    caller decide what to do with it -- computing a scalar mean speed
    correctly needs each *component*'s own monthly value (u and v together,
    before they are combined into a speed), not a speed already collapsed to
    one number per variable. See build_level() for where u and v are joined.

    Handles two shapes of source file, detected from the time axis rather
    than assumed from the filename:
      - a pre-computed "ltm" (long-term-mean) file: exactly 12 time steps,
        already the calendar-month climatology PSL computed. Checked
        directly (not assumed): this file's own global attributes carry
        only a processing-history string ("Created .../doMonthLTMNC4"), not
        the reference years, so the period label comes from NCEP_LTM_PERIOD
        (PSL's own published documentation) instead -- the file's raw
        attributes are still printed at build time for the record.
      - a full multi-year monthly-mean record: sliced to exactly
        CLIMATOLOGY_START_YEAR-CLIMATOLOGY_END_YEAR by real calendar dates,
        then averaged into the same [12,lat,lon] shape.
    """
    import netCDF4 as nc
    d = nc.Dataset(str(path))
    var_name = [k for k in d.variables if k in var_names][0]
    var = d.variables[var_name]
    lat = np.array(d.variables["lat"][:], dtype=np.float64)
    lon = np.array(d.variables["lon"][:], dtype=np.float64)
    n_time = d.variables["time"].shape[0]

    if level_hpa is not None:
        levels = np.array(d.variables["level"][:])
        level_indices = np.where(levels == level_hpa)[0]
        if len(level_indices) == 0:
            raise SystemExit(f"level {level_hpa} hPa not found in {path} (levels: {levels})")
        li = int(level_indices[0])
    else:
        li = None

    if n_time == 12:
        # Already a 12-month climatology (an .ltm.nc file). The file's own
        # attributes are printed for the record, but the authoritative
        # period is PSL's documented one (NCEP_LTM_PERIOD) -- see the
        # docstring above for why the attributes alone are not enough.
        raw_attrs = "; ".join(f"{attr}={getattr(d, attr)}" for attr in d.ncattrs())
        period_label = f"{NCEP_LTM_PERIOD} (PSL's documented ltm base period; file attributes: {raw_attrs})"
        raw = var[:, li, :, :] if li is not None else var[:, :, :]
        monthly_mean = np.ma.filled(raw, np.nan).astype(np.float64)  # already (12, lat, lon)
        had_missing = bool(np.isnan(monthly_mean).any())
        return monthly_mean, lat, lon, had_missing, period_label

    i0 = month_index(d.variables["time"], CLIMATOLOGY_START_YEAR, 1)
    i1 = month_index(d.variables["time"], CLIMATOLOGY_END_YEAR, 12) + 1
    n_months = i1 - i0
    n_years = CLIMATOLOGY_END_YEAR - CLIMATOLOGY_START_YEAR + 1
    if n_months != n_years * 12:
        raise SystemExit(f"expected {n_years * 12} months, got {n_months} -- check the time axis")

    raw = var[i0:i1, li, :, :] if li is not None else var[i0:i1, :, :]
    data = np.ma.filled(raw, np.nan).astype(np.float64)
    had_missing = bool(np.isnan(data).any())
    monthly = data.reshape(n_years, 12, *data.shape[1:])
    # A cell missing in every one of the 30 Januaries (say) is genuinely
    # below ground in every one of them -- nanmean over an all-NaN slice
    # correctly returns NaN with a RuntimeWarning, which is the honest
    # answer, not a bug to suppress.
    monthly_mean = np.nanmean(monthly, axis=0)  # (12, lat, lon)
    period_label = f"{CLIMATOLOGY_START_YEAR}-{CLIMATOLOGY_END_YEAR} (computed from the full monthly record)"
    return monthly_mean, lat, lon, had_missing, period_label


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


# Calendar-month index (0=Jan..11=Dec) for the DJF/JJA composites -- future
# use only (see docs/climate-v1-wind-validation.md section on seasonality);
# not analysed this stage.
DJF_MONTHS = [11, 0, 1]
JJA_MONTHS = [5, 6, 7]


def build_level(cache_dir, level_hpa, u_url, v_url, label, below_ground_mask=None):
    u_path = fetch(u_url, f"{label}_u.nc", cache_dir)
    v_path = fetch(v_url, f"{label}_v.nc", cache_dir)
    u_monthly, lat, lon, u_missing, period_label = monthly_climatology(u_path, level_hpa)  # (12, lat, lon)
    v_monthly, _, _, v_missing, _ = monthly_climatology(v_path, level_hpa)
    had_missing = bool(u_missing or v_missing)

    # The topographic mask, if the caller built one from surface pressure --
    # see main(). Applied before anything downstream is computed so every
    # derived field (annual mean, scalar speed, DJF/JJA) honestly carries
    # NaN wherever the source file's own missing values did not.
    if below_ground_mask is not None:
        if below_ground_mask.shape != u_monthly.shape[1:]:
            raise SystemExit(
                f"below_ground_mask shape {below_ground_mask.shape} does not match "
                f"{label}'s grid {u_monthly.shape[1:]} -- the mask must be built on the same raw grid"
            )
        u_monthly = np.where(below_ground_mask[None, :, :], np.nan, u_monthly)
        v_monthly = np.where(below_ground_mask[None, :, :], np.nan, v_monthly)
        had_missing = had_missing or bool(np.any(below_ground_mask))

    print(f"  {label}: grid {u_monthly.shape[2]}x{u_monthly.shape[1]}, lat[0]={lat[0]} lat[-1]={lat[-1]}, "
          f"lon[0]={lon[0]} lon[-1]={lon[-1]}, missing-below-ground found: {had_missing}")
    print(f"  {label}: climatology period = {period_label}")

    # annualMeanU/V: the plain time-mean of each *component* -- this is what
    # a monsoon reversal cancels toward zero, because opposite-signed months
    # average away. Kept separate from meanScalarSpeed on purpose; see
    # docs/climate-v1-wind-validation.md section 4.
    annual_mean_u = np.nanmean(u_monthly, axis=0)
    annual_mean_v = np.nanmean(v_monthly, axis=0)
    annual_resultant_speed = np.hypot(annual_mean_u, annual_mean_v)

    # meanScalarSpeed: speed computed *per calendar month first*, then
    # averaged -- this is the quantity a monsoon reversal does NOT cancel,
    # because sqrt(u^2+v^2) is always positive regardless of which way the
    # wind blew that month. By the triangle inequality this is always >=
    # annualResultantSpeed; how much bigger says how much of the real wind's
    # strength an annual-mean-vector model like Climate v0.8's throws away.
    monthly_speed = np.hypot(u_monthly, v_monthly)  # (12, lat, lon)
    mean_scalar_speed = np.nanmean(monthly_speed, axis=0)

    djf_u = np.nanmean(u_monthly[DJF_MONTHS], axis=0)
    djf_v = np.nanmean(v_monthly[DJF_MONTHS], axis=0)
    jja_u = np.nanmean(u_monthly[JJA_MONTHS], axis=0)
    jja_v = np.nanmean(v_monthly[JJA_MONTHS], axis=0)

    lat_north_to_south = lat  # already north-to-south, per reorient()'s own check
    return {
        "u": reorient(annual_mean_u, lat).astype(np.float32),
        "v": reorient(annual_mean_v, lat).astype(np.float32),
        "annualResultantSpeed": reorient(annual_resultant_speed, lat).astype(np.float32),
        "meanScalarSpeed": reorient(mean_scalar_speed, lat).astype(np.float32),
        "djfU": reorient(djf_u, lat).astype(np.float32), "djfV": reorient(djf_v, lat).astype(np.float32),
        "jjaU": reorient(jja_u, lat).astype(np.float32), "jjaV": reorient(jja_v, lat).astype(np.float32),
        "width": annual_mean_u.shape[1], "height": annual_mean_u.shape[0],
        "lat": lat_north_to_south, "hadMissingBelowGround": had_missing,
        "periodLabel": period_label,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--world-dir", default="worlds/kasoku-sekai")
    parser.add_argument("--cache", default="/tmp/wind-teacher-cache")
    args = parser.parse_args()
    cache_dir = pathlib.Path(args.cache)

    print(f"building Earth wind teacher ({CLIMATOLOGY_START_YEAR}-{CLIMATOLOGY_END_YEAR} climatology)")

    print("topographic mask: surface pressure climatology, for the 850hPa below-ground mask")
    pres_path = fetch(SOURCES["surfacePressure"], "pres_sfc.nc", cache_dir)
    pres_monthly, pres_lat, pres_lon, _, pres_period = monthly_climatology(pres_path, var_names=("pres",))
    print(f"  surface pressure: grid {pres_monthly.shape[2]}x{pres_monthly.shape[1]}, period = {pres_period}")
    # Annual-mean surface pressure (Pa in this product -> hPa) is enough for
    # a static mask: which cells are above/below the 850hPa surface does not
    # meaningfully change month to month, and a single mask applied to every
    # field (annual mean, scalar speed, DJF, JJA alike) is simpler and more
    # defensible than a seasonally-varying one this stage has no use for.
    # Left in the source file's own (raw) orientation here, matching
    # u_monthly/v_monthly's orientation at the point build_level() applies
    # it -- build_level reorients everything together at the very end, so
    # reorienting the mask separately here would silently misalign it.
    annual_pres_hpa = np.nanmean(pres_monthly, axis=0) / 100.0
    below_ground_850 = annual_pres_hpa < LEVEL_HPA
    print(f"  below-ground-at-850hPa cells: {int(below_ground_850.sum())}/{below_ground_850.size}")

    print("primary: 850 hPa")
    p850 = build_level(cache_dir, LEVEL_HPA, SOURCES["u850"], SOURCES["v850"], "u850v850",
                        below_ground_mask=below_ground_850)
    print("secondary: 10 m")
    p10m = build_level(cache_dir, None, SOURCES["u10m"], SOURCES["v10m"], "u10mv10m")

    for label, level in [("850hPa", p850), ("10m", p10m)]:
        finite = np.isfinite(level["annualResultantSpeed"])
        gm_resultant = area_weighted_mean(level["annualResultantSpeed"], level["lat"])
        gm_scalar = area_weighted_mean(level["meanScalarSpeed"], level["lat"])
        print(f"  {label}: {int(finite.sum())}/{level['annualResultantSpeed'].size} finite cells, "
              f"area-weighted annualResultantSpeed {gm_resultant:.2f} m/s, meanScalarSpeed {gm_scalar:.2f} m/s "
              f"(scalar >= resultant by {gm_scalar - gm_resultant:+.2f} m/s -- what a monsoon-cancelling vector "
              f"mean throws away)")

    out_dir = pathlib.Path(args.world_dir) / "teacher"
    out_dir.mkdir(exist_ok=True)

    FIELDS = ["u", "v", "annualResultantSpeed", "meanScalarSpeed", "djfU", "djfV", "jjaU", "jjaV"]

    def write_level(level, prefix):
        files = {}
        for field in FIELDS:
            path = out_dir / f"{prefix}-{field}-ms.bin"
            path.write_bytes(level[field].astype("<f4").tobytes())
            files[field] = path.name
        print(f"  wrote {len(FIELDS)} grids for {prefix} ({level['width']}x{level['height']})")
        return {
            "width": level["width"], "height": level["height"],
            "files": files,
            "dtype": "float32le", "units": "m/s",
            "hadMissingBelowGround": level["hadMissingBelowGround"],
            "climatologyPeriod": level["periodLabel"],
        }

    grids = {
        "level850hPa": write_level(p850, "wind-850hpa"),
        "level10m": write_level(p10m, "wind-10m"),
    }

    # Sanity checks, refuse to write a summary claiming success if these fail.
    failures = []
    p850_speed_mean = area_weighted_mean(p850["annualResultantSpeed"], p850["lat"])
    p10m_speed_mean = area_weighted_mean(p10m["annualResultantSpeed"], p10m["lat"])
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
    # meanScalarSpeed must never be less than annualResultantSpeed anywhere
    # finite (the triangle inequality guarantees this; a violation would mean
    # a bug in how the two were computed, not a fact about the atmosphere).
    for label, level in [("850hPa", p850), ("10m", p10m)]:
        finite = np.isfinite(level["annualResultantSpeed"]) & np.isfinite(level["meanScalarSpeed"])
        if np.any(level["meanScalarSpeed"][finite] < level["annualResultantSpeed"][finite] - 1e-3):
            failures.append(f"{label}: meanScalarSpeed < annualResultantSpeed somewhere -- should be impossible")
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
        "climatology": {
            "targetReferencePeriod": f"{CLIMATOLOGY_START_YEAR}-{CLIMATOLOGY_END_YEAR} (matches the temperature teacher)",
            "level850hPa": p850["periodLabel"],
            "level10m": p10m["periodLabel"],
            "note": "See docs/climate-v1-wind-validation.md section 7 for why the two levels may use "
                    "different periods and what that does and does not affect.",
        },
        "vectorConvention": {
            "u": "eastward component, positive = blowing toward the east",
            "v": "northward component, positive = blowing toward the north",
            "note": "This is the 'blows toward' meteorological vector convention, NOT the "
                    "'wind direction' compass convention ('a north wind' = FROM the north, "
                    "TOWARD the south) -- see docs/climate-v1-wind-validation.md section 15.",
        },
        "fields": {
            "u": "annualMeanU -- time-mean of the eastward component (a monsoon reversal cancels toward 0 here)",
            "v": "annualMeanV -- time-mean of the northward component",
            "annualResultantSpeed": "sqrt(annualMeanU^2 + annualMeanV^2) -- speed of the annually-averaged vector",
            "meanScalarSpeed": "time-mean of sqrt(u^2+v^2) computed per calendar month BEFORE averaging -- always "
                               ">= annualResultantSpeed; the gap is what an annual-mean-vector model cannot see",
            "djfU": "Dec-Jan-Feb mean U (future use -- not analysed this stage)",
            "djfV": "Dec-Jan-Feb mean V (future use -- not analysed this stage)",
            "jjaU": "Jun-Jul-Aug mean U (future use -- not analysed this stage)",
            "jjaV": "Jun-Jul-Aug mean V (future use -- not analysed this stage)",
        },
        "primaryLevel": "level850hPa",
        "secondaryLevel": "level10m",
        "grids": grids,
        "globalMeanSpeedMs": {
            "level850hPa": {"annualResultant": round(p850_speed_mean, 3),
                             "meanScalar": round(area_weighted_mean(p850["meanScalarSpeed"], p850["lat"]), 3)},
            "level10m": {"annualResultant": round(p10m_speed_mean, 3),
                         "meanScalar": round(area_weighted_mean(p10m["meanScalarSpeed"], p10m["lat"]), 3)},
        },
        "mask": {
            "method": "the pre-computed 850hPa ltm file was checked directly and does NOT come pre-masked "
                      "below ground (unlike the full monthly-mean record, which does) -- so the mask is "
                      "built here instead, from the same product's own surface-pressure ltm climatology: "
                      "a cell is masked wherever its annual-mean surface pressure is under 850 hPa. Applied "
                      "once (not seasonally) to every 850hPa field alike. Never interpolated or filled.",
            "appliesTo": "level850hPa only; level10m has no topographic mask (10m is always above the surface by definition)",
            "belowGroundCellCount": int(below_ground_850.sum()),
        },
        "builtAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    (out_dir / "wind-summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    print(f"  wrote {out_dir / 'wind-summary.json'}")


if __name__ == "__main__":
    main()
