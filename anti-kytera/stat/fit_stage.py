"""Anti-KyTerra staged colouring (v3): bedrock -> sea at 0 m -> temperature
-> humidity -> precipitation -> land ice.

Input terrain is ONLY the published sub-ice bedrock (GEBCO_2026 sub-ice
topography) with a fixed elevation correction BED_CORRECTION_M (see
TERRAIN.md: 0 m, an app assumption). The present ice-surface elevation and
the teacher ice thickness are never used as features.

Each later stage may use the earlier stages' predictions as features
(temperature -> humidity -> precipitation -> ice), always of the same kind:
  mode "fit"     : trained on the whole Earth, applied to the whole Earth
                   (how close the colouring can get; in-sample)
  mode "holdout" : six 60-degree longitude sectors, each predicted by models
                   trained on the other five, including the chained inputs
                   (how well it generalises to unseen regions)
"""
import json
import os
import sys

import numpy as np
from sklearn.ensemble import HistGradientBoostingClassifier as HGC
from sklearn.ensemble import HistGradientBoostingRegressor as HGR

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "model"))
import bedrock  # noqa: E402
import data  # noqa: E402
import diag_climate  # noqa: E402
from grid import LatLonGrid, regrid_conservative  # noqa: E402
import features as FE  # noqa: E402

BED_CORRECTION_M = 0.0       # TERRAIN.md: fixed app assumption, not a literature value
SEA_LEVEL_M = 0.0
SECTORS = 6
OUT = os.environ.get("AK_OUT", os.path.join(HERE, "..", "runs", "STAGE_v3"))


def reg(mono=None):
    return HGR(max_iter=400, learning_rate=0.05, max_leaf_nodes=31, min_samples_leaf=40,
               l2_regularization=1.0, monotonic_cst=mono, random_state=0)


