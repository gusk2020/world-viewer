"""Anti-KyTerra climate: a seasonal 2-D moist energy-balance model with a
diagnostic low-level circulation and a steady moisture budget.

Everything here is written from published intermediate-complexity designs,
not from Climate v1:

  energy     2-D seasonal EBM (North & Coakley 1979) with diffusion of moist
             static energy (Hwang & Frierson 2010), linearised OLR (Budyko
             1969), land/ocean heat capacities, and a thermodynamic sea-ice
             layer in the style of Wagner & Eisenman (2015).
  wind       damped-geostrophic boundary layer (Lindzen & Nigam 1987),
             forced by (a) a zonal-mean pressure pattern with Hadley /
             Ferrel / polar cells whose edges follow the model's own thermal
             equator and a Held & Hou (1980) Hadley width, and (b) thermal
             pressure anomalies p' ~ -T' from the model's own land-sea
             temperature contrast.
  moisture   steady advection-diffusion budget of column vapour W, with
             bulk evaporation relaxing W toward saturation, Manabe (1969)
             bucket soil moisture, condensation above a critical column
             relative humidity (as in the UVic EMBM, Fanning & Weaver 1996),
             and an upslope orographic sink.

Prognostic temperature is the SEA-LEVEL-EQUIVALENT column temperature T;
the surface temperature is T - LAPSE * z. The land surface is ice-free: the
ice-sheet model is driven by this climate but never feeds back into it
(first-stage one-way coupling). Seasonal and perennial snow on ice-free land
does change albedo -- that is the climate model's own land surface, and is
reported as such.

Units: SI, seconds; temperatures in deg C.
"""
import numpy as np
import scipy.sparse as sp
import scipy.sparse.linalg as spla

from grid import EARTH_RADIUS_M

YEAR_S = 365.25 * 86400.0
LF = 3.34e5          # latent heat of fusion, J/kg
LV = 2.5e6           # latent heat of vaporisation
CP = 1004.0
G = 9.81
OMEGA = 7.2921e-5
RHO_AIR = 1.2
RHO_ICE = 910.0

# ---- parameters. kind: physical (a measured constant or standard value) or
# global (one number for the whole planet, adjustable against observations).
P = dict(
    S0=(1361.0, "physical", "solar constant W/m2"),
    ecc=(0.0167, "physical", "eccentricity (present)"),
    obliquity=(23.44, "physical", "deg"),
    perihelion=(282.9, "physical", "longitude of perihelion from vernal equinox, deg"),
    lapse=(6.5e-3, "physical", "K/m, standard atmosphere: column (sea-level-equivalent) T -> near-surface T "
           "over land. The single post-first-run fix lowers this to the near-surface value; see RESULTS.md"),
    A_olr=(199.0, "global", "OLR = A + B*T, W/m2 (set by CO2 and clouds; fixed)"),
    B_olr=(2.0, "global", "W/m2/K, clear+cloud longwave feedback"),
    alb_base=(0.21, "global", "snow-free planetary albedo at overhead sun"),
    alb_zenith=(0.26, "global", "extra planetary albedo per unit (1 - insolation-weighted cos zenith)"),
    alb_snow=(0.60, "global", "planetary albedo of fully snow-covered land"),
    alb_seaice=(0.55, "global", "planetary albedo of sea ice"),
    D_mse=(0.30, "global", "moist static energy diffusivity, W/m2/K (unit sphere)"),
    rh_mse=(0.8, "physical", "relative humidity in the MSE"),
    C_ocean=(4.2e6 * 60, "physical", "60 m mixed layer, J/m2/K"),
    C_land=(5.0e6, "physical", "atmosphere column + soil skin, J/m2/K"),
    C_ice=(1.0e7, "physical", "atmosphere column over sea ice"),
    k_ice=(2.0, "physical", "sea-ice conductivity W/m/K"),
    T_freeze=(-1.8, "physical", "seawater freezing point"),
    H_vap=(2200.0, "physical", "water-vapour scale height, m"),
    C_E=(1.3e-3, "physical", "bulk transfer coefficient"),
    U_min=(4.0, "physical", "gustiness floor, m/s"),
    rh_crit=(0.80, "global", "column RH above which vapour condenses"),
    tau_cond=(0.25 * 86400, "physical", "condensation relaxation, s"),
    tau_bg=(12 * 86400, "global", "background (sub-grid) precipitation timescale, s"),
    eddy_eff=(0.30, "global", "storm-track precipitation per unit Eady growth rate (dimensionless)"),
    N_bv=(0.012, "physical", "tropospheric buoyancy frequency, 1/s"),
    div_ref=(1.5e-6, "global", "low-level divergence e-folding the non-saturated precipitation; "
             "descent suppresses it, ascent enhances it (factor clipped to 0.1-3)"),
    K_vap=(2.0e6, "global", "eddy diffusivity of vapour, m2/s"),
    oro_eff=(0.5, "global", "fraction of upslope-lifted vapour that rains out"),
    bucket=(150.0, "physical", "soil water capacity, mm (Manabe 1969)"),
    snow_cap=(1000.0, "physical", "max snow on land in the climate model, kg/m2"),
    phi_itcz=(-100.0, "global", "zonal-mean geopotential at the ITCZ, m2/s2 (100 m2/s2 ~ 1.2 hPa)"),
    phi_subtrop=(400.0, "global", "... at the subtropical highs"),
    phi_subpolar=(-1200.0, "global", "... at the subpolar lows"),
    phi_pole=(0.0, "global", "... at the poles"),
    thermal_H=(800.0, "global", "depth converting T' into p', m"),
    drag=(1.5 / 86400, "global", "boundary-layer linear drag, 1/s"),
    U_max=(12.0, "physical", "cap on diagnosed wind speed, m/s"),
    hadley_edge=(28.0, "global", "annual-mean Hadley cell edge, deg (observed ~28-30; the Held-Hou "
                 "scaling underestimates it and is kept only as a diagnostic)"),
    ferrel_ratio=(2.15, "global", "subpolar low latitude / Hadley edge (-> ~60 deg)"),
    bl_coupling=(0.5, "global", "near-surface RH = 1 - bl_coupling*(1 - column RH); "
                 "evaporation uses the near-surface deficit"),
)


