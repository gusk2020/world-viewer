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
            path = fetch(url, dest, cache_dir)
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


def sample(grid, at_lat, at_lon):
    """Nearest cell, on the reoriented grid (row 0 = north, col 0 = -180)."""
    h, w = grid.shape
    y = int(np.clip(round((90 - at_lat) / 180 * h - 0.5), 0, h - 1))
    x = int(np.clip(round((at_lon + 180) / 360 * w - 0.5), 0, w - 1))
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
        grids[name] = {"values": oriented.astype(np.float32), "lat": np.asarray(lat, dtype=float)}
        provenance[name] = prov
        print(f"  grid {oriented.shape[1]}x{oriented.shape[0]}, "
              f"range {np.nanmin(oriented):.2f}..{np.nanmax(oriented):.2f}")

    # --- sanity checks: refuse to write a teacher that is not Earth --------
    # Wide on purpose. These prove the raster is this planet's real field,
    # they do not measure it -- the same discipline the terrain verifier uses.
    p = grids["surfacePressureHPa"]["values"]
    t = grids["airTemperatureC"]["values"]
    plat = grids["surfacePressureHPa"]["lat"]
    tlat = grids["airTemperatureC"]["lat"]
    checks = [
        ("global mean surface pressure is 960-1000 hPa (below p0 because of terrain)",
         960 < area_weighted_mean(p, plat) < 1000),
        ("Tibet is a genuine low-pressure plateau (<700 hPa)", sample(p, 32, 88) < 700),
        ("the tropical ocean is near sea-level pressure", 1005 < sample(p, 0, -140) < 1020),
        ("global mean air temperature is 10-20 C", 10 < area_weighted_mean(t, tlat) < 20),
        ("the Sahara is hot (>20 C)", sample(t, 23, 10) > 20),
        ("Antarctica is cold (<-20 C)", sample(t, -82, 0) < -20),
    ]
    if "specificHumidityKgPerKg" in grids:
        q = grids["specificHumidityKgPerKg"]["values"]
        checks += [
            ("specific humidity is positive everywhere", float(np.nanmin(q)) > 0),
            ("specific humidity peaks below 25 g/kg", float(np.nanmax(q)) < 0.025),
            ("the tropical ocean is humid (>10 g/kg)", sample(q, 0, -140) > 0.010),
            ("Antarctica is dry (<2 g/kg)", sample(q, -82, 0) < 0.002),
        ]
    failed = [name for name, ok in checks if not ok]
    for name, ok in checks:
        print(f"  {'OK  ' if ok else 'FAIL'} {name}")
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
            "longitudes": [float(-180 + (i + 0.5) * 360 / w) for i in range(w)],
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
        "checks": [{"name": name, "passed": bool(ok)} for name, ok in checks],
    }
    (teacher_dir / "humidity-summary.json").write_text(json.dumps(summary, indent=1) + "\n")
    print(f"\nwrote {len(summary_grids)} grids + humidity-summary.json to {teacher_dir}")


if __name__ == "__main__":
    main()
