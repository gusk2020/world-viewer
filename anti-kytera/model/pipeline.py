"""End-to-end Anti-KyTerra experiment.

  python3 pipeline.py <experiment-name> [--bed local|flexure|none] [--dx 40]
          [--climate-years 30] [--tmax 300] [--init-ice 0] [--clim-cache path]
          [--param key=value ...]

1. ice-free bedrock (bedrock.py)            -- observed ice used ONLY here
2. fixed-condition climate (climate.py)     -- no ice-sheet feedback
3. ice sheets from zero ice (icesheet.py)   -- until practical convergence
4. diagnostics vs teacher + display export
Outputs go to anti-kytera/runs/<experiment-name>/ (summary.json, fields).
"""
import argparse
import json
import os
import time

import numpy as np

import bedrock
import climate
import diag_climate
import icesheet
import run_ice
import setup_world
from grid import LatLonGrid, regrid_conservative

HERE = os.path.dirname(os.path.abspath(__file__))
RUNS = os.path.join(HERE, "..", "runs")

REGIONS = {  # reporting only -- never used by the model
    "Antarctica": lambda la, lo: la < -60,
    "Greenland": lambda la, lo: (la > 59) & (lo > -75) & (lo < -10),
    "N America (excl. Greenland)": lambda la, lo: (la > 15) & (lo > -170) & (lo < -50) & ~((la > 59) & (lo > -75) & (lo < -10)),
    "Eurasia": lambda la, lo: (la > 5) & ((lo > -10) | (lo < -170)) & ~((la > 59) & (lo > -75) & (lo < -10)),
    "S America": lambda la, lo: (la < 15) & (la > -60) & (lo > -90) & (lo < -30),
    "Africa + Australia + other": lambda la, lo: (la > -60) & (la < 40) & (lo > -20) & (lo < 180) & ~((la > 5) & ((lo > -10) | (lo < -170))) ,
}


def ice_grid_to_latlon(sheets, field_fn, w=720, h=360):
    """Sample a per-ice-grid field onto a lat-lon grid (south-first)."""
    lat = (np.arange(h) + 0.5) / h * 180 - 90
    lon = (np.arange(w) + 0.5) / w * 360 - 180
    LAT, LON = np.meshgrid(lat, lon, indexing="ij")
    out = np.zeros((h, w))
    for sh in sheets:
        hemi, N, dx = sh.pg["hemi"], sh.pg["N"], sh.pg["dx"]
        sel = LAT * hemi > 0
        x, y = icesheet.latlon_to_xy(LAT[sel], LON[sel], hemi)
        fx = x / dx + (N - 1) / 2
        fy = y / dx + (N - 1) / 2
        F = field_fn(sh)
        i0 = np.clip(np.floor(fx).astype(int), 0, N - 2)
        j0 = np.clip(np.floor(fy).astype(int), 0, N - 2)
        wx, wy = np.clip(fx - i0, 0, 1), np.clip(fy - j0, 0, 1)
        v = ((1 - wx) * (1 - wy) * F[j0, i0] + wx * (1 - wy) * F[j0, i0 + 1]
             + (1 - wx) * wy * F[j0 + 1, i0] + wx * wy * F[j0 + 1, i0 + 1])
        out[sel] = v
    return out


