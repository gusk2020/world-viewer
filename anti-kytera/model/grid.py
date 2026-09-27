"""Latitude-longitude grid helpers shared by every Anti-KyTerra component.

The climate grid is a regular lat-lon grid (default 2 degrees). Cell (j, i)
has its centre at lat[j], lon[i]; row 0 is the SOUTHERNMOST row and column 0
starts at -180. All regridding between lat-lon grids is conservative
(area-weighted overlap), so a mean over a region is the same on either grid.
"""
import numpy as np

EARTH_RADIUS_M = 6.371e6


class LatLonGrid:
    def __init__(self, dlat_deg=2.0, dlon_deg=2.0):
        self.dlat = dlat_deg
        self.dlon = dlon_deg
        self.ny = int(round(180 / dlat_deg))
        self.nx = int(round(360 / dlon_deg))
        self.lat_edges = np.linspace(-90, 90, self.ny + 1)
        self.lon_edges = np.linspace(-180, 180, self.nx + 1)
        self.lat = 0.5 * (self.lat_edges[1:] + self.lat_edges[:-1])
        self.lon = 0.5 * (self.lon_edges[1:] + self.lon_edges[:-1])
        s = np.sin(np.radians(self.lat_edges))
        # Cell area in m^2 (exact for a sphere).
        self.row_area = EARTH_RADIUS_M**2 * np.radians(dlon_deg) * (s[1:] - s[:-1])
        self.area = np.repeat(self.row_area[:, None], self.nx, axis=1)
        self.LAT, self.LON = np.meshgrid(self.lat, self.lon, indexing="ij")

    def mean(self, field, mask=None):
        w = self.area if mask is None else self.area * mask
        ok = np.isfinite(field) & (w > 0)
        return float(np.sum(field[ok] * w[ok]) / np.sum(w[ok]))


def _overlap_1d(src_edges, dst_edges):
    """Matrix M[d, s] = length of overlap between dst cell d and src cell s."""
    ns, nd = len(src_edges) - 1, len(dst_edges) - 1
    M = np.zeros((nd, ns))
    for d in range(nd):
        lo, hi = dst_edges[d], dst_edges[d + 1]
        ov = np.minimum(hi, src_edges[1:]) - np.maximum(lo, src_edges[:-1])
        M[d] = np.clip(ov, 0, None)
    return M


def regrid_conservative(field, src_lat_edges, src_lon_edges, dst_lat_edges, dst_lon_edges):
    """Area-weighted regrid of field[..., ny_src, nx_src]; NaNs are skipped.

    Both grids must span lon -180..180 (roll the source first if needed).
    Latitude overlap is measured in sin(lat) so the weights are true areas.
    """
    My = _overlap_1d(np.sin(np.radians(src_lat_edges)), np.sin(np.radians(dst_lat_edges)))
    Mx = _overlap_1d(np.asarray(src_lon_edges, float), np.asarray(dst_lon_edges, float))
    f = np.asarray(field, float)
    ok = np.isfinite(f)
    num = My @ np.where(ok, f, 0.0) @ Mx.T
    den = My @ ok.astype(float) @ Mx.T
    with np.errstate(invalid="ignore", divide="ignore"):
        out = num / den
    out[den <= 0] = np.nan
    return out
