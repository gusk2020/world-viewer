"""Fit the statistical colouring and write a run compatible with the globe.

  python3 fit.py [run-name]

Targets (teacher, same variable/units/period/grid as displayed):
  temperature   annual mean 2 m air temperature, Berkeley Earth 1991-2020, 2 deg
  precipitation annual total, GPCP v2.3 1991-2020, 2 deg (fitted in log)
  land ice      grounded ice thickness, GEBCO_2026 surface - sub-ice bed, 0.5 deg

Honesty rule: every map shown as "model" is an OUT-OF-SECTOR prediction.
The globe is cut into six 60-degree longitude sectors; each sector is
predicted by a model trained on the other five. So a region is never
coloured by a model that has seen it, and the scores are held-out scores.
Longitude itself is never a feature.
"""
import json
import os
import sys

import numpy as np
from sklearn.ensemble import HistGradientBoostingClassifier, HistGradientBoostingRegressor

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "model"))
import data  # noqa: E402
import bedrock  # noqa: E402
import diag_climate  # noqa: E402
from grid import LatLonGrid, regrid_conservative  # noqa: E402
import features as FE  # noqa: E402

SECTORS = 6


def cv_predict(X, y, w, lon, monotone=None, **kw):
    pred = np.full(len(y), np.nan)
    sector = ((lon + 180) // (360 / SECTORS)).astype(int)
    for s in range(SECTORS):
        tr, te = sector != s, sector == s
        m = HistGradientBoostingRegressor(max_iter=400, learning_rate=0.05, max_leaf_nodes=31,
                                          min_samples_leaf=40, l2_regularization=1.0,
                                          monotonic_cst=monotone, random_state=0, **kw)
        m.fit(X[tr], y[tr], sample_weight=w[tr])
        pred[te] = m.predict(X[te])
    full = HistGradientBoostingRegressor(max_iter=400, learning_rate=0.05, max_leaf_nodes=31,
                                         min_samples_leaf=40, l2_regularization=1.0,
                                         monotonic_cst=monotone, random_state=0, **kw).fit(X, y, sample_weight=w)
    return pred, full


def matrix(F, names):
    return np.stack([F[k].ravel() for k in names], 1)


def main(name="STAT_v1"):
    out = os.path.join(HERE, "..", "runs", name)
    os.makedirs(out, exist_ok=True)
    surf = data.surface_2048()
    # ---- temperature & precipitation on 2 deg, from the present surface
    g = LatLonGrid(2, 2)
    F2 = FE.build(surf, 0.0, g.ny, g.nx)
    names = [k for k in F2 if not k.startswith("_")]
    X = matrix(F2, names)
    Tt, Pt = diag_climate.teacher()
    Tann = diag_climate.annual(Tt).ravel()
    Pann = diag_climate.annual(Pt).ravel() * 365.25
    w = g.area.ravel() / g.area.mean()
    lon = g.LON.ravel()
    mono = [FE.MONOTONE.get(k, 0) for k in names]
    Tpred, Tfull = cv_predict(X, Tann, w, lon, monotone=mono)
    Ppred_log, Pfull = cv_predict(X, np.log(np.maximum(Pann, 10)), w, lon)
    Ppred = np.exp(Ppred_log)

    # ---- land ice on 0.5 deg, from the ICE-FREE restored bed (the present
    # ice surface would hand the answer to the model: an ice sheet is high
    # because it is an ice sheet)
    s, b = data.surface_2048(), data.bed_2048()
    H, gnd, _ = bedrock.observed_ice(s, b)
    bed_free = bedrock.restore(b, H * gnd)
    gi = LatLonGrid(0.5, 0.5)
    Fi = FE.build(bed_free, 0.0, gi.ny, gi.nx)
    namesi = [k for k in Fi if not k.startswith("_")]
    Xi = matrix(Fi, namesi)
    Hobs = regrid_conservative(H * gnd, np.linspace(-90, 90, 1025), np.linspace(-180, 180, 2049),
                               gi.lat_edges, gi.lon_edges)
    Hobs = np.nan_to_num(Hobs)
    landi = (Fi["land_frac"] > 0.3).ravel()
    wi = gi.area.ravel() / gi.area.mean()
    # two stages, both held out by sector: is there an ice sheet (> 100 m),
    # and if so how thick. A single regression smears a thin film over every
    # land cell, because the mean of "mostly zero" is small but not zero.
    Xl, Hl, wl = Xi[landi], Hobs.ravel()[landi], wi[landi]
    sec = ((gi.LON.ravel()[landi] + 180) // (360 / SECTORS)).astype(int)
    present = np.zeros(len(Hl))
    thick = np.zeros(len(Hl))
    for s_ in range(SECTORS):
        tr, te = sec != s_, sec == s_
        clf = HistGradientBoostingClassifier(max_iter=300, learning_rate=0.05, min_samples_leaf=40,
                                             l2_regularization=1.0, random_state=0)
        clf.fit(Xl[tr], Hl[tr] > 100, sample_weight=wl[tr])
        present[te] = clf.predict_proba(Xl[te])[:, 1]
        on = tr & (Hl > 100)
        reg = HistGradientBoostingRegressor(max_iter=300, learning_rate=0.05, min_samples_leaf=40,
                                            l2_regularization=1.0, random_state=0)
        reg.fit(Xl[on], Hl[on], sample_weight=wl[on])
        thick[te] = np.maximum(reg.predict(Xl[te]), 0)
    Hfull = None
    Hpred = np.zeros(Hobs.size)
    Hpred[landi] = np.where(present > 0.5, thick, 0.0)
    Hpred = Hpred.reshape(gi.ny, gi.nx)

    # ---- scores (held-out)
    A = g.area.ravel()
    def wm(x, m=None):
        ww = A if m is None else A * m
        ok = np.isfinite(x)
        return float(np.sum(x[ok] * ww[ok]) / np.sum(ww[ok]))
    def corr(a, bb, ww):
        am, bm = np.sum(a * ww) / ww.sum(), np.sum(bb * ww) / ww.sum()
        return float(np.sum(ww * (a - am) * (bb - bm)) / np.sqrt(np.sum(ww * (a - am) ** 2) * np.sum(ww * (bb - bm) ** 2)))
    land = (F2["land_frac"] >= 0.5).ravel()
    low = land & (np.abs(g.LAT.ravel()) < 60)
    des, wet = low & (Pann < 250), low & (Pann > 2000)
    ice_ok = np.isfinite(Hobs)
    Ai = gi.area
    def ice_region(Hm, m):
        return dict(area_Mkm2=float(((Hm > 10) * m * Ai).sum() / 1e12), volume_Mkm3=float((Hm * m * Ai).sum() / 1e15))
    LATi, LONi = gi.LAT, gi.LON
    regions = {
        "Antarctica": LATi < -60,
        "Greenland": (LATi > 59) & (LONi > -75) & (LONi < -10),
        "other land": ~((LATi < -60) | ((LATi > 59) & (LONi > -75) & (LONi < -10))),
    }
    mi, oi = Hpred > 10, Hobs > 10
    summary = {
        "experiment": name,
        "method": "HistGradientBoosting on body-agnostic terrain features, 6-sector longitude hold-out",
        "features_TP": names, "features_ice": namesi,
        "temperature": {"rmse_K": float(np.sqrt(wm((Tpred - Tann) ** 2))),
                        "rmse_land_K": float(np.sqrt(wm((Tpred - Tann) ** 2, land))),
                        "bias_K": wm(Tpred - Tann), "corr": corr(Tpred, Tann, A),
                        "global_model": wm(Tpred), "global_teacher": wm(Tann)},
        "precipitation": {"global_model": wm(Ppred), "global_teacher": wm(Pann),
                          "corr_log": corr(np.log(Ppred), np.log(np.maximum(Pann, 10)), A),
                          "corr_log_land": corr(np.log(Ppred[land]), np.log(np.maximum(Pann[land], 10)), A[land]),
                          "desert_hit_lt400": float((A * des * (Ppred < 400)).sum() / (A * des).sum()),
                          "rainforest_hit_gt1500": float((A * wet * (Ppred > 1500)).sum() / (A * wet).sum())},
        "ice": {"iou_H_gt_10m": float(((mi & oi) * Ai).sum() / ((mi | oi) * Ai).sum()),
                "regions_model": {k: ice_region(Hpred, m) for k, m in regions.items()},
                "regions_obs": {k: ice_region(Hobs, m) for k, m in regions.items()}},
    }
    json.dump(summary, open(os.path.join(out, "summary.json"), "w"), indent=1, ensure_ascii=False)
    days = np.array([31, 28.25, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31])
    np.savez_compressed(os.path.join(out, "fields.npz"),
                        Ts_model=np.repeat(Tpred.reshape(1, g.ny, g.nx), 12, 0).astype(np.float32),
                        P_model=np.repeat((Ppred / 365.25).reshape(1, g.ny, g.nx), 12, 0).astype(np.float32),
                        H_model=Hpred.astype(np.float32), H_obs=Hobs.astype(np.float32))
    # importance proxy: permutation on the full model, cheap version
    print(json.dumps({k: summary[k] for k in ("temperature", "precipitation", "ice")}, indent=1, ensure_ascii=False))
    return F2, Fi, Tfull, Pfull, Hfull, names, namesi


if __name__ == "__main__":
    main(*(sys.argv[1:] or []))