def params(**over):
    p = {k: v[0] for k, v in P.items()}
    for k, v in over.items():
        if k not in p:
            raise KeyError(k)
        p[k] = v
    return p


def qsat(Tc):
    es = 611.2 * np.exp(17.67 * Tc / (Tc + 243.5))
    return 0.622 * es / 1.0e5


def dqsat(Tc):
    return qsat(Tc) * 17.67 * 243.5 / (Tc + 243.5) ** 2


# ---------------------------------------------------------------- insolation
def insolation(lat_deg, day_frac, p):
    """Daily-mean TOA insolation and insolation-weighted cos zenith.
    day_frac: fraction of the year since the vernal equinox (circular)."""
    e, eps, w = p["ecc"], np.radians(p["obliquity"]), np.radians(p["perihelion"])
    # mean anomaly at the equinox, then advance
    nu0 = -w
    E0 = 2 * np.arctan(np.sqrt((1 - e) / (1 + e)) * np.tan(nu0 / 2))
    M = E0 - e * np.sin(E0) + 2 * np.pi * day_frac
    E = M.copy() if np.ndim(M) else M
    for _ in range(8):
        E = E - (E - e * np.sin(E) - M) / (1 - e * np.cos(E))
    nu = 2 * np.arctan(np.sqrt((1 + e) / (1 - e)) * np.tan(E / 2))
    lam = nu + w                           # true solar longitude
    r = (1 - e * np.cos(E))                # in units of a
    dec = np.arcsin(np.sin(eps) * np.sin(lam))
    phi = np.radians(lat_deg)
    c = -np.tan(phi) * np.tan(dec)
    h0 = np.arccos(np.clip(c, -1, 1))
    Q = p["S0"] / np.pi / r**2 * (h0 * np.sin(phi) * np.sin(dec) + np.cos(phi) * np.cos(dec) * np.sin(h0))
    # insolation-weighted mean cos zenith: <mu^2>/<mu>
    s1 = h0 * np.sin(phi) * np.sin(dec) + np.cos(phi) * np.cos(dec) * np.sin(h0)
    a, b = np.sin(phi) * np.sin(dec), np.cos(phi) * np.cos(dec)
    s2 = a * a * h0 + 2 * a * b * np.sin(h0) + b * b * (h0 / 2 + np.sin(2 * h0) / 4)
    with np.errstate(invalid="ignore", divide="ignore"):
        mu = np.where(s1 > 1e-9, s2 / np.maximum(s1, 1e-12), 0.0)
    return np.maximum(Q, 0.0), mu


