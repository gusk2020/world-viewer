"""Anti-KyTerra ice sheets: shallow-ice approximation on two polar
stereographic grids (one per hemisphere, each reaching the equator), with a
positive-degree-day surface mass balance driven by the climate model.

Causal chain and units, per ice-grid cell:
  climate (monthly sea-level-equivalent T, precip P at the climate model's
  own ice-free elevation z_c)
    -> local surface climate at the ICE surface s:
       T = T_sl - lapse_ref * z_c - lapse * (s - z_c),
       P = P_c * exp(-gammaP * lapse * (s - z_c))       (explicit local
       elevation response, re-evaluated as s changes; this is not a
       re-computation of the global climate)
    -> accumulation (snow fraction from a normal distribution of daily T)
       and melt (PDD, Calov & Greve 2005 analytic form)     [m ice / yr]
    -> SMB  -> SIA flux divergence -> dH/dt                 [m / yr]
    -> flotation calving where the bed is below sea level
    -> bed sinks under the load (ELRA, tau = 3 kyr)

The PDD constants are PISM's defaults (Huybrechts/Ritz values); the SIA is
the standard Mahaffy (1976) staggered scheme with Glen's law n = 3 and a
constant rate factor (isothermal, as in EISMINT I). Stereographic map
factor k enters as  dH/dt = M + k^2 div_p(D grad_p s).
"""
import math

import numba
import numpy as np

R = 6.371e6
RHO_I, RHO_W, RHO_M = 910.0, 1028.0, 3300.0
G = 9.81
SPY = 365.25 * 86400

ICE = dict(
    A_glen=1.0e-16,      # Pa^-3 yr^-1, isothermal ~ -10 C with enhancement (EISMINT)
    n=3,
    lapse=6.5e-3,        # K/m, on the ice surface above the climate's z_c (free-air value)
    gammaP=0.07,         # 1/K, precipitation scaling with temperature (Huybrechts 2002)
    pdd_sigma=5.0,       # K, daily temperature variability about the monthly mean
    ddf_snow=0.003,      # m w.e. / (K day)     PISM default
    ddf_ice=0.008,       # m w.e. / (K day)     PISM default
    refreeze=0.6,        # fraction of snow melt refreezing, PISM default
    snow_T=1.0,          # C, precipitation is snow when daily T below this
    tau_bed=3000.0,      # yr, ELRA relaxation
    dt_max=10.0,
    flux_limiter=1,      # positivity-preserving limiter (added after the first run; 0 = first-run scheme)
    lapse_ref=6.5e-3,    # K/m, climate column (sea-level-equivalent) T -> surface T at the climate's own z_c
    cfl=0.12,
)


def proj_grid(hemi, dx):
    half = 2 * R
    N = int(math.ceil(2 * half / dx)) | 1
    xs = (np.arange(N) - (N - 1) / 2) * dx
    X, Y = np.meshgrid(xs, xs)
    rho = np.hypot(X, Y)
    lat = hemi * (90 - 2 * np.degrees(np.arctan(rho / (2 * R))))
    lon = np.degrees(np.arctan2(X, -hemi * Y))
    k = 1 + (rho / (2 * R)) ** 2
    inside = rho < 2 * R * 0.999
    return dict(hemi=hemi, dx=dx, N=N, X=X, Y=Y, lat=lat, lon=lon, k=k, inside=inside,
                area=(dx / k) ** 2)


def latlon_to_xy(lat, lon, hemi):
    rho = 2 * R * np.tan(np.pi / 4 - hemi * np.radians(lat) / 2)
    return rho * np.sin(np.radians(lon)), -hemi * rho * np.cos(np.radians(lon))


def bilinear_latlon(field, lat, lon):
    """Sample a south-first, -180-start lat-lon field at points."""
    ny, nx = field.shape
    fy = (lat + 90) / 180 * ny - 0.5
    fx = (lon + 180) / 360 * nx - 0.5
    y0 = np.clip(np.floor(fy).astype(int), 0, ny - 1)
    y1 = np.clip(y0 + 1, 0, ny - 1)
    wy = np.clip(fy - y0, 0, 1)
    x0 = np.floor(fx).astype(int)
    wx = fx - x0
    x0 %= nx
    x1 = (x0 + 1) % nx
    return ((1 - wy) * ((1 - wx) * field[y0, x0] + wx * field[y0, x1])
            + wy * ((1 - wx) * field[y1, x0] + wx * field[y1, x1]))


