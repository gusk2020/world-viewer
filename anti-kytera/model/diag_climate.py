"""Climate diagnostics against the teacher (same variable, units, period
definition, and 2-degree scale). Prints numbers; returns a dict."""
import json
import os
import sys

import numpy as np

from grid import LatLonGrid

DAYS = np.array([31, 28.25, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31])
HERE = os.path.dirname(__file__)


def teacher():
    t = np.load(os.path.join(HERE, "..", "data", "teacher_2deg.npz"))
    return t["t2m_monthly_c"].astype(float), t["precip_monthly_mm_day"].astype(float)


def annual(x):
    return np.tensordot(DAYS, x, 1) / DAYS.sum()


def corr(a, b, w):
    ok = np.isfinite(a) & np.isfinite(b)
    a, b, w = a[ok], b[ok], w[ok]
    am, bm = np.sum(a * w) / w.sum(), np.sum(b * w) / w.sum()
    return float(np.sum(w * (a - am) * (b - bm)) / np.sqrt(np.sum(w * (a - am) ** 2) * np.sum(w * (b - bm) ** 2)))


def diagnose(Ts_model_monthly, P_model_monthly_mm_day, land, g, quiet=False, lat_mask=None):
    Tt, Pt = teacher()
    Tm = annual(Ts_model_monthly)
    Pm = annual(P_model_monthly_mm_day) * 365.25
    Tta = annual(Tt)
    Pta = annual(Pt) * 365.25
    A = g.area
    r = {}
    def wmean(x, m=None):
        w = A if m is None else A * m
        ok = np.isfinite(x)
        return float(np.sum(x[ok] * w[ok]) / np.sum(w[ok]))
    r["T_global_model"] = wmean(Tm)
    r["T_global_teacher"] = wmean(Tta)
    d = Tm - Tta
    r["T_rmse"] = float(np.sqrt(wmean(d ** 2)))
    r["T_rmse_land"] = float(np.sqrt(wmean(d ** 2, land)))
    r["T_rmse_ocean"] = float(np.sqrt(wmean(d ** 2, ~land)))
    r["T_pattern_corr"] = corr(Tm, Tta, A)
    seas_m = Ts_model_monthly[6] - Ts_model_monthly[0]
    seas_t = Tt[6] - Tt[0]
    r["T_JulJan_land_NH45_65_model"] = wmean(seas_m, land & (g.LAT > 45) & (g.LAT < 65))
    r["T_JulJan_land_NH45_65_teacher"] = wmean(seas_t, land & (g.LAT > 45) & (g.LAT < 65))
    r["P_global_model"] = wmean(Pm)
    r["P_global_teacher"] = wmean(Pta)
    r["P_pattern_corr"] = corr(Pm, Pta, A)
    r["P_pattern_corr_land"] = corr(np.where(land, Pm, np.nan), np.where(land, Pta, np.nan), A)
    # desert / rainforest agreement on land (|lat| < 60, where both classes live)
    low = land & (np.abs(g.LAT) < 60)
    desert_t = low & (Pta < 250)
    wet_t = low & (Pta > 2000)
    r["desert_teacher_area_frac"] = float((A * desert_t).sum() / (A * low).sum())
    r["desert_hit_model_lt400"] = float((A * desert_t * (Pm < 400)).sum() / (A * desert_t).sum())
    r["desert_model_area_frac_lt250"] = float((A * (low & (Pm < 250))).sum() / (A * low).sum())
    r["rainforest_teacher_area_frac"] = float((A * wet_t).sum() / (A * low).sum())
    r["rainforest_hit_model_gt1500"] = float((A * wet_t * (Pm > 1500)).sum() / (A * wet_t).sum())
    r["rainforest_model_area_frac_gt2000"] = float((A * (low & (Pm > 2000))).sum() / (A * low).sum())
    zm = []
    for lo in range(-90, 90, 10):
        m = (g.LAT >= lo) & (g.LAT < lo + 10)
        zm.append((lo + 5, wmean(Tm, m), wmean(Tta, m), wmean(Pm, m), wmean(Pta, m)))
    r["zonal"] = zm
    if not quiet:
        for k, v in r.items():
            if k != "zonal":
                print(f"  {k:36s} {v:9.3f}")
        print("  lat   Tmod  Ttea   Pmod  Ptea (mm/yr)")
        for z in zm:
            print("  %+4d %6.1f %6.1f %6.0f %6.0f" % z)
    return r


if __name__ == "__main__":
    o = np.load(sys.argv[1])
    g = LatLonGrid(2, 2)
    diagnose(o["Ts"], o["P"] * 86400, o["land"], g)
