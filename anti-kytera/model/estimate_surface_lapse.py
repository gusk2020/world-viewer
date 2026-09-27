"""The one cause-focused fix after the first run (see results/RESULTS.md).

Diagnosis: the model's near-surface temperature error over ice-free land
grows more negative with elevation in both hemispheres and both seasons
(about -1.8 to -1.9 K per km). The model derived surface temperature from
its column (sea-level-equivalent) temperature with the FREE-ATMOSPHERE
lapse rate, 6.5 K/km, but air in contact with elevated land is warmer than
free air at the same height (surface heating); observed near-surface lapse
rates over land are ~4-5 K/km (e.g. Minder et al. 2010, J. Geophys. Res.).

Estimate: one global near-surface lapse rate, from a least-squares fit of
(model - teacher) against elevation over ALL ice-free land between 60S and
60N, all 12 months pooled, area-weighted. Observed ice sheets are excluded
(their temperature is shaped by the ice itself, which the fixed-condition
experiment does not have). No region is singled out.

  python3 estimate_surface_lapse.py <first-run climate.npz>
"""
import sys

import numpy as np

import diag_climate as d
import setup_world
from grid import LatLonGrid, regrid_conservative

FREE_LAPSE = 6.5e-3


def main(path):
    o = dict(np.load(path))
    w = setup_world.restored_bed("local")
    g = LatLonGrid(2, 2)
    hl, hn = np.linspace(-90, 90, 1025), np.linspace(-180, 180, 2049)
    zobs = regrid_conservative(np.maximum(w["surface"], 0), hl, hn, g.lat_edges, g.lon_edges)
    ice = regrid_conservative((w["H_obs"] > 10).astype(float), hl, hn, g.lat_edges, g.lon_edges) > 0.1
    Tt, _ = d.teacher()
    m = o["land"] & ~ice & (np.abs(g.LAT) < 60)
    x, y, wt = [], [], []
    for mo in range(12):
        bias = (o["T"][mo] - FREE_LAPSE * zobs) - Tt[mo]
        x.append(zobs[m] / 1000); y.append(bias[m]); wt.append(g.area[m])
    x, y, wt = map(np.concatenate, (x, y, wt))
    ok = np.isfinite(y)
    slope, icpt = np.polyfit(x[ok], y[ok], 1, w=np.sqrt(wt[ok]))
    print(f"bias vs elevation: {slope:+.2f} K/km (intercept {icpt:+.2f} K), n={ok.sum()}")
    print(f"near-surface lapse rate = {FREE_LAPSE*1e3 + slope:.2f} K/km")


if __name__ == "__main__":
    main(sys.argv[1])