def area_average_to_grid(field, pg):
    """Bin a fine lat-lon field (south-first) into the stereographic cells,
    weighting by pixel area; empty cells fall back to bilinear sampling."""
    ny, nx = field.shape
    lat = (np.arange(ny) + 0.5) / ny * 180 - 90
    lon = (np.arange(nx) + 0.5) / nx * 360 - 180
    LAT, LON = np.meshgrid(lat, lon, indexing="ij")
    sel = LAT * pg["hemi"] > -1.0
    x, y = latlon_to_xy(LAT[sel], LON[sel], pg["hemi"])
    N, dx = pg["N"], pg["dx"]
    ix = np.floor(x / dx + N / 2).astype(int)
    iy = np.floor(y / dx + N / 2).astype(int)
    ok = (ix >= 0) & (ix < N) & (iy >= 0) & (iy < N)
    w = np.cos(np.radians(LAT[sel]))[ok]
    flat = iy[ok] * N + ix[ok]
    s = np.bincount(flat, weights=w * field[sel][ok], minlength=N * N)
    c = np.bincount(flat, weights=w, minlength=N * N)
    out = np.where(c > 0, s / np.maximum(c, 1e-30), np.nan).reshape(N, N)
    miss = np.isnan(out)
    out[miss] = bilinear_latlon(field, pg["lat"][miss], pg["lon"][miss])
    return out


# ---------------------------------------------------------------- SMB (PDD)
@numba.njit(cache=True)
def _smb(s, zc, Tsl, Pc, inside, lapse_ref, lapse, gammaP, sigma, ddf_s, ddf_i, refr, snowT, out_acc, out_melt, out_smb):
    days = (31.0, 28.25, 31.0, 30.0, 31.0, 30.0, 31.0, 31.0, 30.0, 31.0, 30.0, 31.0)
    ny, nx = s.shape
    for j in range(ny):
        for i in range(nx):
            if not inside[j, i]:
                out_smb[j, i] = 0.0
                continue
            acc = 0.0
            pdd = 0.0
            for m in range(12):
                dz = s[j, i] - zc[j, i]
                T = Tsl[m, j, i] - lapse_ref * zc[j, i] - lapse * dz
                P = Pc[m, j, i] * math.exp(-gammaP * lapse * dz)      # m w.e./day
                fsnow = 0.5 * math.erfc((T - snowT) / (math.sqrt(2.0) * sigma))
                acc += P * fsnow * days[m]
                e = sigma / math.sqrt(2 * math.pi) * math.exp(-T * T / (2 * sigma * sigma)) \
                    + 0.5 * T * math.erfc(-T / (math.sqrt(2.0) * sigma))
                pdd += e * days[m]
            snow_melt_pot = pdd * ddf_s
            if snow_melt_pot <= acc:
                melt_snow = snow_melt_pot
                melt_ice = 0.0
            else:
                melt_snow = acc
                melt_ice = (pdd - acc / ddf_s) * ddf_i
            runoff = melt_snow * (1 - refr) + melt_ice
            out_acc[j, i] = acc * 1000.0 / RHO_I
            out_melt[j, i] = runoff * 1000.0 / RHO_I
            out_smb[j, i] = (acc - runoff) * 1000.0 / RHO_I      # m ice / yr


# ---------------------------------------------------------------- SIA step
@numba.njit(cache=True)
def _fluxes(H, s, k, dx, gam, qx, qy):
    ny, nx = H.shape
    dmax = 0.0
    for j in range(1, ny - 1):
        for i in range(0, nx - 1):
            Hf = 0.5 * (H[j, i] + H[j, i + 1])
            if Hf <= 0.0:
                qx[j, i] = 0.0
                continue
            sx = (s[j, i + 1] - s[j, i]) / dx
            sy = 0.25 * (s[j + 1, i] + s[j + 1, i + 1] - s[j - 1, i] - s[j - 1, i + 1]) / dx
            kf = 0.5 * (k[j, i] + k[j, i + 1])
            D = gam * Hf ** 5 * kf * kf * (sx * sx + sy * sy)
            qx[j, i] = D * sx
            d = D * kf * kf
            if d > dmax:
                dmax = d
    for j in range(0, ny - 1):
        for i in range(1, nx - 1):
            Hf = 0.5 * (H[j, i] + H[j + 1, i])
            if Hf <= 0.0:
                qy[j, i] = 0.0
                continue
            sy = (s[j + 1, i] - s[j, i]) / dx
            sx = 0.25 * (s[j, i + 1] + s[j + 1, i + 1] - s[j, i - 1] - s[j + 1, i - 1]) / dx
            kf = 0.5 * (k[j, i] + k[j + 1, i])
            D = gam * Hf ** 5 * kf * kf * (sx * sx + sy * sy)
            qy[j, i] = D * sy
            d = D * kf * kf
            if d > dmax:
                dmax = d
    return dmax