def region_stats(sheets, Hfn):
    rows = {}
    for name, fn in REGIONS.items():
        V = A = 0.0
        for sh in sheets:
            m = fn(sh.pg["lat"], sh.pg["lon"]) & sh.inside
            H = Hfn(sh)
            V += float(np.sum(H * sh.area * m))
            A += float(np.sum((H > 10) * sh.area * m))
        rows[name] = dict(volume_Mkm3=V / 1e15, area_Mkm2=A / 1e12)
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("name")
    ap.add_argument("--bed", default="local")
    ap.add_argument("--dx", type=float, default=60.0)
    ap.add_argument("--climate-years", type=int, default=30)
    ap.add_argument("--tmax", type=float, default=300.0)
    ap.add_argument("--init-ice", type=float, default=0.0)
    ap.add_argument("--clim-cache", default=None)
    ap.add_argument("--climate-t0", default="warm")
    ap.add_argument("--param", action="append", default=[])
    ap.add_argument("--ice-param", action="append", default=[])
    a = ap.parse_args()
    out_dir = os.path.join(RUNS, a.name)
    os.makedirs(out_dir, exist_ok=True)
    t_start = time.time()
    g = LatLonGrid(2, 2)
    world = setup_world.restored_bed(a.bed)
    frac, z = setup_world.climate_boundary(world["bed_free"], g)
    land = frac >= 0.5
    cp = climate.params(**{k: float(v) for k, v in (s.split("=") for s in a.param)})
    ip = {k: float(v) for k, v in (s.split("=") for s in a.ice_param)}
    ip.setdefault("lapse_ref", cp["lapse"])     # climate column -> surface, at the climate's own z_c

    # ---- climate
    if a.clim_cache and os.path.exists(a.clim_cache):
        C = dict(np.load(a.clim_cache))
        print("climate from cache", a.clim_cache)
    else:
        model = climate.Climate(g, land, z, cp)
        t0 = None if a.climate_t0 == "warm" else float(a.climate_t0)
        out = model.run(years=a.climate_years, T0=t0)
        C = {k: v for k, v in out.items() if k != "state"}
        C.update({"state_" + k: v for k, v in out["state"].items()})
        C["land"], C["z"], C["frac"] = land, z, frac
        np.savez_compressed(os.path.join(out_dir, "climate.npz"), **C)
    hist = C["history"]
    clim = dict(Tsl=C["T"], P=C["P"], zc=z)

    # ---- ice from zero
    init = a.init_ice if a.init_ice > 0 else None
    sheets, ihist, converged, budget = run_ice.run(world["bed_free"], clim, dx=a.dx * 1e3,
                                                   t_max=a.tmax * 1e3, p=ip, init_H=init, label=a.name)
    # observed ice on the SAME ice grid (area-averaged), for comparison only
    for sh in sheets:
        sh.H_obs = icesheet.area_average_to_grid(world["H_obs"], sh.pg) * sh.inside
        sh.b_now_obs = icesheet.area_average_to_grid(world["bed"], sh.pg)

    # ---- model surface elevation change on the climate grid (for T and P shown
    # at the model's own final surface)
    s0 = [np.maximum(sh.b_eq, 0) for sh in sheets]
    dS = ice_grid_to_latlon(sheets, lambda sh: np.where(sh.inside, sh.surface() - np.maximum(sh.b_eq, 0), 0.0), 360, 180)
    dS2 = regrid_conservative(dS, np.linspace(-90, 90, 181), np.linspace(-180, 180, 361), g.lat_edges, g.lon_edges)
    dS2 = np.where(land, dS2, 0.0)
    lapse_ice = sheets[0].p["lapse"]
    gammaP = sheets[0].p["gammaP"]
    Ts_model = C["T"] - cp["lapse"] * z[None] - lapse_ice * dS2[None]
    P_model = C["P"] * np.exp(-gammaP * lapse_ice * dS2)[None] * 86400   # mm/day
    r = diag_climate.diagnose(Ts_model, P_model, land, g, quiet=True)
    # climate check outside the present ice sheets (where the condition
    # difference ice-free vs observed is smallest)
    obs_ice2 = regrid_conservative((world["H_obs"] > 10).astype(float), np.linspace(-90, 90, 1025),
                                   np.linspace(-180, 180, 2049), g.lat_edges, g.lon_edges) > 0.3
    Tt, Pt = diag_climate.teacher()
    Tta = diag_climate.annual(Tt)
    Tma = diag_climate.annual(Ts_model)
    nonice = ~obs_ice2
    r["T_rmse_outside_obs_ice"] = float(np.sqrt(g.mean(np.where(nonice, (Tma - Tta) ** 2, np.nan))))
    r["T_bias_outside_obs_ice"] = float(g.mean(np.where(nonice, Tma - Tta, np.nan)))
    r["T_bias_on_obs_ice"] = float(g.mean(np.where(obs_ice2, Tma - Tta, np.nan)))

    # ---- energy & water closure of the climate (final year)
    net = diag_climate.annual(C["net"])
    Pa, Ea = diag_climate.annual(C["P"]), diag_climate.annual(C["E"])
    energy = dict(TOA_net_final_year_Wm2=float(g.mean(net)),
                  climate_drift_last5yr_K=float(hist[-1, 1] - hist[-6, 1]) if len(hist) > 5 else None,
                  P_minus_E_global_mm_yr=float(g.mean(Pa - Ea) * 86400 * 365.25),
                  P_global_mm_yr=float(g.mean(Pa) * 86400 * 365.25))

    ice_model = region_stats(sheets, lambda sh: sh.H)
    ice_obs = region_stats(sheets, lambda sh: sh.H_obs)
    V = sum(sh.volume() for sh in sheets)
    Vobs = sum(float(np.sum(sh.H_obs * sh.area)) for sh in sheets)
    ocean_area = 3.61e14
    summary = dict(
        experiment=a.name, bed=a.bed, dx_km=a.dx, init_ice_m=a.init_ice,
        climate_params={k: cp[k] for k in cp}, ice_params=sheets[0].p,
        climate=r, energy_water=energy,
        climate_history=[list(map(float, h)) for h in hist],
        ice=dict(t_end_kyr=float(ihist[-1, 0] / 1e3), converged=bool(converged),
                 volume_Mkm3=V / 1e15, volume_obs_Mkm3=Vobs / 1e15,
                 sea_level_equiv_m_reference_only=-(V * 910 / 1000) / ocean_area,
                 regions_model=ice_model, regions_obs=ice_obs,
                 history=[[float(h[0]), float(h[1] / 1e15), float(h[2] / 1e12)] for h in ihist],
                 mass_budget=[{k: float(v / 1e15) for k, v in b.items()} for b in budget]),
        runtime_s=time.time() - t_start,
    )
    json.dump(summary, open(os.path.join(out_dir, "summary.json"), "w"), indent=1)
    np.savez_compressed(os.path.join(out_dir, "fields.npz"),
                        Ts_model=Ts_model.astype(np.float32), P_model=P_model.astype(np.float32),
                        land=land, dS2=dS2.astype(np.float32),
                        H_model=ice_grid_to_latlon(sheets, lambda sh: sh.H).astype(np.float32),
                        H_obs=ice_grid_to_latlon(sheets, lambda sh: sh.H_obs).astype(np.float32),
                        smb=ice_grid_to_latlon(sheets, lambda sh: np.where(sh.inside, sh.smb, 0)).astype(np.float32),
                        u=C["u"].astype(np.float32), v=C["v"].astype(np.float32))
    print(json.dumps({k: summary[k] for k in ("climate", "energy_water")}, indent=1))
    print(json.dumps(summary["ice"]["regions_model"], indent=1))
    print("obs", json.dumps(summary["ice"]["regions_obs"], indent=1))
    print("converged", converged, "t", summary["ice"]["t_end_kyr"], "budget", summary["ice"]["mass_budget"])


if __name__ == "__main__":
    main()