# ---------------------------------------------------------------- operators
class Ops:
    """Finite-volume connectivity on the lat-lon grid (unit-sphere metric)."""

    def __init__(self, g):
        self.g = g
        ny, nx = g.ny, g.nx
        self.n = ny * nx
        phi = np.radians(g.lat)
        phie = np.radians(g.lat_edges)
        dphi, dlam = np.radians(g.dlat), np.radians(g.dlon)
        self.cell_area_u = dlam * (np.sin(phie[1:]) - np.sin(phie[:-1]))   # unit sphere, per row
        idx = np.arange(self.n).reshape(ny, nx)
        # zonal faces: between (j,i) and (j,i+1)
        self.zx_a = idx.ravel()
        self.zx_b = np.roll(idx, -1, axis=1).ravel()
        self.zx_len_over_dist = np.repeat(dphi / (np.cos(phi) * dlam), nx)   # face length / centre distance
        self.zx_len = np.repeat(np.full(ny, dphi), nx)
        # meridional faces: between (j,i) and (j+1,i)
        self.my_a = idx[:-1].ravel()
        self.my_b = idx[1:].ravel()
        ce = np.cos(phie[1:-1])
        self.my_len_over_dist = np.repeat(ce * dlam / dphi, nx)
        self.my_len = np.repeat(ce * dlam, nx)
        self.area_u = np.repeat(self.cell_area_u, nx)
        self.a = np.concatenate([self.zx_a, self.my_a])
        self.b = np.concatenate([self.zx_b, self.my_b])
        self.lod = np.concatenate([self.zx_len_over_dist, self.my_len_over_dist])
        self.flen = np.concatenate([self.zx_len, self.my_len])

    def diffusion(self, coef_face):
        """Sparse matrix L with (L x)_i = (1/A_i) sum_faces coef*lod*(x_j - x_i)."""
        c = coef_face * self.lod
        a, b, n = self.a, self.b, self.n
        rows = np.concatenate([a, a, b, b])
        cols = np.concatenate([a, b, b, a])
        vals = np.concatenate([-c, c, -c, c])
        L = sp.csr_matrix((vals, (rows, cols)), shape=(n, n))
        return sp.diags(1.0 / self.area_u) @ L

    def advection(self, face_flow):
        """Upwind flux-form matrix: (M x)_i = (1/A_i) sum outward flow * x_upwind.
        face_flow: signed flow from a to b through each face (unit-sphere
        length * velocity / radius, i.e. 1/s times unit area)."""
        a, b, n = self.a, self.b, self.n
        fp = np.maximum(face_flow, 0)   # a -> b, carries x_a
        fm = np.minimum(face_flow, 0)   # b -> a, carries x_b
        rows = np.concatenate([a, b, a, b])
        cols = np.concatenate([a, a, b, b])
        vals = np.concatenate([fp, -fp, fm, -fm])
        M = sp.csr_matrix((vals, (rows, cols)), shape=(n, n))
        return sp.diags(1.0 / self.area_u) @ M


