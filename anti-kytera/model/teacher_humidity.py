"""Humidity teacher: near-surface water-vapour pressure e (hPa) from ERA5
2 m dewpoint, 1991-2020 climatology, on the 2-degree model grid.

Source: ECMWF ERA5 (REANALYSIS, not observation), hourly 0.25 deg, via the
NSF NCAR public mirror on AWS (s3://nsf-ncar-era5, dataset d633000).
Licence: Copernicus licence (free, commercial use allowed, attribution
"Contains modified Copernicus Climate Change Service information [2026]").

Sampling (the files are hourly, ~1 GB per month): four years spread over
1991..2020 (1994, 2001, 2008, 2015), each month one 27-hour block (one HDF5 chunk in
time) starting on day 14. A coarse sample: see TERRAIN.md. e = 6.112 exp(17.67 Td/(Td+243.5)).
"""
import json
import os
import sys
from concurrent.futures import ThreadPoolExecutor

import fsspec
import h5py
import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
from grid import LatLonGrid, regrid_conservative  # noqa: E402

URL = ("https://nsf-ncar-era5.s3.amazonaws.com/e5.oper.an.sfc/{y}{m:02d}/"
       "e5.oper.an.sfc.128_168_2d.ll025sc.{y}{m:02d}0100_{y}{m:02d}{d}23.nc")
YEARS = [1994, 2001, 2008, 2015]
DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]


def last_day(y, m):
    if m == 2:
        return 29 if (y % 4 == 0 and (y % 100 or y % 400 == 0)) else 28
    return DAYS[m - 1]


CACHE = os.environ.get("AK_HUM_CACHE", "/tmp/ak_hum_cache")


def one(ym):
    """One month-year, cached on disk and retried: S3 answers 503 now and then."""
    import time
    y, m = ym
    path = os.path.join(CACHE, f"{y}{m:02d}.npy")
    if os.path.exists(path):
        return m, np.load(path)
    for attempt in range(6):
        try:
            m_, e = _one(ym)
            os.makedirs(CACHE, exist_ok=True)
            np.save(path + ".tmp.npy", e.astype(np.float32))
            os.replace(path + ".tmp.npy", path)
            return m_, e
        except Exception as ex:  # network hiccup: back off and retry
            print(f"retry {y}-{m:02d}: {ex!r}"[:160], flush=True)
            time.sleep(10 * 2 ** attempt)
    raise RuntimeError(f"{y}-{m:02d} failed")


def _one(ym):
    y, m = ym
    f = fsspec.open(URL.format(y=y, m=m, d=last_day(y, m)), "rb", block_size=2**22).open()
    d = h5py.File(f, "r")["VAR_2D"]
    acc = np.zeros(d.shape[1:])
    n = 0
    for start in (13 * 24,):
        blk = d[start:start + 27] - np.float32(273.15)
        acc += (6.112 * np.exp(17.67 * blk / (blk + 243.5))).sum(0)
        n += blk.shape[0]
    return m, acc / n


def main():
    out = os.path.join(os.path.dirname(__file__), "..", "data")
    tasks = [(y, m) for y in YEARS for m in range(1, 13)]
    sums = np.zeros((12, 721, 1440))
    cnt = np.zeros(12)
    with ThreadPoolExecutor(16) as ex:
        for i, (m, e) in enumerate(ex.map(one, tasks)):
            sums[m - 1] += e
            cnt[m - 1] += 1
            print(f"{i+1}/{len(tasks)}", flush=True)
    clim = sums / cnt[:, None, None]            # north-first, lon 0..359.75
    # ERA5 grid: 721 rows 90..-90 (cell centres), 1440 cols 0..359.75.
    # Drop the duplicated pole rows' half-cells by treating each value as a
    # 0.25-degree cell centred on its point; flip to south-first, roll to -180.
    f = clim[:, ::-1, :]
    f = np.roll(f, 720, axis=2)
    lat_e = np.concatenate([[-90], np.arange(-89.875, 90, 0.25), [90]])
    # cell centres -180..179.75; edges shifted by 1/8 degree (negligible at 2 deg)
    lon_e = np.linspace(-180, 180, 1441)
    g = LatLonGrid(2, 2)
    e2 = regrid_conservative(f, lat_e, lon_e, g.lat_edges, g.lon_edges)
    np.savez_compressed(os.path.join(out, "teacher_humidity_2deg.npz"), vapour_pressure_monthly_hpa=e2.astype(np.float32))
    meta = {"source": "ERA5 hourly 2 m dewpoint (REANALYSIS), NSF NCAR mirror s3://nsf-ncar-era5 (d633000)",
            "licence": "Copernicus licence; attribution: Contains modified Copernicus Climate Change Service information 2026",
            "quantity": "near-surface water-vapour pressure, hPa, monthly climatology",
            "sampling": "years " + ",".join(map(str, YEARS)) + "; each month one 27-hour block from day 14",
            "global_mean_hpa": round(g.mean(e2.mean(0)), 2)}
    json.dump(meta, open(os.path.join(out, "teacher_humidity_2deg.json"), "w"), indent=1)
    print(meta)


if __name__ == "__main__":
    main()
