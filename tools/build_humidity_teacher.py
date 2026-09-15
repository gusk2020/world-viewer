"""Build Climate v1's Stage 5A humidity teacher.

Earth's real annual-mean **surface pressure**, **near-surface air
temperature** and **near-surface specific humidity**, for Stage 5A's
thermodynamics to be validated against -- never fitted to. Stage 5A has no
free parameters, so that promise is structural rather than a matter of
discipline.

**What this teacher is for.** Stage 5A computes saturation specific
humidity: a capacity, not a state. Surface pressure and air temperature are
what actually test it -- they are its two inputs, and a wrong unit, a wrong
grid orientation or a wrong approximation shows up in them immediately. The
specific humidity grid is here only so that an implied relative humidity
(q_observed / q_sat_model) can be checked for physical plausibility; it is
NOT a target for the model to reproduce, because Stage 5A contains no
process that could reproduce it. That belongs to Stage 5B.

**Source**: NCEP/NCAR Reanalysis 1 (NOAA/OAR/ESRL PSL). US federal
government work -- no reuse restriction; PSL asks for acknowledgement in
publications, which the summary JSON provides. The wind teacher already
fetches this product's surface-pressure file, so the path is proven rather
than assumed.

**Candidate URLs are tried in order and the one that works is recorded.**
Nothing here guesses which file exists: a run that cannot reach a field says
so and refuses to write a partial teacher. The 2026-09-15 probe found PSL
returning HTTP 504 for every URL including a known-good control, so
transient unavailability is expected and retried rather than mistaken for a
missing file.

Usage: python3 tools/build_humidity_teacher.py [--world worlds/kasoku-sekai]
"""
import argparse
import json
import pathlib
import sys

import numpy as np

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
# Reused rather than copied: this project has a standing lesson about one
# sampler existing twice and being able to drift (CLAUDE.md, the V0.6
# cleanup pass). build_wind_teacher.py is not modified by this script.
from build_wind_teacher import fetch, monthly_climatology, reorient, area_weighted_mean  # noqa: E402

SOURCE_BASE = "https://downloads.psl.noaa.gov/Datasets/ncep.reanalysis.derived"

# Each field lists candidates in preference order: a pre-computed long-term
# mean first (small and fast), the full monthly record as a fallback. The
# variable names are the ones NCEP/NCAR R1 actually uses; the run prints
# which candidate won and the summary records it.
FIELDS = {
    "surfacePressureHPa": {
        "candidates": [
            (f"{SOURCE_BASE}/surface/pres.sfc.mon.ltm.nc", "pres.sfc.mon.ltm.nc"),
            (f"{SOURCE_BASE}/surface/pres.sfc.mon.mean.nc", "pres.sfc.mon.mean.nc"),
        ],
        "vars": ("pres",),
        "units": "hPa",
    },
    "airTemperatureC": {
        "candidates": [
            (f"{SOURCE_BASE}/surface_gauss/air.2m.mon.ltm.nc", "air.2m.mon.ltm.nc"),
            (f"{SOURCE_BASE}/surface/air.sig995.mon.ltm.nc", "air.sig995.mon.ltm.nc"),
            (f"{SOURCE_BASE}/surface_gauss/air.2m.mon.mean.nc", "air.2m.mon.mean.nc"),
        ],
        "vars": ("air",),
        "units": "degC",
    },
    "specificHumidityKgPerKg": {
        "candidates": [
            (f"{SOURCE_BASE}/surface_gauss/shum.2m.mon.ltm.nc", "shum.2m.mon.ltm.nc"),
            (f"{SOURCE_BASE}/surface_gauss/shum.2m.mon.mean.nc", "shum.2m.mon.mean.nc"),
        ],
        "vars": ("shum",),
        "units": "kg/kg",
        "optional": True,  # only used for the implied-RH plausibility check
    },
}


