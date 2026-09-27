"""Observed ice thickness and the ice-free bedrock restoration.

Inputs are GEBCO_2026's two versions of the same grid: the ice surface (s)
and the sub-ice topography (b). Their difference is ice where the bed is
above sea level, but beneath an ice shelf it is ice PLUS the water cavity.
Grounded vs floating is decided by hydrostatics:

  b >= 0                         grounded, H = s - b
  b < 0 and (s - b)*rho_i > -b*rho_w   grounded (heavy enough to touch bed)
  otherwise                      floating: H = s / (1 - rho_i/rho_w)
                                  (freeboard relation), capped at s - b

Ice-free bedrock: only grounded ice loads the lithosphere. Full local (Airy)
isostatic equilibrium gives an uplift of (rho_i / rho_m) * H_grounded once the
ice is removed. Uncertainties (see README): the Earth is still rebounding
from the last deglaciation, the lithosphere is flexural rather than local,
rho_m is uncertain (3250-3370), and erosion/sediment are ignored. The
'flexure' variant smooths the load over a flexural length to bracket the
first of these; the 'none' variant is the unrestored present bed.
"""
import numpy as np
from scipy.ndimage import gaussian_filter

RHO_I = 910.0
RHO_W = 1028.0
RHO_M = 3300.0
MIN_ICE_M = 5.0          # below this, differences are raster rounding


def observed_ice(s, b):
    d = s - b
    grounded_ok = (b >= 0) | ((d * RHO_I) > (-b * RHO_W))
    H = np.zeros_like(s)
    ice = d > MIN_ICE_M
    g = ice & grounded_ok
    f = ice & ~grounded_ok & (s > 0)
    H[g] = d[g]
    H[f] = np.minimum(s[f] / (1 - RHO_I / RHO_W), d[f])
    return H, g, f


def restore(b, H_grounded, variant="local", lat=None, dx_m=None):
    if variant == "none":
        return b.copy()
    load = RHO_I / RHO_M * H_grounded
    if variant == "flexure":
        # ~ flexural length 100-150 km for continental lithosphere. Gaussian
        # sigma in pixels, latitude-independent (pixels near the poles are
        # narrower in x; acceptable for a bracketing test).
        sig_y = 120e3 / dx_m
        load = gaussian_filter(load, sigma=(sig_y, sig_y), mode=("nearest", "wrap"))
    return b + load