@numba.njit(cache=True)
def _update(H, b, smb, k, qx, qy, dx, dt, inside, area, stats, limit):
    """stats: [realised smb volume, calving volume, boundary loss volume]
    area: true cell area (m2), unmasked.

    Written in volume terms: the volume crossing a face in dt is q*dx*dt
    (the map factors cancel), which makes the scheme exactly conservative.
    With limit=True, each donor cell's outgoing face volumes are scaled so it
    cannot export more ice than it holds (a positivity-preserving flux
    limiter). Without it, steep beds can drive H negative and the clip to
    zero silently CREATES ice -- the first run's 5 % mass residual."""
    ny, nx = H.shape
    fac = np.ones_like(H)
    if limit:
        out = np.zeros_like(H)
        for j in range(ny):
            for i in range(nx - 1):
                F = qx[j, i] * dx * dt          # >0: from (j,i+1) into (j,i)
                if F > 0:
                    out[j, i + 1] += F
                else:
                    out[j, i] -= F
        for j in range(ny - 1):
            for i in range(nx):
                F = qy[j, i] * dx * dt          # >0: from (j+1,i) into (j,i)
                if F > 0:
                    out[j + 1, i] += F
                else:
                    out[j, i] -= F
        for j in range(ny):
            for i in range(nx):
                if out[j, i] > 0:
                    fac[j, i] = min(1.0, H[j, i] * area[j, i] / out[j, i])
    dV = np.zeros_like(H)
    for j in range(ny):
        for i in range(nx - 1):
            F = qx[j, i] * dx * dt
            F *= fac[j, i + 1] if F > 0 else fac[j, i]
            dV[j, i] += F
            dV[j, i + 1] -= F
    for j in range(ny - 1):
        for i in range(nx):
            F = qy[j, i] * dx * dt
            F *= fac[j + 1, i] if F > 0 else fac[j, i]
            dV[j, i] += F
            dV[j + 1, i] -= F
    Hn = np.empty_like(H)
    for j in range(ny):
        for i in range(nx):
            h = H[j, i] + dV[j, i] / area[j, i]
            edge = j == 0 or i == 0 or j == ny - 1 or i == nx - 1
            if edge or not inside[j, i]:
                # ice pushed across the equator / domain edge leaves the model
                if h > 0.0:
                    stats[2] += h * area[j, i]
                Hn[j, i] = 0.0
                continue
            if h < 0.0:
                stats[3] += -h * area[j, i]     # ice created by clipping (should be ~0 with the limiter)
                h = 0.0
            m = smb[j, i] * dt
            if h + m < 0.0:
                m = -h
            stats[0] += m * area[j, i]
            Hn[j, i] = h + m
    # flotation calving: ice over a marine bed must be thick enough to ground
    for j in range(ny):
        for i in range(nx):
            if Hn[j, i] > 0.0 and b[j, i] < 0.0 and Hn[j, i] * RHO_I < -b[j, i] * RHO_W:
                stats[1] += Hn[j, i] * area[j, i]
                Hn[j, i] = 0.0
    return Hn


class IceSheet:
    def __init__(self, hemi, dx, bed_free, climate, p=None):
        """bed_free: fine lat-lon ice-free bed (south-first). climate: dict with
        Tsl (12, ny, nx) C, P (12, ny, nx) kg/m2/s, zc (ny, nx) m, on the
        climate grid (south-first)."""
        self.p = dict(ICE, **(p or {}))
        pg = proj_grid(hemi, dx)
        self.pg = pg
        self.inside = pg["inside"] & (pg["lat"] * hemi > 0)
        self.b_eq = area_average_to_grid(bed_free, pg)
        self.b = self.b_eq.copy()
        self.H = np.zeros_like(self.b)
        lat, lon = pg["lat"], pg["lon"]
        self.Tsl = np.stack([bilinear_latlon(climate["Tsl"][m], lat, lon) for m in range(12)])
        self.Pc = np.stack([bilinear_latlon(climate["P"][m], lat, lon) for m in range(12)]) * 86400 / 1000.0
        self.zc = bilinear_latlon(climate["zc"], lat, lon)
        self.k = pg["k"]
        self.area = pg["area"] * self.inside
        self.gam = 2 * self.p["A_glen"] * (RHO_I * G) ** 3 / 5.0
        self.acc = np.zeros_like(self.b)
        self.melt = np.zeros_like(self.b)
        self.smb = np.zeros_like(self.b)
        self.t = 0.0
        self.stats = np.zeros(4)
        self.update_smb()

    def surface(self):
        return np.where(self.H > 0, np.maximum(self.b + self.H, self.H * (1 - RHO_I / RHO_W)),
                        np.maximum(self.b, 0.0))

    def update_smb(self):
        p = self.p
        _smb(self.surface(), self.zc, self.Tsl, self.Pc, self.inside, p["lapse_ref"], p["lapse"], p["gammaP"], p["pdd_sigma"],
             p["ddf_snow"], p["ddf_ice"], p["refreeze"], p["snow_T"], self.acc, self.melt, self.smb)

    def step(self):
        p, dx = self.p, self.pg["dx"]
        s = self.b + self.H
        qx = np.zeros_like(self.H)
        qy = np.zeros_like(self.H)
        dmax = _fluxes(self.H, s, self.k, dx, self.gam, qx, qy)
        dt = p["dt_max"] if dmax <= 0 else min(p["dt_max"], p["cfl"] * dx * dx / dmax)
        self.H = _update(self.H, self.b, self.smb, self.k, qx, qy, dx, dt, self.inside, self.pg["area"], self.stats,
                         bool(self.p["flux_limiter"]))
        # ELRA bed response
        target = self.b_eq - RHO_I / RHO_M * self.H
        self.b += (target - self.b) * (1 - math.exp(-dt / p["tau_bed"]))
        self.t += dt
        return dt

    def volume(self):
        return float(np.sum(self.H * self.area))

    def grounded_area(self):
        return float(np.sum((self.H > 1.0) * self.area))