def annual_mean_field(cache_dir, spec, label):
    """Fetch the first reachable candidate and return its annual mean.

    Returns (grid_2d, lat, lon, provenance) or (None, None, None, reason).
    """
    errors = []
    for url, dest in spec["candidates"]:
        try:
            # Eight attempts, not the default four: PSL's gateway returns
            # 504 in bursts that last minutes. Measured across four real
            # runs, one fetched everything first try, one needed three
            # attempts per field, and one never got surface pressure at all
            # in eight tries across two candidates. The cache directory is
            # persisted between runs by the workflow, so attempts accumulate
            # rather than starting over.
            path = fetch(url, dest, cache_dir, attempts=8)
        except SystemExit as e:
            errors.append(f"{url}: {e}")
            print(f"  {label}: {url} unavailable, trying the next candidate")
            continue
        monthly, lat, lon, had_missing, period = monthly_climatology(path, None, spec["vars"])
        annual = np.nanmean(monthly, axis=0)
        return annual, lat, lon, {"url": url, "period": period, "hadMissing": had_missing}, None
    return None, None, None, None, "; ".join(errors)


def units_are_hpa(raw_global_mean):
    """Decide hPa vs Pa from the value itself, not from a units attribute.

    Stage 3 hit exactly this: surface pressure was divided by 100 on the
    assumption it was Pascals when the file already held hPa, which masked
    every cell and produced a ZeroDivisionError rather than an obvious
    error. Earth's area-mean surface pressure is ~985 hPa (below 1013
    because of terrain), so the two possibilities are three orders of
    magnitude apart and cannot be confused.
    """
    if 800 < raw_global_mean < 1100:
        return True
    if 80000 < raw_global_mean < 110000:
        return False
    raise SystemExit(
        f"surface pressure global mean {raw_global_mean:.1f} is neither hPa-like (~985) "
        f"nor Pa-like (~98500) -- refusing to guess"
    )


def reoriented_longitudes(lon):
    """The longitude axis that reorient() produces, computed rather than assumed.

    reorient() swaps the two halves of a 0..360 axis to make a -180-based
    map, so the resulting axis is NOT a uniform "-180 + (i+0.5)*step" ramp --
    it starts at exactly -180. Writing the assumed ramp into the summary
    instead of this would have put every consumer's longitudes off by half a
    cell (0.94 degrees on the Gaussian grid, 1.25 on the regular one).
    """
    half = len(lon) // 2
    return np.concatenate([np.asarray(lon)[half:] - 360.0, np.asarray(lon)[:half]])


