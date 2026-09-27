"""Fixed boundary conditions: ice-free restored bedrock on the climate grid."""
import numpy as np

import bedrock
import data
from grid import LatLonGrid, regrid_conservative


def restored_bed(variant="local"):
    s, b = data.surface_2048(), data.bed_2048()
    H, gnd, flt = bedrock.observed_ice(s, b)
    dx = 6.371e6 * np.radians(180 / 1024)
    bf = bedrock.restore(b, H * gnd, variant, dx_m=dx)
    return dict(surface=s, bed=b, H_obs=H * gnd, H_float=H * flt, grounded=gnd, bed_free=bf)


def climate_boundary(bed_free, g):
    """Land fraction and mean land elevation on the climate grid."""
    hi_lat = np.linspace(-90, 90, 1025)
    hi_lon = np.linspace(-180, 180, 2049)
    land = (bed_free > 0).astype(float)
    frac = regrid_conservative(land, hi_lat, hi_lon, g.lat_edges, g.lon_edges)
    zsum = regrid_conservative(np.maximum(bed_free, 0) * land, hi_lat, hi_lon, g.lat_edges, g.lon_edges)
    with np.errstate(invalid="ignore", divide="ignore"):
        zland = np.where(frac > 0, zsum / frac, 0.0)
    return frac, zland
