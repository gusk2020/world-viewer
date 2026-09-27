"""Build the Anti-KyTerra teacher fields: monthly 2 m temperature and
precipitation, 1991-2020, conservatively regridded to the model's grid.

Teacher values are ONLY used for comparison and for a handful of global
coefficients (see README). They never enter the model as fields.

Sources (both fetched from public AWS S3 buckets; nothing needs a login):
  temperature  Berkeley Earth Land+Ocean, 1x1 deg, monthly
               (station-based land + HadSST ocean; air temperature over sea
               ice). OBSERVATIONAL analysis. Licence CC BY-NC 4.0.
               absolute = 'climatology' (1951-1980) + mean anomaly 1991-2020.
  precip       GPCP v2.3 monthly CDR (satellite + gauge). OBSERVATIONAL
               analysis. NOAA CDR, no restriction on use.

Run: python3 anti-kytera/model/teacher.py <raw-dir>   (see README for fetch)
"""
import glob
import json
import os
import re
import sys

import numpy as np
import netCDF4 as nc

sys.path.insert(0, os.path.dirname(__file__))
from grid import LatLonGrid, regrid_conservative  # noqa: E402

OUT = os.path.join(os.path.dirname(__file__), "..", "data")


def temperature(raw, g):
    d = nc.Dataset(os.path.join(raw, "be.nc"))
    clim = np.ma.filled(d["climatology"][:], np.nan)            # 12, 180, 360
    t = np.asarray(d["time"][:])
    sel = (t >= 1991) & (t < 2021)
    anom = np.ma.filled(d["temperature"][np.where(sel)[0]], np.nan)
    anom = anom.reshape(30, 12, 180, 360)
    mean_anom = np.nanmean(anom, axis=0)
    absolute = clim + np.where(np.isfinite(mean_anom), mean_anom, 0.0)
    src_lat_e = np.linspace(-90, 90, 181)
    src_lon_e = np.linspace(-180, 180, 361)
    return regrid_conservative(absolute, src_lat_e, src_lon_e, g.lat_edges, g.lon_edges)


def precipitation(raw, g):
    files = sorted(glob.glob(os.path.join(raw, "gpcp", "*.nc")))
    bymonth = {}
    for f in files:
        ym = re.search(r"_d(\d{6})_", f).group(1)
        prelim = "preliminary" in f
        if ym in bymonth and prelim:
            continue            # prefer the final record over the preliminary one
        bymonth[ym] = f
    keys = sorted(k for k in bymonth if "1991" <= k[:4] <= "2020")
    assert len(keys) == 360, len(keys)
    acc = np.zeros((12, 72, 144))
    for k in keys:
        p = np.ma.filled(nc.Dataset(bymonth[k])["precip"][0], np.nan)
        acc[int(k[4:]) - 1] += p / 30.0
    acc = np.roll(acc, 72, axis=2)       # 0..360 -> -180..180
    src_lat_e = np.linspace(-90, 90, 73)
    src_lon_e = np.linspace(-180, 180, 145)
    return regrid_conservative(acc, src_lat_e, src_lon_e, g.lat_edges, g.lon_edges)  # mm/day


def main():
    raw = sys.argv[1]
    g = LatLonGrid(2.0, 2.0)
    T = temperature(raw, g)
    P = precipitation(raw, g)
    os.makedirs(OUT, exist_ok=True)
    np.savez_compressed(os.path.join(OUT, "teacher_2deg.npz"),
                        t2m_monthly_c=T.astype(np.float32),
                        precip_monthly_mm_day=P.astype(np.float32))
    days = np.array([31, 28.25, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31])
    ann_T = np.nansum(T * days[:, None, None], 0) / days.sum()
    ann_P = np.nansum(P * days[:, None, None], 0)
    meta = {
        "grid": "2x2 degree, row 0 = southernmost, col 0 starts at -180",
        "period": "1991-2020 climatology",
        "temperature": {"source": "Berkeley Earth Land+Ocean LatLong1 (observational analysis)",
                        "url": "https://berkeley-earth-temperature.s3.us-west-1.amazonaws.com/Global/Gridded/Land_and_Ocean_LatLong1.nc",
                        "licence": "CC BY-NC 4.0, Berkeley Earth",
                        "global_mean_c": round(g.mean(ann_T), 2),
                        "missing_cells": int(np.isnan(T).any(0).sum())},
        "precipitation": {"source": "GPCP v2.3 monthly CDR (observational analysis, satellite+gauge)",
                          "url": "https://noaa-cdr-precip-gpcp-monthly-pds.s3.amazonaws.com/data/",
                          "licence": "NOAA Climate Data Record, open use",
                          "global_mean_mm_yr": round(g.mean(ann_P), 1)},
    }
    json.dump(meta, open(os.path.join(OUT, "teacher_2deg.json"), "w"), indent=1)
    print(json.dumps(meta, indent=1))


if __name__ == "__main__":
    main()