def sample(grid, lats, lons, at_lat, at_lon):
    """Nearest cell, using the grid's OWN axes rather than assumed spacing.

    This matters and was got wrong once: NCEP serves some of these fields on
    a 2.5-degree regular grid and others on a T62 GAUSSIAN grid whose rows
    are not evenly spaced and whose first row sits at 88.542 rather than at
    90 or 89.04. A uniform-spacing formula happens to agree at some points
    and is off by a row at others -- it put the Antarctic check at -80.95
    instead of -82.85 -- which is the worst kind of bug: right often enough
    to look correct.
    """
    lats = np.asarray(lats)
    lons = np.asarray(lons)
    y = int(np.argmin(np.abs(lats - at_lat)))
    dlon = np.abs(lons - at_lon)
    x = int(np.argmin(np.minimum(dlon, 360.0 - dlon)))
    return float(grid[y, x])


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--world", default="worlds/kasoku-sekai")
    parser.add_argument("--cache", default=".cache/humidity-teacher")
    args = parser.parse_args()

    repo = pathlib.Path(__file__).resolve().parent.parent
    world_dir = repo / args.world
    teacher_dir = world_dir / "teacher"
    teacher_dir.mkdir(parents=True, exist_ok=True)
    cache_dir = repo / args.cache

    grids = {}
    provenance = {}
    for name, spec in FIELDS.items():
        print(f"{name}:")
        annual, lat, lon, prov, reason = annual_mean_field(cache_dir, spec, name)
        if annual is None:
            if spec.get("optional"):
                print(f"  OPTIONAL FIELD UNAVAILABLE -- continuing without it ({reason})")
                continue
            raise SystemExit(f"could not fetch a required field {name}: {reason}")

        if name == "surfacePressureHPa":
            raw_mean = float(area_weighted_mean(annual, lat))
            print(f"  raw area-mean {raw_mean:.1f}")
            if not units_are_hpa(raw_mean):
                annual = annual / 100.0
                prov["unitConversion"] = "Pa -> hPa (divided by 100, decided from the value's magnitude)"
            else:
                prov["unitConversion"] = "already hPa (decided from the value's magnitude)"
        elif name == "specificHumidityKgPerKg":
            # NCEP/NCAR R1 stores near-surface specific humidity in GRAMS per
            # kg, not kg/kg. Found the hard way: the first build's sanity
            # checks failed with a peak of 20.55, which is textbook-correct
            # for g/kg and three orders of magnitude off for kg/kg. Decided
            # from the value rather than from a units attribute, for the same
            # reason the pressure conversion is -- Stage 3 was bitten by
            # trusting a units convention over the data.
            peak = float(np.nanmax(annual))
            if 1.0 < peak < 60.0:
                annual = annual / 1000.0
                prov["unitConversion"] = "g/kg -> kg/kg (divided by 1000, decided from the value's magnitude)"
            elif peak < 0.06:
                prov["unitConversion"] = "already kg/kg (decided from the value's magnitude)"
            else:
                raise SystemExit(
                    f"specific humidity peak {peak:.3f} is neither g/kg-like (~20) nor "
                    f"kg/kg-like (~0.02) -- refusing to guess"
                )
        elif name == "airTemperatureC":
            raw_mean = float(area_weighted_mean(annual, lat))
            if raw_mean > 100:  # kelvin
                annual = annual - 273.15
                prov["unitConversion"] = "K -> degC"
            else:
                prov["unitConversion"] = "already degC"

        oriented = reorient(annual, lat)
        grids[name] = {
            "values": oriented.astype(np.float32),
            "lat": np.asarray(lat, dtype=float),
            "lon": reoriented_longitudes(lon),
        }
        provenance[name] = prov
        print(f"  grid {oriented.shape[1]}x{oriented.shape[0]}, "
              f"range {np.nanmin(oriented):.2f}..{np.nanmax(oriented):.2f}")

    # --- sanity checks: refuse to write a teacher that is not Earth --------
    # Wide on purpose. These prove the raster is this planet's real field,
    # they do not measure it -- the same discipline the terrain verifier uses.
    def at(field, lat_deg, lon_deg):
        g = grids[field]
        return sample(g["values"], g["lat"], g["lon"], lat_deg, lon_deg)

    p = grids["surfacePressureHPa"]["values"]
    t = grids["airTemperatureC"]["values"]
    plat = grids["surfacePressureHPa"]["lat"]
    tlat = grids["airTemperatureC"]["lat"]
    # Each check carries the value it measured, so a failure says what the
    # data actually is rather than only that it displeased a threshold.
    checks = [
        ("global mean surface pressure is 960-1000 hPa (below p0 because of terrain)",
         960 < area_weighted_mean(p, plat) < 1000, f"{area_weighted_mean(p, plat):.1f} hPa"),
        ("Tibet is a genuine low-pressure plateau (<700 hPa)",
         at("surfacePressureHPa", 32, 88) < 700, f"{at('surfacePressureHPa', 32, 88):.1f} hPa"),
        ("the tropical ocean is near sea-level pressure",
         1005 < at("surfacePressureHPa", 0, -140) < 1020, f"{at('surfacePressureHPa', 0, -140):.1f} hPa"),
        ("global mean air temperature is 10-20 C",
         10 < area_weighted_mean(t, tlat) < 20, f"{area_weighted_mean(t, tlat):.2f} C"),
        # Sampled in the WESTERN Sahara rather than the centre: at ~2-degree
        # resolution a central-Sahara point lands on the Ahaggar/Tassili
        # massif, where NCEP's own model topography is high enough to pull
        # the annual mean down. 20N 5W is genuine low desert.
        ("the Sahara is hot (>20 C)",
         at("airTemperatureC", 20, -5) > 20, f"{at('airTemperatureC', 20, -5):.2f} C"),
        ("Antarctica is cold (<-20 C)",
         at("airTemperatureC", -82, 0) < -20, f"{at('airTemperatureC', -82, 0):.2f} C"),
    ]
    if "specificHumidityKgPerKg" in grids:
        q = grids["specificHumidityKgPerKg"]["values"]
        checks += [
            ("specific humidity is positive everywhere",
             float(np.nanmin(q)) > 0, f"min {float(np.nanmin(q)) * 1000:.3f} g/kg"),
            ("specific humidity peaks below 25 g/kg",
             float(np.nanmax(q)) < 0.025, f"max {float(np.nanmax(q)) * 1000:.2f} g/kg"),
            ("the tropical ocean is humid (>10 g/kg)",
             at("specificHumidityKgPerKg", 0, -140) > 0.010,
             f"{at('specificHumidityKgPerKg', 0, -140) * 1000:.2f} g/kg"),
            ("Antarctica is dry (<2 g/kg)",
             at("specificHumidityKgPerKg", -82, 0) < 0.002,
             f"{at('specificHumidityKgPerKg', -82, 0) * 1000:.3f} g/kg"),
        ]
    # Reported, not asserted: the central-Sahara point the check originally
    # used, so the reason for moving it is visible in the log rather than
    # taken on trust. Moving a check to fit the data is only honest if the
    # data is shown -- the same call this project made when the Stage 5
    # teacher's Indochina check point moved to Borneo.
    print(f"  note central Sahara 23N 10E (Ahaggar/Tassili massif): "
          f"{at('airTemperatureC', 23, 10):.2f} C, "
          f"surface pressure {at('surfacePressureHPa', 23, 10):.1f} hPa")
    failed = [name for name, ok, _ in checks if not ok]
    for name, ok, measured in checks:
        print(f"  {'OK  ' if ok else 'FAIL'} {name}  [{measured}]")
    if failed:
        raise SystemExit(f"refusing to write the teacher: {len(failed)} sanity check(s) failed")

    # --- write ------------------------------------------------------------
    summary_grids = {}
    for name, g in grids.items():
        values = g["values"]
        h, w = values.shape
        filename = f"humidity-{name}.bin"
        (teacher_dir / filename).write_bytes(values.astype("<f4").tobytes())
        summary_grids[name] = {
            "file": filename,
            "width": int(w),
            "height": int(h),
            "units": FIELDS[name]["units"],
            # Written out rather than assumed: the 2m fields are on a
            # Gaussian grid whose rows are NOT evenly spaced, so a consumer
            # that assumed uniform spacing would be quietly wrong.
            "latitudes": [float(v) for v in g["lat"]],
            "longitudes": [float(v) for v in g["lon"]],
            "source": provenance[name],
        }

    summary = {
        "_note": (
            "Earth's real annual-mean surface pressure, near-surface air temperature and "
            "near-surface specific humidity, for Climate v1 Stage 5A's humidity thermodynamics "
            "to be VALIDATED against -- never fitted to (Stage 5A has no free parameters). "
            "q_sat is a CAPACITY, not the real humidity: the specific humidity grid here is only "
            "for an implied-RH plausibility check, not a target. See "
            "docs/climate-v1-humidity-stage5a.md. Built by tools/build_humidity_teacher.py."
        ),
        "source": {
            "product": "NCEP/NCAR Reanalysis 1, monthly means (derived)",
            "institution": "NOAA Physical Sciences Laboratory",
            "license": "US federal government work -- no reuse restriction. PSL requests acknowledgement in publications.",
            "citation": "NCEP/NCAR Reanalysis 1, NOAA/OAR/ESRL PSL, https://psl.noaa.gov/data/gridded/data.ncep.reanalysis.html",
        },
        "grids": summary_grids,
        "checks": [{"name": name, "passed": bool(ok), "measured": measured} for name, ok, measured in checks],
    }
    (teacher_dir / "humidity-summary.json").write_text(json.dumps(summary, indent=1) + "\n")
    print(f"\nwrote {len(summary_grids)} grids + humidity-summary.json to {teacher_dir}")


if __name__ == "__main__":
    main()
