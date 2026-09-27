"""Body-agnostic terrain/environment features for the Anti-KyTerra
statistical colouring.

Every feature is computable for ANY body from three inputs only:
  - an elevation raster (south-first, lon -180..180) and a sea level,
  - the body's obliquity (for insolation),
  - its rotation sense (+1 prograde) for the prevailing-wind direction.
No place names, no longitude, no coordinates of anything. Latitude enters
only through insolation (annual mean and seasonal range), and |latitude|
for the wind-belt direction.
"""
import math
import os
import sys

import numpy as np
from scipy.ndimage import gaussian_filter1d

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "model"))
from climate import insolation, params  # noqa: E402  (pure astronomy function)
from grid import regrid_conservative  # noqa: E402

R_EARTH = 6.371e6


def insolation_features(lat_deg, obliquity):
    p = params(obliquity=obliquity, ecc=0.0)
    days = np.arange(96) / 96.0
    Q = np.stack([insolation(lat_deg, d, p)[0] for d in days])
    return Q.mean(0), Q.max(0) - Q.min(0)


def smooth_sphere(field, lat, radius_m, R):
    """Gaussian smoothing with a given ground radius on a lat-lon grid."""
    ny, nx = field.shape
    dlat = math.pi / ny
    out = gaussian_filter1d(field, radius_m / (R * dlat), axis=0, mode="nearest")
    res = np.empty_like(out)
    for j in range(ny):
        c = max(math.cos(math.radians(lat[j])), 1e-3)
        s = min(radius_m / (R * c * 2 * math.pi / nx), nx)
        res[j] = gaussian_filter1d(out[j], s, mode="wrap")
    return res


def wind_sign(abslat, rotation=+1):
    """+1 = air comes from the west (westerlies), -1 = from the east.
    Three-cell pattern (trades / westerlies / polar easterlies)."""
    s = np.where(abslat < 30, -1.0, np.where(abslat < 60, 1.0, -1.0))
    return s * rotation


def upwind_stats(land, elev, lat, dist_m, R, rotation=+1):
    """Ocean fraction and highest ground over the upwind zonal segment."""
    ny, nx = land.shape
    ocean_up = np.zeros_like(elev)
    barrier = np.zeros_like(elev)
    for j in range(ny):
        c = max(math.cos(math.radians(lat[j])), 1e-3)
        n = int(min(nx // 2, max(1, round(dist_m / (R * c * 2 * math.pi / nx)))))
        s = int(wind_sign(abs(lat[j]), rotation))
        o = np.zeros(nx)
        m = np.full(nx, -1e9)
        for k in range(1, n + 1):
            # upwind of column i is i - s*k (from the west when s = +1)
            o += np.roll(1 - land[j], s * k)
            m = np.maximum(m, np.roll(elev[j], s * k))
        ocean_up[j] = o / n
        barrier[j] = np.maximum(m - elev[j], 0)
    return ocean_up, barrier


def build(elev_fine, sea_level, out_ny, out_nx, obliquity=23.44, rotation=+1, R=R_EARTH):
    """Features on an out_ny x out_nx grid from a fine elevation raster."""
    fy, fx = elev_fine.shape
    le_f = np.linspace(-90, 90, fy + 1)
    lo_f = np.linspace(-180, 180, fx + 1)
    le_o = np.linspace(-90, 90, out_ny + 1)
    lo_o = np.linspace(-180, 180, out_nx + 1)
    lat = 0.5 * (le_o[1:] + le_o[:-1])
    landf = (elev_fine > sea_level).astype(float)
    frac = regrid_conservative(landf, le_f, lo_f, le_o, lo_o)
    zsum = regrid_conservative(np.maximum(elev_fine - sea_level, 0) * landf, le_f, lo_f, le_o, lo_o)
    zland = np.where(frac > 0, zsum / np.maximum(frac, 1e-9), 0.0)
    zmax_proxy = regrid_conservative(np.maximum(elev_fine - sea_level, 0) ** 2 * landf, le_f, lo_f, le_o, lo_o)
    zrough = np.sqrt(np.maximum(np.where(frac > 0, zmax_proxy / np.maximum(frac, 1e-9), 0) - zland ** 2, 0))
    Qa, Qs = insolation_features(lat, obliquity)
    LATG = np.repeat(lat[:, None], out_nx, 1)
    F = {
        "Q_annual": np.repeat(Qa[:, None], out_nx, 1),
        "Q_season": np.repeat(Qs[:, None], out_nx, 1),
        "elev_land": zland,
        "elev_rough": zrough,
        "land_frac": frac,
    }
    for r in (300e3, 1000e3, 3000e3):
        F[f"land_{int(r/1e3)}km"] = smooth_sphere(frac, lat, r, R)
        F[f"elev_{int(r/1e3)}km"] = smooth_sphere(zland * frac, lat, r, R)
    land_bin = (frac >= 0.5).astype(float)
    for d in (500e3, 2000e3, 6000e3):
        o, b = upwind_stats(land_bin, zland * land_bin, lat, d, R, rotation)
        F[f"ocean_upwind_{int(d/1e3)}km"] = o
        F[f"barrier_upwind_{int(d/1e3)}km"] = b
    for d in (1000e3, 4000e3):
        # the same walk downwind (a basin's lee side: where the wind piles
        # warm surface water and moisture against the next continent)
        o, _ = upwind_stats(land_bin, zland * land_bin, lat, d, R, -rotation)
        F[f"ocean_downwind_{int(d/1e3)}km"] = o
    F["_abslat_for_reference_only"] = np.abs(LATG)
    return F


MONOTONE = {  # sign constraints for the temperature model (physical direction)
    "Q_annual": 1, "elev_land": -1,
}
