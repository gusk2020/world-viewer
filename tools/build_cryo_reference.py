"""Present-day snow and sea-ice reference from ERA5 (REANALYSIS, not observation).

Source: ERA5 hourly single levels, NSF NCAR public mirror s3://nsf-ncar-era5
(dataset d633000): 128_031 CI (sea-ice area fraction), 128_141 SD (snow depth,
m of water equivalent), 128_167 2T (2 m temperature). One year (default 2015),
each month averaged over its 00 and 12 UTC fields, then reduced to 0.5 degrees (720 x 360,
south-first, lon -180..180) by 2x2 block means.

Writes anti-kytera/viewer/rules/cryo_reference_<year>.npz with
  seaice_annual  mean sea-ice fraction over the year (0..1, NaN on land)
  snow_months    share of months whose mean snow depth > 0.01 m w.e. (0..1)
  t2m_amp        |July - January| mean 2 m temperature (K)
  t2m_mean       mean of those two months (C)
Used only to check the base-condition look of the snow / sea-ice layers and
to set the seasonal-amplitude constant; never shown as a teacher score.
"""
import os
import sys
import subprocess
from pathlib import Path

import h5py
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
URL = ("https://nsf-ncar-era5.s3.amazonaws.com/e5.oper.an.sfc/{y}{m:02d}/"
       "e5.oper.an.sfc.{v}.ll025sc.{y}{m:02d}0100_{y}{m:02d}{d}23.nc")
DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
VARS = {"ci": ("128_031_ci", "CI"), "sd": ("128_141_sd", "SD"), "t2": ("128_167_2t", "VAR_2T")}


def month_mean(y, m, key):
    code, name = VARS[key]
    d = DAYS[m - 1] + (1 if m == 2 and y % 4 == 0 else 0)
    tmp = Path(f"/tmp/era5_{key}_{y}{m:02d}.nc")
    if not tmp.exists():
        subprocess.run(["curl", "-sSf", "-o", str(tmp), URL.format(y=y, m=m, v=code, d=d)], check=True)
    with h5py.File(tmp, "r") as f:
        v = f[name]
        acc = np.zeros(v.shape[1:], np.float64); n = np.zeros(v.shape[1:], np.float64)
        sf, off = v.attrs.get("scale_factor", 1.0), v.attrs.get("add_offset", 0.0)
        fill = v.attrs.get("_FillValue", None)
        for i in range(0, v.shape[0], 12):                  # 00 and 12 UTC of every day
            raw = v[i]
            a = raw * sf + off if raw.dtype.kind == "i" else raw.astype(np.float64)
            bad = ~np.isfinite(a) | (np.abs(a) > 1e10)
            if fill is not None:
                bad |= raw == fill
            acc += np.where(bad, 0, a); n += ~bad
    tmp.unlink()
    mean = np.where(n > 0, acc / np.maximum(n, 1), np.nan)      # 721 x 1440, north-first, lon 0..360
    mean = mean[:720]                                           # drop the south-pole row
    mean = np.roll(mean, 720, axis=1)                           # lon -180..180
    mean = np.nanmean(mean.reshape(360, 2, 720, 2), axis=(1, 3))
    return mean[::-1]                                           # south-first


def main():
    y = int(sys.argv[1]) if len(sys.argv) > 1 else 2015
    ci, sd = [], []
    for m in range(1, 13):
        ci.append(month_mean(y, m, "ci")); sd.append(month_mean(y, m, "sd"))
        print("month", m, flush=True)
    # 2 m temperature files are ~1 GB a month, so only the two extreme months
    t2 = np.array([month_mean(y, 1, "t2"), month_mean(y, 7, "t2")]) - 273.15
    ci, sd = np.array(ci), np.array(sd)
    out = ROOT / f"anti-kytera/viewer/rules/cryo_reference_{y}.npz"
    np.savez_compressed(out, seaice_annual=np.nanmean(ci, 0).astype(np.float32),
                        snow_months=(sd > 0.01).mean(0).astype(np.float32),
                        t2m_amp=np.abs(t2[1] - t2[0]).astype(np.float32),
                        t2m_mean=t2.mean(0).astype(np.float32),
                        source=np.array("ERA5 reanalysis (not observation), NSF NCAR mirror s3://nsf-ncar-era5 d633000, year %d" % y))
    print(out, out.stat().st_size)


if __name__ == "__main__":
    main()