def predict(X, y, w, lon, mode, mono=None, mask=None):
    """Return predictions for every row of X (rows outside `mask` are not
    trained on; they are still predicted)."""
    mask = np.ones(len(y), bool) if mask is None else mask
    if mode == "fit":
        return reg(mono).fit(X[mask], y[mask], sample_weight=w[mask]).predict(X)
    sec = ((lon + 180) // (360 / SECTORS)).astype(int)
    out = np.empty(len(y))
    for s in range(SECTORS):
        tr = mask & (sec != s)
        out[sec == s] = reg(mono).fit(X[tr], y[tr], sample_weight=w[tr]).predict(X[sec == s])
    return out


def ice_predict(X, H, w, lon, mode):
    sec = ((lon + 180) // (360 / SECTORS)).astype(int) if mode == "holdout" else np.zeros(len(H), int)
    groups = range(SECTORS) if mode == "holdout" else [None]
    present = np.zeros(len(H))
    thick = np.zeros(len(H))
    for s in groups:
        tr = (sec != s) if s is not None else np.ones(len(H), bool)
        te = (sec == s) if s is not None else np.ones(len(H), bool)
        c = HGC(max_iter=300, learning_rate=0.05, min_samples_leaf=40, l2_regularization=1.0, random_state=0)
        c.fit(X[tr], H[tr] > 100, sample_weight=w[tr])
        present[te] = c.predict_proba(X[te])[:, 1]
        on = tr & (H > 100)
        r = HGR(max_iter=300, learning_rate=0.05, min_samples_leaf=40, l2_regularization=1.0, random_state=0)
        r.fit(X[on], H[on], sample_weight=w[on])
        thick[te] = np.maximum(r.predict(X[te]), 0)
    return np.where(present > 0.5, thick, 0.0)


def up(field2, gi):
    """2-degree field -> 0.5-degree by nearest block (for chaining into ice)."""
    return np.repeat(np.repeat(field2, 4, 0), 4, 1)


def main():
    os.makedirs(OUT, exist_ok=True)
    bed = data.bed_2048() + BED_CORRECTION_M
    g, gi = LatLonGrid(2, 2), LatLonGrid(0.5, 0.5)
    F2 = FE.build(bed, SEA_LEVEL_M, g.ny, g.nx)
    Fi = FE.build(bed, SEA_LEVEL_M, gi.ny, gi.nx)
    names = [k for k in F2 if not k.startswith("_")]
    X2 = np.stack([F2[k].ravel() for k in names], 1)
    Xi = np.stack([Fi[k].ravel() for k in names], 1)
    w2 = g.area.ravel() / g.area.mean()
    wi = gi.area.ravel() / gi.area.mean()
    lon2, loni = g.LON.ravel(), gi.LON.ravel()
    Tt, Pt = diag_climate.teacher()
    T = diag_climate.annual(Tt).ravel()
    P = diag_climate.annual(Pt).ravel() * 365.25
    hum_path = os.environ.get("AK_HUMIDITY", os.path.join(HERE, "..", "data", "teacher_humidity_2deg.npz"))
    E = diag_climate.annual(np.load(hum_path)
                            ["vapour_pressure_monthly_hpa"].astype(float)).ravel()
    s, b = data.surface_2048(), data.bed_2048()
    Hg, gnd, _ = bedrock.observed_ice(s, b)            # teacher only, for scoring and training labels
    Hobs = np.nan_to_num(regrid_conservative(Hg * gnd, np.linspace(-90, 90, 1025), np.linspace(-180, 180, 2049),
                                             gi.lat_edges, gi.lon_edges)).ravel()
    # Grounded ice can rest on bedrock below sea level (half of the teacher's
    # Antarctic ice does), so ice is predicted on every cell, land or sea;
    # the classifier decides from the features where it belongs.
    landi = np.ones(gi.ny * gi.nx, bool)
    land_only = Fi["land_frac"].ravel() >= 0.5
    mono_T = [FE.MONOTONE.get(k, 0) for k in names]
    res = {}
    for mode in ("fit", "holdout"):
        Tm = predict(X2, T, w2, lon2, mode, mono_T)
        XE = np.column_stack([X2, Tm])
        Em = np.exp(predict(XE, np.log(E), w2, lon2, mode))
        XP = np.column_stack([XE, np.log(Em)])
        Pm = np.exp(predict(XP, np.log(np.maximum(P, 10)), w2, lon2, mode))
        chain = np.column_stack([up(Tm.reshape(g.ny, g.nx), gi).ravel(),
                                 up(np.log(Em).reshape(g.ny, g.nx), gi).ravel(),
                                 up(np.log(Pm).reshape(g.ny, g.nx), gi).ravel()])
        XI = np.column_stack([Xi, chain])[landi]
        H = np.zeros(gi.ny * gi.nx)
        H[landi] = ice_predict(XI, Hobs[landi], wi[landi], loni[landi], mode)
        res[mode] = dict(T=Tm, E=Em, P=Pm, H=H)
    # ---- scores
    A2, Ai = g.area.ravel(), gi.area.ravel()
    land2 = F2["land_frac"].ravel() >= 0.5

    def rmse(a, b_, m=None):
        ww = A2 if m is None else A2 * m
        return float(np.sqrt(np.sum(ww * (a - b_) ** 2) / ww.sum()))

    def corr(a, b_, ww):
        am, bm = (a * ww).sum() / ww.sum(), (b_ * ww).sum() / ww.sum()
        return float((ww * (a - am) * (b_ - bm)).sum() / np.sqrt((ww * (a - am) ** 2).sum() * (ww * (b_ - bm) ** 2).sum()))

    LAT, LON = gi.LAT.ravel(), gi.LON.ravel()
    regions = {"Antarctica": LAT < -60, "Greenland": (LAT > 59) & (LON > -75) & (LON < -10)}
    regions["other land"] = ~(regions["Antarctica"] | regions["Greenland"])
    scores = {}
    low = land2 & (np.abs(g.LAT.ravel()) < 60)
    for mode, r in res.items():
        mi, oi = r["H"] > 10, Hobs > 10
        scores[mode] = {
            "temperature_rmse_K": rmse(r["T"], T), "temperature_rmse_land_K": rmse(r["T"], T, land2),
            "temperature_corr": corr(r["T"], T, A2),
            "humidity_rmse_hPa": rmse(r["E"], E), "humidity_corr": corr(r["E"], E, A2),
            "humidity_global_model_teacher_hPa": [float((r["E"] * A2).sum() / A2.sum()), float((E * A2).sum() / A2.sum())],
            "precip_corr_log": corr(np.log(r["P"]), np.log(np.maximum(P, 10)), A2),
            "precip_corr_log_land": corr(np.log(r["P"][land2]), np.log(np.maximum(P[land2], 10)), A2[land2]),
            "precip_global_model_teacher": [float((r["P"] * A2).sum() / A2.sum()), float((P * A2).sum() / A2.sum())],
            "desert_hit": float((A2 * (low & (P < 250)) * (r["P"] < 400)).sum() / (A2 * (low & (P < 250))).sum()),
            "rainforest_hit": float((A2 * (low & (P > 2000)) * (r["P"] > 1500)).sum() / (A2 * (low & (P > 2000))).sum()),
            "ice_iou": float(((mi & oi) * Ai).sum() / ((mi | oi) * Ai).sum()),
            "ice_area_Mkm2": {k: [float((mi * m * Ai).sum() / 1e12), float((oi * m * Ai).sum() / 1e12)] for k, m in regions.items()},
            "ice_volume_Mkm3": {k: [float((r["H"] * m * Ai).sum() / 1e15), float((Hobs * m * Ai).sum() / 1e15)] for k, m in regions.items()},
            "teacher_ice_on_marine_bed_area_Mkm2": float(((oi & ~land_only) * Ai).sum() / 1e12),
            "model_ice_on_marine_bed_area_Mkm2": float(((mi & ~land_only) * Ai).sum() / 1e12),
        }
    json.dump({"bed_correction_m": BED_CORRECTION_M, "features": names, "scores": scores},
              open(os.path.join(OUT, "summary.json"), "w"), indent=1)
    bed_disp = regrid_conservative(bed, np.linspace(-90, 90, 1025), np.linspace(-180, 180, 2049),
                                   np.linspace(-90, 90, 721), np.linspace(-180, 180, 1441))
    np.savez_compressed(os.path.join(OUT, "fields.npz"), bed=bed_disp.astype(np.float32),
                        T_teacher=T.reshape(g.ny, g.nx), E_teacher=E.reshape(g.ny, g.nx),
                        P_teacher=P.reshape(g.ny, g.nx), H_teacher=Hobs.reshape(gi.ny, gi.nx),
                        **{f"{v}_{mode}": res[mode][v].reshape((g.ny, g.nx) if v != "H" else (gi.ny, gi.nx))
                           for mode in res for v in ("T", "E", "P", "H")})
    print(json.dumps(scores, indent=1))


if __name__ == "__main__":
    main()