# ---------------------------------------------------------------- the model
class Climate:
    def __init__(self, g, land, z, p=None):
        """land: bool (ny,nx); z: land surface elevation (m, >= 0), ocean 0."""
        self.g, self.p = g, (p or params())
        self.ops = Ops(g)
        self.land = land.ravel().astype(bool)
        self.z = np.where(self.land, np.maximum(z.ravel(), 0.0), 0.0)
        self.lat = np.repeat(g.lat, g.nx)
        self.phi = np.radians(self.lat)
        self.f = 2 * OMEGA * np.sin(self.phi)
        a = EARTH_RADIUS_M
        # elevation gradient (m/m) at cell centres for the orographic term
        Z = self.z.reshape(g.ny, g.nx)
        dx = a * np.cos(np.radians(g.lat))[:, None] * np.radians(g.dlon)
        dy = a * np.radians(g.dlat)
        self.dzdx = ((np.roll(Z, -1, 1) - np.roll(Z, 1, 1)) / (2 * dx)).ravel()
        dzy = np.zeros_like(Z)
        dzy[1:-1] = (Z[2:] - Z[:-2]) / (2 * dy)
        self.dzdy = dzy.ravel()

    # -- wind ----------------------------------------------------------------
    def zonal_pressure(self, Tzm, lat):
        """Zonal-mean Phi(lat) from the model's own thermal structure."""
        p = self.p
        w = np.exp((Tzm - Tzm.max()) / 2.0) * (np.abs(lat) < 35)
        phiI = float(np.sum(lat * w) / np.sum(w))
        phiH = p["hadley_edge"]
        out = np.empty_like(lat)
        for hemi in (1, -1):
            b0 = phiI
            b1 = hemi * phiH + 0.5 * phiI
            b2 = hemi * p["ferrel_ratio"] * phiH
            b3 = hemi * 90.0
            sel = (lat - phiI) * hemi >= 0
            x = lat[sel]
            k = np.interp(hemi * x, [hemi * b0, hemi * b1, hemi * b2, hemi * b3], [0, 1, 2, 3])
            knots = np.array([p["phi_itcz"], p["phi_subtrop"], p["phi_subpolar"], p["phi_pole"]])
            i0 = np.minimum(np.floor(k).astype(int), 2)
            fr = k - i0
            # cosine-shaped transition between successive extrema
            out[sel] = knots[i0] + (knots[i0 + 1] - knots[i0]) * 0.5 * (1 - np.cos(np.pi * fr))
        return out, phiI, phiH

    def winds(self, T):
        p, g = self.p, self.g
        Tg = T.reshape(g.ny, g.nx)
        Tzm = Tg.mean(1)
        phibar, phiI, phiH = self.zonal_pressure(Tzm, g.lat)
        Tp = Tg - Tzm[:, None]
        Phi = phibar[:, None] - G * p["thermal_H"] * Tp / 288.0
        a = EARTH_RADIUS_M
        dx = a * np.cos(np.radians(g.lat))[:, None] * np.radians(g.dlon)
        dy = a * np.radians(g.dlat)
        Px = (np.roll(Phi, -1, 1) - np.roll(Phi, 1, 1)) / (2 * dx)
        Py = np.zeros_like(Phi)
        Py[1:-1] = (Phi[2:] - Phi[:-2]) / (2 * dy)
        f = self.f.reshape(g.ny, g.nx)
        e = p["drag"]
        den = e * e + f * f
        u = -(e * Px + f * Py) / den
        v = -(e * Py - f * Px) / den
        sp_ = np.hypot(u, v)
        s = np.minimum(1.0, p["U_max"] / np.maximum(sp_, 1e-9))
        return (u * s).ravel(), (v * s).ravel(), phiI, phiH

    def face_flow(self, u, v):
        o = self.ops
        uf = 0.5 * (u[o.zx_a] + u[o.zx_b])
        vf = 0.5 * (v[o.my_a] + v[o.my_b])
        # unit-sphere: velocity / a  * face length (radians)
        return np.concatenate([uf * o.zx_len, vf * o.my_len]) / EARTH_RADIUS_M

    # -- moisture ------------------------------------------------------------
    def eady_rate(self, T):
        """Eady growth rate 0.31 g |dT/dy| / (N T0) from the zonal-mean,
        meridionally smoothed temperature gradient (1/s). Thermal wind makes
        it independent of f; baroclinic eddies lift moisture at this rate."""
        g, p = self.g, self.p
        Tzm = T.reshape(g.ny, g.nx).mean(1)
        Tzm = np.convolve(np.pad(Tzm, 2, mode="edge"), np.ones(5) / 5, mode="valid")
        dTdy = np.gradient(Tzm, np.radians(g.dlat) * EARTH_RADIUS_M)
        sig = 0.31 * G * np.abs(dTdy) / (p["N_bv"] * 280.0)
        return np.repeat(sig, g.nx)

    def moisture(self, Ts, u, v, beta, Wprev=None, eady=0.0):
        """Steady column-vapour budget. Returns W, P, E (kg/m2/s), Poro."""
        p, o = self.p, self.ops
        n = o.n
        Wsat = RHO_AIR * qsat(Ts) * p["H_vap"]
        U = np.maximum(np.hypot(u, v), p["U_min"])
        kE = p["bl_coupling"] * p["C_E"] * U / p["H_vap"] * beta
        Adv = o.advection(self.face_flow(u, v))
        div = Adv @ np.ones(n)          # low-level divergence, 1/s
        vert = np.clip(np.exp(-div / p["div_ref"]), 0.1, 3.0)
        rbg = (1.0 / p["tau_bg"] + p["eddy_eff"] * eady) * vert
        upslope = np.maximum(0.0, u * self.dzdx + v * self.dzdy)
        koro = p["oro_eff"] * upslope / p["H_vap"] * self.land
        rc = 1.0 / p["tau_cond"]
        Kdiff = o.diffusion(np.full(o.a.size, p["K_vap"] / EARTH_RADIUS_M**2))
        base = (Adv - Kdiff).tocsr()
        cond = np.zeros(n, bool) if Wprev is None else Wprev > p["rh_crit"] * Wsat
        evap_on = np.ones(n, bool)
        for _ in range(4):
            kE_eff = kE * evap_on
            diag = kE_eff + rbg + koro + rc * cond
            rhs = kE_eff * Wsat + rc * cond * p["rh_crit"] * Wsat
            W = spla.spsolve((base + sp.diags(diag)).tocsc(), rhs, permc_spec="MMD_AT_PLUS_A")
            new_cond = W > p["rh_crit"] * Wsat
            new_evap = W < Wsat
            if np.array_equal(new_cond, cond) and np.array_equal(new_evap, evap_on):
                break
            cond, evap_on = new_cond, new_evap
        W = np.maximum(W, 0.0)
        E = kE * evap_on * (Wsat - W)
        Pc = rc * cond * np.maximum(W - p["rh_crit"] * Wsat, 0)
        Poro = koro * W
        Pr = Pc + rbg * W + Poro
        return W, np.maximum(Pr, 0), np.maximum(E, 0), Poro

    # -- time integration ----------------------------------------------------
    def run(self, years=25, steps_per_year=48, T0=None, verbose=True, state=None):
        p, o, g = self.p, self.ops, self.g
        n = o.n
        land, ocean = self.land, ~self.land
        dt = YEAR_S / steps_per_year
        # initial state: a smooth warm profile (T0=None) or a uniform value
        if T0 is None:
            T = 28.0 - 45.0 * np.sin(self.phi) ** 2
        else:
            T = np.full(n, float(T0))
        hice = np.where(ocean & (T < p["T_freeze"]), 1.0, 0.0)
        T = np.where(hice > 0, p["T_freeze"], T)
        snow = np.zeros(n)
        soil = np.full(n, 0.5 * p["bucket"])
        W = None
        if state is not None:   # restart from a previous run's final state
            T, hice, snow, soil = (state[k].ravel().copy() for k in ("T", "hice", "snow", "soil"))
        lat = g.lat
        # storage of the final year, by month
        mbin = (np.arange(steps_per_year) * 12 // steps_per_year)
        acc = None
        hist = []
        for yr in range(years):
            last = yr == years - 1
            if last:
                acc = {k: np.zeros((12, n)) for k in ("T", "Ts", "P", "E", "Psnow", "u", "v", "W", "alb", "Poro", "net")}
                cnt = np.zeros(12)
            ann_net = 0.0
            for st in range(steps_per_year):
                # calendar fraction -> fraction since the vernal equinox (20 Mar)
                dayf = ((st + 0.5) / steps_per_year - 79.0 / 365.25) % 1.0
                Qrow, murow = insolation(lat, dayf, p)
                Q = np.repeat(Qrow, g.nx)
                mu = np.repeat(murow, g.nx)
                Ts = T - p["lapse"] * self.z
                # albedo
                a_free = p["alb_base"] + p["alb_zenith"] * (1 - mu)
                fsnow = snow / (snow + 10.0)
                alb = np.where(land, a_free + (p["alb_snow"] - a_free) * fsnow, a_free)
                icy = ocean & (hice > 0)
                alb = np.where(icy, np.maximum(p["alb_seaice"], a_free), alb)
                ASR = Q * (1 - alb)
                # heat capacity & ice conduction
                C = np.where(land, p["C_land"], np.where(icy, p["C_ice"], p["C_ocean"]))
                kc = np.where(icy, p["k_ice"] / np.maximum(hice, 0.05), 0.0)
                # moist diffusion, linearised about current T
                hp = 1 + LV / CP * p["rh_mse"] * dqsat(T)
                h = T + LV / CP * p["rh_mse"] * qsat(T)
                Dm = o.diffusion(np.full(o.a.size, p["D_mse"]))
                Lh = Dm @ sp.diags(hp)
                rhs = C / dt * T + ASR - p["A_olr"] + Dm @ (h - hp * T) + kc * p["T_freeze"]
                Amat = sp.diags(C / dt + p["B_olr"] + kc) - Lh
                Tn = spla.spsolve(Amat.tocsc(), rhs, permc_spec="MMD_AT_PLUS_A")
                net = ASR - p["A_olr"] - p["B_olr"] * Tn
                # sea ice thermodynamics
                Fc = kc * (p["T_freeze"] - Tn)
                hice = np.where(icy, hice + Fc * dt / (RHO_ICE * LF), hice)
                melt_top = icy & (Tn > 0)
                hice = np.where(melt_top, hice - C * Tn / (RHO_ICE * LF), hice)
                Tn = np.where(melt_top, 0.0, Tn)
                gone = icy & (hice <= 0)
                # leftover energy (negative hice) warms the water beneath
                Tn = np.where(gone, p["T_freeze"] - hice * RHO_ICE * LF / p["C_ocean"], Tn)
                hice = np.where(gone, 0.0, hice)
                openw = ocean & (hice <= 0)
                freeze = openw & (Tn < p["T_freeze"])
                hice = np.where(freeze, p["C_ocean"] * (p["T_freeze"] - Tn) / (RHO_ICE * LF), hice)
                Tn = np.where(freeze, p["T_freeze"], Tn)
                T = Tn
                Ts = T - p["lapse"] * self.z
                # circulation and moisture
                u, v, phiI, phiH = self.winds(T)
                beta = np.where(land, np.where(snow > 1, 0.5, np.minimum(1.0, soil / (0.75 * p["bucket"]))),
                                np.where(hice > 0, 0.1, 1.0))
                W, Pr, E, Poro = self.moisture(Ts, u, v, beta, W, self.eady_rate(T))
                # land hydrology: snow and bucket (kg/m2 == mm)
                fs = np.clip((1.0 - Ts) / 2.0, 0, 1)
                Ps = Pr * fs
                snow = np.where(land, snow + Ps * dt, 0.0)
                melt_e = np.where(land & (Ts > 0) & (snow > 0), C * Ts, 0.0)
                melt = np.minimum(snow, melt_e / LF)
                snow = np.minimum(snow - melt, p["snow_cap"])
                T = T - np.where(land, melt * LF / C, 0.0)
                Ts = T - p["lapse"] * self.z
                Esoil = np.where(snow > 1, 0.0, E)
                soil = np.where(land, np.clip(soil + ((Pr - Ps) + melt / dt - Esoil) * dt, 0, p["bucket"]), soil)
                ann_net += g.mean(net.reshape(g.ny, g.nx)) / steps_per_year
                if last:
                    m = mbin[st]
                    cnt[m] += 1
                    for k, val in (("T", T), ("Ts", Ts), ("P", Pr), ("E", E), ("Psnow", Ps), ("u", u), ("v", v),
                                   ("W", W), ("alb", alb), ("Poro", Poro), ("net", net)):
                        acc[k][m] += val
            gm = g.mean(T.reshape(g.ny, g.nx))
            hist.append((yr, gm, ann_net))
            if verbose:
                print(f"  climate year {yr:3d}  global mean T_sl {gm:6.2f} C  TOA net {ann_net:+6.2f} W/m2  ITCZ {phiI:+5.1f}  Hadley {phiH:4.1f}", flush=True)
        out = {k: (acc[k] / cnt[:, None]).reshape(12, g.ny, g.nx) for k in acc}
        out["history"] = np.array(hist)
        out["state"] = dict(T=T.copy(), hice=hice.copy(), snow=snow.copy(), soil=soil.copy())
        out["seaice_final"] = hice.reshape(g.ny, g.nx)
        out["snow_final"] = snow.reshape(g.ny, g.nx)
        return out
